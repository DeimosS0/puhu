// Timers: "12 dk çay", "yumurta 7 dakika", "10 min pasta". Written as it comes, read into
// a length and what it is for; what it is for decides what Puhu holds while it runs (a
// tulip glass of tea darkening as it brews, an egg, a cup of coffee, an hourglass).
// Pure but for the store at the end (localStorage, so a timer outlives a reload or a
// restart: it is kept as the moment it ends).

export type TimerKind = "tea" | "coffee" | "egg" | "hourglass";

export interface TimerSpec {
  /** What it is for, as written ("çay"); empty when nothing but the length was. */
  label: string;
  seconds: number;
  kind: TimerKind;
}

export interface Timer extends TimerSpec {
  id: string;
  startedAt: number;
  endsAt: number;
}

/** Stored key: never rename it. */
export const TIMERS_KEY = "puhu.timers";
/** Longer than this is a day's plan, not a timer. */
const MAX_SECONDS = 12 * 3600;

// A number (12, 1.5, 1,5) and its unit, in Turkish and English. Longer units first.
const UNITS: [RegExp, number][] = [
  [/^(?:saniye|sn|sec(?:ond)?s?|s)$/, 1],
  [/^(?:dakika|dak|dk|d|min(?:ute)?s?|m|')$/, 60],
  [/^(?:saat|sa|hours?|hrs?|h)$/, 3600],
];
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(saniye|sn|seconds?|secs?|s|dakika|dak|dk|d|minutes?|mins?|m|'|saat|sa|hours?|hrs?|h)(?!\p{L})/giu;
/** Words that only say "in", "for", "a timer": dropped from the label. */
const FILLER = /(?<!\p{L})(?:sonra|için|icin|zamanlayıcı|zamanlayici|kur|timer|for|in|set|a|an)(?!\p{L})/giu;
const HALF_HOUR = /(?<!\p{L})(?:yarım saat|half an hour)(?!\p{L})/iu;

const KINDS: [RegExp, TimerKind][] = [
  [/(?<!\p{L})(?:çay|cay|tea|chai)/iu, "tea"],
  [/(?<!\p{L})(?:kahve|coffee|espresso|latte)/iu, "coffee"],
  [/(?<!\p{L})(?:yumurta|egg)/iu, "egg"],
];

function unitSeconds(unit: string): number {
  const u = unit.toLowerCase();
  return UNITS.find(([re]) => re.test(u))?.[1] ?? 0;
}

/** A timer when the text has a length in it ("12 dk", "1 saat 20 dk", "yarım saat"); else null. */
export function parseTimer(text: string): TimerSpec | null {
  let seconds = 0;
  let rest = text;
  if (HALF_HOUR.test(rest)) {
    seconds += 1800;
    rest = rest.replace(HALF_HOUR, " ");
  }
  rest = rest.replace(AMOUNT, (_, n: string, unit: string) => {
    seconds += Number(n.replace(",", ".")) * unitSeconds(unit);
    return " ";
  });
  seconds = Math.round(seconds);
  if (seconds <= 0 || seconds > MAX_SECONDS) return null;
  // A clock time ("14:00") is a plan for Today, not a length.
  if (/\d{1,2}[:.]\d{2}/.test(rest)) return null;
  const label = rest.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  return { label, seconds, kind: kindOf(label) };
}

export function kindOf(label: string): TimerKind {
  return KINDS.find(([re]) => re.test(label))?.[1] ?? "hourglass";
}

/** What is left, as the island shows it: "4:07", "1:02:07". */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** How far along it is, 0 at the start, 1 when it rings. */
export function progressOf(t: Timer, now: number): number {
  return Math.min(1, Math.max(0, (now - t.startedAt) / Math.max(1, t.endsAt - t.startedAt)));
}

// ── The store ────────────────────────────────────────────────────────────────

function read(): Timer[] {
  try {
    const list = JSON.parse(localStorage.getItem(TIMERS_KEY) ?? "[]") as Timer[];
    return Array.isArray(list) ? list.filter((t) => typeof t.endsAt === "number") : [];
  } catch {
    return [];
  }
}

function write(list: Timer[]) {
  try {
    localStorage.setItem(TIMERS_KEY, JSON.stringify(list));
  } catch {
    // Private mode or a full store: the timer still runs until Puhu closes.
  }
}

export const Timers = {
  /** Running and rung-but-not-dismissed timers, soonest first. */
  all(): Timer[] {
    return read().sort((a, b) => a.endsAt - b.endsAt);
  },
  start(spec: TimerSpec, now = Date.now()): Timer {
    const timer: Timer = { ...spec, id: `tm${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, startedAt: now, endsAt: now + spec.seconds * 1000 };
    write([...read(), timer]);
    return timer;
  },
  /** A few minutes more on one that rang (or is running). */
  extend(id: string, seconds: number, now = Date.now()) {
    write(read().map((t) => (t.id === id ? { ...t, startedAt: now, endsAt: Math.max(t.endsAt, now) + seconds * 1000 } : t)));
  },
  remove(id: string) {
    write(read().filter((t) => t.id !== id));
  },
};
