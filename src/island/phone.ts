// Send to phone, and from it (src-tauri/src/phone.rs; docs/send-to-phone.md): the session
// as the island holds it. Dropped files go to a phone, or files come from one; first, on
// a Public network, the user says once whether it is theirs. The card is views/phone.ts.

import { Bridge, type PhoneNews, type PhoneStarted } from "../core/bridge";
import { State, type PhoneSession } from "../core/state";
import { t } from "../i18n/i18n";

/** What the session asks of the island. */
export interface PhoneHost {
  /** The card comes up, or changes. */
  show(): void;
  /** A phone opened the link. */
  connected(): void;
  /** Everything reached the phone, or a file came from it. */
  delivered(): void;
  /** Gone (cancelled, ran out, refused): the card says why, or goes. */
  ended(): void;
}

function fresh(mode: PhoneSession["mode"], stage: PhoneSession["stage"]): PhoneSession {
  return { mode, stage, url: "", qrSize: 0, qrBits: "", device: "", files: [], received: [], incoming: null, note: "", until: 0 };
}

function started(s: PhoneSession, at: PhoneStarted) {
  s.stage = "waiting";
  s.url = at.url;
  s.qrSize = at.qrSize;
  s.qrBits = at.qrBits;
  s.until = Date.now() + at.expires * 1000;
}

const reason = (err: unknown) => String(err).replace(/^Error:\s*/, "");

/**
 * Starts a session: the dropped files to a phone (`send`), or from one. On a Public
 * network not said to be the user's, the card asks first (`trust` then starts it).
 */
export async function startPhone(mode: PhoneSession["mode"], host: PhoneHost) {
  const paths = [...State.droppedPaths];
  const s = fresh(mode, "starting");
  if (mode === "send") s.files = paths.map((p) => ({ name: p.split(/[\\/]/).pop() ?? p, size: 0, done: 0 }));
  State.phone = s;
  host.show();
  const network = await Bridge.phoneNetwork();
  if (State.phone !== s) return;
  if (network?.state === "ask") {
    s.stage = "ask";
    host.show();
    return;
  }
  await begin(s, paths, host);
}

/** "Yes, it's mine": this network is trusted from now on, and the session starts. */
export async function trustAndStart(host: PhoneHost) {
  const s = State.phone;
  if (!s || s.stage !== "ask") return;
  await Bridge.phoneTrustNetwork();
  s.stage = "starting";
  host.show();
  await begin(s, [...State.droppedPaths], host);
}

async function begin(s: PhoneSession, paths: string[], host: PhoneHost) {
  try {
    const at = s.mode === "send" ? await Bridge.phoneSend(paths) : await Bridge.phoneReceive();
    if (State.phone !== s) {
      void Bridge.phoneCancel();
      return;
    }
    started(s, at);
  } catch (err) {
    if (State.phone !== s) return;
    s.stage = "error";
    s.note = reason(err);
  }
  host.show();
}

/** What phone.rs tells: a phone opened the link, bytes went or came, a file arrived. */
export function phoneNews(news: PhoneNews, host: PhoneHost) {
  const s = State.phone;
  if (!s) return;
  switch (news.state) {
    case "claimed":
      s.stage = "connected";
      s.device = news.device;
      host.connected();
      break;
    case "progress":
      if (s.mode === "send") {
        const f = s.files[news.file];
        if (f) {
          f.size = news.total;
          f.done = news.done;
        }
      } else {
        s.incoming = { done: news.done, total: news.total };
      }
      break;
    case "received":
      s.received.push(news.name);
      s.incoming = null;
      host.delivered();
      break;
    case "sent":
      s.stage = "done";
      for (const f of s.files) f.done = f.size;
      host.delivered();
      break;
    case "ended":
      if (s.stage === "done") break;
      if (news.reason === "cancelled" || news.reason === "replaced") {
        State.phone = null;
      } else if (news.reason === "expired") {
        s.stage = "ended";
        s.note = s.received.length > 0 ? "" : t("The code ran out of time.");
      } else if (news.reason !== "done") {
        s.stage = "ended";
        s.note = t("Something went wrong. Try again.");
      }
      host.ended();
      break;
  }
  host.show();
}

/** A session still under way: its card waits for the phone, or the user. */
export function phoneLive(): boolean {
  const stage = State.phone?.stage;
  return stage === "ask" || stage === "starting" || stage === "waiting" || stage === "connected";
}

/** The card's Cancel or Done: the session ends, the card goes. */
export function closePhone() {
  if (State.phone && State.phone.stage !== "done" && State.phone.stage !== "ended" && State.phone.stage !== "error") {
    void Bridge.phoneCancel();
  }
  State.phone = null;
}
