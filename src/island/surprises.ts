// The surprises tied to time (core/secrets.ts): 11:11, 13:37, a full moon's night, a
// day of the year that is Puhu's to celebrate, and coming back after days away. One
// timer waits for the next time of day; the days are looked at when Puhu starts and
// when the day turns. None of them comes over a full-screen app or a presentation.

import { Bridge } from "../core/bridge";
import { dayOf } from "../core/progress";
import { dateSecret, isFullMoon, nextTimed } from "../core/secrets";

export interface SurpriseHost {
  surprise(id: string): void;
}

/** When Puhu last ran, and the last day a date's surprise was had (conveniences of this install). */
const LAST_SEEN_KEY = "puhu.lastSeen";
const DATE_DONE_KEY = "puhu.surprise.dateDay";
const AWAY_MS = 3 * 86_400_000;
/** A time of day more than this late (the computer slept through it) has passed. */
const LATE_MS = 2 * 60_000;

function read(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function write(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not kept: at worst the surprise comes once more.
  }
}

async function quietly(host: SurpriseHost, id: string) {
  if (!(await Bridge.presenting())) host.surprise(id);
}

/** Today's date surprise, once a day. */
function checkDate(host: SurpriseHost) {
  const now = Date.now();
  const id = dateSecret(now);
  if (!id || read(DATE_DONE_KEY) === dayOf(now)) return;
  write(DATE_DONE_KEY, dayOf(now));
  void quietly(host, id);
}

function scheduleTimed(host: SurpriseHost) {
  const next = nextTimed(Date.now());
  window.setTimeout(() => {
    const now = Date.now();
    if (now - next.at < LATE_MS && (next.id !== "moon" || isFullMoon(now))) void quietly(host, next.id);
    // The day may have turned meanwhile: it may be a date to celebrate.
    checkDate(host);
    scheduleTimed(host);
  }, Math.max(1000, next.at - Date.now()));
}

/** Once the launch greeting is over. */
export function startSurprises(host: SurpriseHost) {
  const now = Date.now();
  const last = read(LAST_SEEN_KEY);
  write(LAST_SEEN_KEY, now);
  window.addEventListener("pagehide", () => write(LAST_SEEN_KEY, Date.now()));
  if (last > 0 && now - last >= AWAY_MS) void quietly(host, "missed");
  else checkDate(host);
  scheduleTimed(host);
}
