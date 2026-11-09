// The phone page's side of the wire (docs/send-to-phone.md, "Protocol (v1)"): the key
// from the link, nonces, pieces, sealing, and how a request fails. No DOM here, so the
// tests run it as it is and src-tauri/src/phone.rs can be checked against it.

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";

/** Plaintext bytes in a piece of a file; the last one may be shorter, an empty file has one empty piece. */
export const PIECE = 1048576;
/** Poly1305's tag, after the ciphertext of every sealed message. */
export const TAG = 16;
/** Files a phone may send in one session, and bytes in each. */
export const MAX_FILES = 20;
export const MAX_SIZE = 524288000;
/** The file number of the list sent to the phone, and the piece number of a file's description. */
export const ALL = 0xffffffff;
/** The nonce's first byte: who sealed it. */
export const FROM_COMPUTER = 0;
export const FROM_PHONE = 1;
/** Retries after a failed request, on top of the first try. */
export const RETRIES = 3;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64url without padding to bytes; null for anything else (padding, other characters, stray bits). */
export function b64urlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    const v = ALPHABET.indexOf(text[i]);
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 0xff;
    }
  }
  // The last character's unused bits are zero in a canonical encoding.
  if (acc & ((1 << bits) - 1)) return null;
  return out;
}

/** The 32-byte key from the link's fragment (`#K`, or `K`); null when it is missing or malformed. */
export function keyFromHash(hash: string): Uint8Array | null {
  const key = b64urlDecode(hash.replace(/^#/, ""));
  return key && key.length === 32 ? key : null;
}

/** `[direction, 0, 0, 0, file (u32 BE), piece (u32 BE)]`. */
export function nonce(direction: number, file: number, piece: number): Uint8Array {
  const n = new Uint8Array(12);
  n[0] = direction;
  const view = new DataView(n.buffer);
  view.setUint32(4, file >>> 0);
  view.setUint32(8, piece >>> 0);
  return n;
}

/** How many pieces a file of `size` bytes goes in: at least one. */
export function pieceCount(size: number): number {
  return Math.max(1, Math.ceil(size / PIECE));
}

/** Where piece `n` starts and ends in a file of `size` bytes. */
export function pieceBounds(size: number, n: number): [number, number] {
  return [Math.min(size, n * PIECE), Math.min(size, (n + 1) * PIECE)];
}

/** ChaCha20-Poly1305 (RFC 8439): the ciphertext with its tag after it. */
export function seal(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonce).encrypt(plain);
}

/** The plaintext back; throws when the tag does not match (a changed or misplaced piece). */
export function open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonce).decrypt(sealed);
}

export function sealJson(key: Uint8Array, nonce: Uint8Array, value: unknown): Uint8Array {
  return seal(key, nonce, new TextEncoder().encode(JSON.stringify(value)));
}

export function openJson(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(open(key, nonce, sealed)));
}

export type Entry = { name: string; size: number };

/** The opened list `{"files":[{"name","size"}]}`; null when it is not one (or empty). */
export function parseList(value: unknown): Entry[] | null {
  const files = value && typeof value === "object" ? (value as { files?: unknown }).files : undefined;
  if (!Array.isArray(files) || files.length === 0) return null;
  const out: Entry[] = [];
  for (const f of files) {
    const { name, size } = (f && typeof f === "object" ? f : {}) as { name?: unknown; size?: unknown };
    if (typeof name !== "string" || typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return null;
    out.push({ name, size });
  }
  return out;
}

/** A request the server turned away for good: the link belongs to another phone, or the session is over. */
export class Refused extends Error {
  readonly why: "otherPhone" | "ended";
  constructor(why: "otherPhone" | "ended") {
    super(why);
    this.why = why;
  }
}

/** 403: claimed by another phone; 404 and 410: the session ended. Anything else may be tried again. */
export function refusal(status: number): Refused | null {
  if (status === 403) return new Refused("otherPhone");
  if (status === 404 || status === 410) return new Refused("ended");
  return null;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** `attempt` with up to RETRIES more tries (0.5, 1, 2 s apart); a Refused ends it at once. */
export async function retry<T>(attempt: () => Promise<T>, wait: (ms: number) => Promise<void> = sleep): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof Refused || n >= RETRIES) throw e;
    }
    await wait(500 * 2 ** n);
  }
}
