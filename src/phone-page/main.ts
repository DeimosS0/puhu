// The page a phone opens to take files from Puhu, or to hand him some
// (docs/send-to-phone.md, "Protocol (v1)"). src-tauri/src/phone.rs serves it from
// page.html, filling {{lang}}, {{dir}}, {{token}}, {{mode}} ("send" | "receive") and
// {{strings}} (EN below, translated); scripts/phone-page.mjs bundles this file into
// src-tauri/phone/page.js. Plain http, so no WebCrypto: @noble/ciphers seals (wire.ts).

import {
  ALL, FROM_COMPUTER, FROM_PHONE, MAX_FILES, MAX_SIZE, Refused, keyFromHash, nonce, open, openJson,
  parseList, pieceBounds, pieceCount, refusal, retry, seal, sealJson, type Entry,
} from "./wire";

/** The page's words by id, in English: what stands in for any {{strings}} leaves out. */
export const EN = {
  title: "Puhu",
  sendHeading: "Files from your computer",
  receiveHeading: "Send to your computer",
  download: "Download",
  saved: "Saved",
  choose: "Choose files",
  sending: "Sending…",
  sent: "Sent",
  tooBig: "Too big: 500 MB at most.",
  tooMany: "20 files at most.",
  otherPhone: "This link was opened on another phone.",
  ended: "This link has ended. Scan a new code on your computer.",
  failed: "Something went wrong. Try again.",
  noKey: "Open this page by scanning the code on your computer.",
  allSaved: "All saved. You can close this page.",
};

export type Strings = typeof EN;

/** The words from the page's JSON, each missing or empty one in English. */
export function readStrings(json: string | null | undefined): Strings {
  let given: unknown = null;
  try {
    given = JSON.parse(json || "");
  } catch {
    // Not JSON: English throughout.
  }
  const out = { ...EN };
  if (given && typeof given === "object") {
    for (const id of Object.keys(EN) as (keyof Strings)[]) {
      const text = (given as Record<string, unknown>)[id];
      if (typeof text === "string" && text.trim()) out[id] = text;
    }
  }
  return out;
}

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"];
const SHORT = ["B", "KB", "MB", "GB"];

/** A file's size in the page's language, counted in 1024s like the 500 MB limit. */
export function fmtSize(bytes: number, lang: string): string {
  let u = 0;
  let v = bytes;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = u === 0 || v >= 100 ? 0 : 1;
  try {
    return new Intl.NumberFormat(lang || undefined, {
      style: "unit", unit: UNITS[u], unitDisplay: "short", maximumFractionDigits: digits,
    }).format(v);
  } catch {
    const p = 10 ** digits;
    return `${Math.round(v * p) / p} ${SHORT[u]}`;
  }
}

// ── The page ──────────────────────────────────────────────────────────────────

type Row = { li: HTMLLIElement; status: HTMLSpanElement; bar: HTMLDivElement; fill: HTMLElement };
type Item = Entry & { i: number; row: Row; button: HTMLButtonElement; blob: Blob | null; state: "wait" | "fetching" | "ready" | "saved" | "failed" };
type Job = { file: File; i: number; row: Row };

/** Opened files waiting for their Download tap: past this, the next waits for a save (phones' memory). */
const HOLD = 256 * 1048576;

let s = EN;
let lang = "en";
let base = "";
let key: Uint8Array = new Uint8Array(0);
let stopped = false;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function say(text: string, kind = "") {
  const note = $("note");
  note.textContent = text;
  note.className = `note ${kind}`;
  note.hidden = false;
}

/** Ends the page's work: another phone, the session over, or the list never came. */
function stop(e: unknown) {
  if (stopped) return;
  stopped = true;
  say(e instanceof Refused ? s[e.why] : s.failed, "err");
  for (const c of document.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) c.disabled = true;
  $("pick").classList.add("off");
}

async function req(method: string, path: string, body?: Uint8Array): Promise<Uint8Array> {
  const res = await fetch(base + path, {
    method, body: body as Uint8Array<ArrayBuffer> | undefined, credentials: "same-origin", cache: "no-store",
  });
  const refused = refusal(res.status);
  if (refused) throw refused;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function addRow(name: string, size: number): Row {
  const li = el("li", "file");
  const info = el("div", "info");
  const meta = el("p", "meta");
  const status = el("span", "status");
  meta.append(el("span", "", fmtSize(size, lang)), status);
  const title = el("p", "name", name);
  title.dir = "auto"; // a Latin name on an Arabic page keeps its own order, and back
  info.append(title, meta);
  const bar = el("div", "bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = el("i");
  bar.append(fill);
  li.append(info, bar);
  $("files").append(li);
  return { li, status, bar, fill };
}

function progress(row: Row, part: number) {
  row.bar.classList.add("on");
  row.bar.setAttribute("aria-valuenow", String(Math.round(part * 100)));
  // CSSOM, not a style attribute: the CSP allows it.
  row.fill.style.transform = `scaleX(${part})`;
}

function settle(row: Row, text: string, kind = "") {
  row.bar.classList.remove("on");
  row.status.textContent = text;
  row.status.className = `status ${kind}`;
}

// ── Computer → phone ──────────────────────────────────────────────────────────

let items: Item[] = [];
let fetching = false;

async function sendMode() {
  let list: Entry[] | null;
  try {
    list = parseList(await retry(async () => openJson(key, nonce(FROM_COMPUTER, ALL, 0), await req("GET", "/m"))));
  } catch (e) {
    stop(e);
    return;
  }
  if (!list) {
    stop(null);
    return;
  }
  items = list.map((f, i) => {
    const row = addRow(f.name, f.size);
    const button = el("button", "btn", s.download);
    button.type = "button";
    button.disabled = true;
    row.li.insertBefore(button, row.bar);
    const item: Item = { ...f, i, row, button, blob: null, state: "wait" };
    button.addEventListener("click", () => tap(item));
    return item;
  });
  void pump();
}

/** Opens the files one after another, ahead of the taps, so each save runs inside its tap. */
async function pump() {
  if (fetching || stopped) return;
  const next = items.find((x) => x.state === "wait");
  if (!next) return;
  const held = items.reduce((sum, x) => sum + (x.state === "ready" ? x.size : 0), 0);
  if (held > 0 && held + next.size > HOLD) return;
  fetching = true;
  next.state = "fetching";
  settle(next.row, "");
  try {
    next.blob = await fetchFile(next);
    next.state = "ready";
    settle(next.row, "");
  } catch (e) {
    if (e instanceof Refused) stop(e);
    next.state = "failed";
    settle(next.row, stopped ? "" : s.failed, "err");
  }
  next.button.disabled = stopped;
  fetching = false;
  void pump();
}

async function fetchFile(x: Item): Promise<Blob> {
  const n = pieceCount(x.size);
  const parts: Blob[] = [];
  progress(x.row, 0);
  for (let p = 0; p < n; p++) {
    const [from, to] = pieceBounds(x.size, p);
    const plain = await retry(async () => {
      const out = open(key, nonce(FROM_COMPUTER, x.i, p), await req("GET", `/f/${x.i}/${p}`));
      if (out.length !== to - from) throw new Error("piece length");
      return out;
    });
    // A Blob per piece lets the browser let go of the bytes in the JS heap.
    parts.push(new Blob([plain as Uint8Array<ArrayBuffer>]));
    progress(x.row, (p + 1) / n);
  }
  return new Blob(parts, { type: "application/octet-stream" });
}

function tap(x: Item) {
  if (stopped) return;
  if (x.state === "failed") {
    x.state = "wait";
    x.button.disabled = true;
    void pump();
    return;
  }
  if (x.state !== "ready" || !x.blob) return;
  saveBlob(x.blob, x.name);
  x.blob = null;
  x.state = "saved";
  x.button.disabled = true;
  x.button.textContent = s.saved;
  x.button.classList.add("done");
  void pump();
  if (items.every((y) => y.state === "saved")) void finish();
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = el("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // iOS asks "Download?" first and reads the Blob only then: give it time.
  setTimeout(() => URL.revokeObjectURL(url), 40000);
}

async function finish() {
  say(s.allSaved, "ok");
  document.body.classList.add("glad");
  try {
    await retry(() => req("POST", "/done", new Uint8Array(0)));
  } catch {
    // Saved all the same; the session ends by its clock.
  }
}

// ── Phone → computer ──────────────────────────────────────────────────────────

const queue: Job[] = [];
let numbered = 0;
let sending = false;

function receiveMode() {
  const pick = $("pick");
  const input = $("input") as HTMLInputElement;
  $("choose").textContent = s.choose;
  pick.hidden = false;
  input.addEventListener("change", () => {
    const chosen = Array.from(input.files || []);
    input.value = "";
    if (stopped) return;
    for (const file of chosen) {
      const row = addRow(file.name, file.size);
      if (file.size > MAX_SIZE) settle(row, s.tooBig, "err");
      else if (numbered >= MAX_FILES) settle(row, s.tooMany, "err");
      else queue.push({ file, i: numbered++, row });
    }
    if (numbered >= MAX_FILES) {
      input.disabled = true;
      pick.classList.add("off");
    }
    void drain();
  });
}

async function drain() {
  if (sending) return;
  sending = true;
  for (let job = queue.shift(); job && !stopped; job = queue.shift()) {
    try {
      await upload(job);
      settle(job.row, s.sent, "ok");
    } catch (e) {
      if (e instanceof Refused) stop(e);
      settle(job.row, stopped ? "" : s.failed, "err");
    }
  }
  sending = false;
}

async function upload({ file, i, row }: Job) {
  settle(row, s.sending);
  progress(row, 0);
  const description = sealJson(key, nonce(FROM_PHONE, i, ALL), { name: file.name, size: file.size });
  await retry(() => req("POST", `/u/${i}`, description));
  const n = pieceCount(file.size);
  for (let p = 0; p < n; p++) {
    // One piece in memory at a time, never the whole file.
    const [from, to] = pieceBounds(file.size, p);
    const plain = new Uint8Array(await file.slice(from, to).arrayBuffer());
    if (plain.length !== to - from) throw new Error("the file changed");
    const sealed = seal(key, nonce(FROM_PHONE, i, p), plain);
    await retry(() => req("PUT", `/u/${i}/${p}`, sealed));
    progress(row, (p + 1) / n);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

function start() {
  s = readStrings($("strings")?.textContent);
  lang = document.documentElement.lang || "en";
  base = `/t/${document.body.dataset.token || ""}`;
  document.title = s.title;
  // iOS Safari shows :active (the buttons' press) only where touches are listened to.
  document.addEventListener("touchstart", () => {}, { passive: true });
  const receive = document.body.dataset.mode === "receive";
  $("heading").textContent = receive ? s.receiveHeading : s.sendHeading;
  const k = keyFromHash(location.hash);
  if (!k) {
    say(s.noKey, "err");
    return;
  }
  key = k;
  if (receive) receiveMode();
  else void sendMode();
}

// Tests import this file in Node, where there is no page.
if (typeof document !== "undefined") start();
