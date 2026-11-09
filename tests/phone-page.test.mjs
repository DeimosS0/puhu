// The page a phone opens to send and receive files (src/phone-page, docs/send-to-phone.md):
// the wire format it shares with src-tauri/src/phone.rs, its words, and the built files
// in src-tauri/phone/ that Rust embeds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  ALL, FROM_COMPUTER, FROM_PHONE, MAX_SIZE, PIECE, RETRIES, Refused, b64urlDecode, keyFromHash, nonce, open,
  openJson, parseList, pieceBounds, pieceCount, refusal, retry, seal, sealJson,
} from "../src/phone-page/wire.ts";
// Importing the page itself must not reach for a DOM that Node does not have.
import { EN, fmtSize, readStrings } from "../src/phone-page/main.ts";
import { OUT, phonePage } from "../scripts/phone-page.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (text) => new Uint8Array(Buffer.from(text.replace(/\s+/g, ""), "hex"));
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);

// ── The key in the link ───────────────────────────────────────────────────────

test("base64url without padding decodes; anything else is refused", () => {
  assert.deepEqual(b64urlDecode(""), new Uint8Array(0));
  assert.deepEqual(b64urlDecode("AQID"), Uint8Array.from([1, 2, 3]));
  assert.deepEqual(b64urlDecode("-_8"), Uint8Array.from([0xfb, 0xff]));
  assert.deepEqual(b64urlDecode("_w"), Uint8Array.from([0xff]));
  assert.equal(b64urlDecode("_w=="), null); // padding
  assert.equal(b64urlDecode("+/8"), null); // plain base64's characters
  assert.equal(b64urlDecode("AQI D"), null);
  assert.equal(b64urlDecode("AQIDB"), null); // a length no encoding has
  assert.equal(b64urlDecode("_x"), null); // stray low bits: not canonical
  const any = Uint8Array.from({ length: 200 }, (_, i) => (i * 37 + 11) & 0xff);
  for (let n = 0; n <= any.length; n += 7) {
    const part = any.subarray(0, n);
    assert.deepEqual(b64urlDecode(Buffer.from(part).toString("base64url")), part);
  }
});

test("the key is the fragment's 32 bytes, or nothing", () => {
  const k = Buffer.from(KEY).toString("base64url");
  assert.equal(k.length, 43);
  assert.deepEqual(keyFromHash(`#${k}`), KEY);
  assert.deepEqual(keyFromHash(k), KEY);
  assert.equal(keyFromHash(""), null);
  assert.equal(keyFromHash("#"), null);
  assert.equal(keyFromHash(`#${k.slice(0, 42)}`), null); // 31 bytes and a bit
  assert.equal(keyFromHash(`#${Buffer.alloc(16).toString("base64url")}`), null);
  assert.equal(keyFromHash(`#${k}=`), null);
});

// ── Nonces and pieces ─────────────────────────────────────────────────────────

test("a nonce is direction, three zeros, file and piece big-endian", () => {
  assert.deepEqual([...nonce(FROM_COMPUTER, ALL, 0)], [0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0]); // the list
  assert.deepEqual([...nonce(FROM_PHONE, 3, ALL)], [1, 0, 0, 0, 0, 0, 0, 3, 255, 255, 255, 255]); // a description
  assert.deepEqual([...nonce(FROM_COMPUTER, 0x01020304, 0x0a0b0c0d)], [0, 0, 0, 0, 1, 2, 3, 4, 10, 11, 12, 13]);
  assert.deepEqual([...nonce(FROM_PHONE, 19, 499)], [1, 0, 0, 0, 0, 0, 0, 19, 0, 0, 1, 243]);
});

test("a file goes in 1 MiB pieces, at least one", () => {
  assert.equal(PIECE, 1048576);
  assert.equal(pieceCount(0), 1);
  assert.equal(pieceCount(1), 1);
  assert.equal(pieceCount(PIECE), 1);
  assert.equal(pieceCount(PIECE + 1), 2);
  assert.equal(pieceCount(MAX_SIZE), 500);
  assert.deepEqual(pieceBounds(0, 0), [0, 0]);
  assert.deepEqual(pieceBounds(10, 0), [0, 10]);
  assert.deepEqual(pieceBounds(PIECE + 5, 0), [0, PIECE]);
  assert.deepEqual(pieceBounds(PIECE + 5, 1), [PIECE, PIECE + 5]);
});

// ── Sealing ───────────────────────────────────────────────────────────────────

test("a sealed piece opens with its key and nonce only, and a changed byte is refused", () => {
  const plain = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
  const sealed = seal(KEY, nonce(FROM_COMPUTER, 0, 0), plain);
  assert.equal(sealed.length, plain.length + 16);
  assert.deepEqual(open(KEY, nonce(FROM_COMPUTER, 0, 0), sealed), plain);
  assert.throws(() => open(KEY, nonce(FROM_COMPUTER, 0, 1), sealed)); // a piece moved
  assert.throws(() => open(KEY, nonce(FROM_PHONE, 0, 0), sealed)); // reflected back
  const other = KEY.slice();
  other[0] ^= 1;
  assert.throws(() => open(other, nonce(FROM_COMPUTER, 0, 0), sealed));
  const changed = sealed.slice();
  changed[5] ^= 0x80;
  assert.throws(() => open(KEY, nonce(FROM_COMPUTER, 0, 0), changed));
  // An empty file's one piece is the tag alone.
  const empty = seal(KEY, nonce(FROM_PHONE, 2, 0), new Uint8Array(0));
  assert.equal(empty.length, 16);
  assert.deepEqual(open(KEY, nonce(FROM_PHONE, 2, 0), empty), new Uint8Array(0));
});

test("interop vector shared with phone.rs: \"Puhu\", key 00..1f, nonce 0,0,0,0, 0,0,0,2, 0,0,0,3", () => {
  const sealed = seal(KEY, Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3]), new TextEncoder().encode("Puhu"));
  assert.equal(hex(sealed), "f46596f10ce562862463ffe11de359e591c4913d");
  assert.equal(new TextDecoder().decode(open(KEY, nonce(FROM_COMPUTER, 2, 3), sealed)), "Puhu");
});

test("the cipher is RFC 8439's ChaCha20-Poly1305 (§2.8.2 test vector)", () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i);
  const iv = fromHex("07000000 4041424344454647");
  const aad = fromHex("50515253 c0c1c2c3c4c5c6c7");
  const plain = new TextEncoder().encode(
    "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
  );
  const ciphertext =
    "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b" +
    "1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc" +
    "3ff4def08e4b7a9de576d26586cec64b6116";
  const tag = "1ae10b594f09e26a7e902ecbd0600691";
  assert.equal(hex(chacha20poly1305(key, iv, aad).encrypt(plain)), ciphertext + tag);
  assert.deepEqual(chacha20poly1305(key, iv, aad).decrypt(fromHex(ciphertext + tag)), plain);
});

test("noble and OpenSSL (node:crypto) seal alike, as noble and ring must", () => {
  for (const size of [0, 1, 63, 64, 65, 4096, PIECE]) {
    const plain = randomBytes(size);
    const iv = nonce(FROM_PHONE, size, 7);
    const c = createCipheriv("chacha20-poly1305", KEY, iv, { authTagLength: 16 });
    const theirs = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
    assert.equal(hex(seal(KEY, iv, plain)), theirs.toString("hex"), `${size} bytes`);
    assert.deepEqual(Buffer.from(open(KEY, iv, theirs)), plain);
  }
});

test("the list and a description travel as sealed JSON", () => {
  const list = { files: [{ name: "Ödev — final.pdf", size: 1234 }, { name: "a.txt", size: 0 }] };
  const sealed = sealJson(KEY, nonce(FROM_COMPUTER, ALL, 0), list);
  assert.deepEqual(parseList(openJson(KEY, nonce(FROM_COMPUTER, ALL, 0), sealed)), list.files);
  assert.throws(() => openJson(KEY, nonce(FROM_PHONE, ALL, 0), sealed));
  const description = sealJson(KEY, nonce(FROM_PHONE, 0, ALL), { name: "IMG_0001.HEIC", size: 2_000_000 });
  assert.deepEqual(openJson(KEY, nonce(FROM_PHONE, 0, ALL), description), { name: "IMG_0001.HEIC", size: 2_000_000 });
});

test("a list that is not one is refused", () => {
  for (const bad of [null, 3, "x", {}, { files: [] }, { files: {} }, { files: [null] }, { files: [{ name: "a" }] },
    { files: [{ name: 1, size: 1 }] }, { files: [{ name: "a", size: -1 }] }, { files: [{ name: "a", size: 1.5 }] },
    { files: [{ name: "a", size: "1" }] }, { files: [{ name: "a", size: 2 ** 60 }] }]) {
    assert.equal(parseList(bad), null, JSON.stringify(bad));
  }
  // Only the name and the size are kept.
  assert.deepEqual(parseList({ files: [{ name: "a", size: 1, path: "C:\\x" }] }), [{ name: "a", size: 1 }]);
});

// ── Requests ──────────────────────────────────────────────────────────────────

test("403 means another phone, 404 and 410 the end; nothing else stops the page", () => {
  assert.equal(refusal(403)?.why, "otherPhone");
  assert.equal(refusal(404)?.why, "ended");
  assert.equal(refusal(410)?.why, "ended");
  for (const status of [200, 204, 400, 408, 413, 429, 500, 503]) assert.equal(refusal(status), null);
});

test("a failed request is tried again up to 3 more times, a refused one never", async () => {
  const waits = [];
  const wait = async (ms) => void waits.push(ms);
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error("network"); }, wait), /network/);
  assert.equal(calls, 1 + RETRIES);
  assert.deepEqual(waits, [500, 1000, 2000]);

  calls = 0;
  assert.equal(await retry(async () => (++calls < 3 ? Promise.reject(new Error("x")) : "ok"), wait), "ok");
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Refused("ended"); }, wait), Refused);
  assert.equal(calls, 1);
});

// ── Words ─────────────────────────────────────────────────────────────────────

test("the page's words come from its JSON, English for any it leaves out", () => {
  const s = readStrings(JSON.stringify({ download: "İndir", saved: 5, sent: " ", nope: "x" }));
  assert.equal(s.download, "İndir");
  assert.equal(s.saved, "Saved");
  assert.equal(s.sent, "Sent");
  assert.equal("nope" in s, false);
  assert.deepEqual(readStrings("not json"), EN);
  assert.deepEqual(readStrings(null), EN);
  assert.deepEqual(readStrings("[1,2]"), EN);
  assert.equal(EN.sending, "Sending\u2026");
});

test("sizes read in the page's language, counted in 1024s like the limit", () => {
  assert.equal(fmtSize(0, "en"), "0 byte");
  assert.equal(fmtSize(1536, "en"), "1.5 kB");
  assert.equal(fmtSize(1048576, "en"), "1 MB");
  assert.equal(fmtSize(MAX_SIZE, "en"), "500 MB");
  assert.equal(fmtSize(3.25 * 1024 ** 3, "en"), "3.3 GB");
  assert.equal(fmtSize(1.5 * 1048576, "tr"), "1,5 MB");
  assert.match(fmtSize(1.5 * 1048576, "fr"), /^1,5\sMo$/); // French's narrow no-break space
  assert.equal(fmtSize(1.5 * 1048576, "not a language!"), "1.5 MB");
});

// ── The built files ───────────────────────────────────────────────────────────

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("src-tauri/phone/ is up to date with src/phone-page (run npm run phone-page)", async () => {
  for (const [name, text] of Object.entries(await phonePage())) {
    assert.equal(read(join(OUT, name)), text.replace(/\r\n/g, "\n"), `src-tauri/phone/${name} is stale`);
  }
  const js = read(join(OUT, "page.js"));
  assert.match(js, /^\/\/ Generated by scripts\/phone-page\.mjs/);
  assert.match(js, /noble-ciphers - MIT License/); // the library's notice travels with it
  // ASCII only: the script and the style read the same whatever charset they are served with.
  assert.doesNotMatch(js, /[^\x00-\x7f]/);
  assert.doesNotMatch(read(join(OUT, "page.css")), /[^\x00-\x7f]/);
});

test("the template fits phone.rs's fill-in and the page's CSP", () => {
  const html = read(join(ROOT, "src/phone-page/page.html"));
  for (const slot of ["{{lang}}", "{{dir}}", "{{token}}", "{{mode}}", "{{strings}}"]) assert.ok(html.includes(slot), slot);
  assert.deepEqual([...new Set(html.match(/\{\{\w+\}\}/g))].sort(), ["{{dir}}", "{{lang}}", "{{mode}}", "{{strings}}", "{{token}}"]);
  assert.ok(html.includes('<link rel="stylesheet" href="/t/{{token}}/a.css">'));
  assert.ok(html.includes('<script defer src="/t/{{token}}/a.js"></script>'));
  assert.ok(html.includes('<script type="application/json" id="strings">{{strings}}</script>'));
  // CSP: default-src 'none'; script-src 'self'; style-src 'self'; img-src data:.
  assert.doesNotMatch(html, /<style/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  for (const tag of html.match(/<script[^>]*>/g)) assert.match(tag, /\ssrc="\/t\/\{\{token\}\}\/a\.js"|type="application\/json"/);
  for (const url of html.match(/\s(?:href|src)="[^"]*"/g)) assert.match(url, /="(?:\/t\/\{\{token\}\}\/a\.(?:js|css)|data:)/);
  // Filled the way phone.rs fills it: the words come back out whole, `<` escaped.
  const words = { ...EN, ended: "</script><b>x</b> bitti" };
  const filled = html
    .replaceAll("{{lang}}", "tr").replaceAll("{{dir}}", "ltr").replaceAll("{{mode}}", "send")
    .replaceAll("{{token}}", "AAAAAAAAAAAAAAAAAAAAAA")
    .replaceAll("{{strings}}", JSON.stringify(words).replace(/</g, "\\u003c"));
  const json = filled.match(/<script type="application\/json" id="strings">([^<]*)<\/script>/)[1];
  assert.equal(readStrings(json).ended, "</script><b>x</b> bitti");
});
