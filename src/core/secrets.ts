// Puhu's surprises (docs/gamification.md, "Badges and easter eggs"): small things he does
// when something unusual happens, each one a secret badge the first time it is found.
// What counts as unusual is decided here, purely; the island reacts (Island.surprise)
// and focus play writes the badge (island/progress.ts awardSecret).

import { N_ } from "../i18n/i18n";

/** Every surprise there is to find, by id; its badge is "secret.<id>", and `found` says how it was. */
export const SECRETS: readonly { id: string; name: string; found: string }[] = [
  { id: "dizzy", name: N_("Dizzy"), found: N_("You poked him till he was dizzy") },
  { id: "friend", name: N_("Best friend"), found: N_("A thousand pokes") },
  { id: "answer", name: N_("The answer"), found: N_("The volume at exactly 42") },
  { id: "eleven", name: N_("This one goes to eleven"), found: N_("The volume at exactly 11") },
  { id: "shouting", name: N_("WHY ARE WE SHOUTING"), found: N_("Caps Lock, again and again") },
  { id: "paparazzi", name: N_("Paparazzi"), found: N_("A screenshot with him around") },
  { id: "noticed", name: N_("He noticed"), found: N_("You copied his name") },
  { id: "hello", name: N_("First program"), found: N_("You copied hello world") },
  { id: "danger", name: N_("Dangerous waters"), found: N_("You copied rm -rf") },
  { id: "mirror", name: N_("Mirror"), found: N_("You copied an owl") },
  { id: "wish", name: N_("Make a wish"), found: N_("Puhu at 11:11") },
  { id: "leet", name: N_("1337"), found: N_("Puhu at 13:37") },
  { id: "moon", name: N_("Full moon"), found: N_("A full moon's night") },
  { id: "konami", name: N_("Old school"), found: N_("The Konami code") },
  { id: "intime", name: N_("Just in time"), found: N_("The charger, under 5 %") },
  { id: "missed", name: N_("Missed you"), found: N_("Back after three days") },
  { id: "tinkerer", name: N_("Tinkerer"), found: N_("Settings, twenty times") },
  { id: "caught", name: N_("Caught you"), found: N_("The log, edited by hand") },
  { id: "april", name: N_("Upside down"), found: N_("1 April") },
  { id: "newyear", name: N_("Happy New Year"), found: N_("1 January") },
  { id: "programmer", name: N_("Programmer's Day"), found: N_("The 256th day of the year") },
  { id: "gamer", name: N_("Player two"), found: N_("Played a game while Puhu kept watch") },
];

/** Something copied that he knows. */
export function copiedSecret(text: string): string | null {
  const s = text.trim().toLowerCase();
  if (s === "puhu") return "noticed";
  if (/^hello,? world!?$/.test(s)) return "hello";
  if (/\brm\s+-(?:rf|fr)\b/.test(s)) return "danger";
  if (text.trim() === "🦉") return "mirror";
  return null;
}

/** A full moon tonight: within three quarters of a day of it (no network: the moon keeps time). */
export function isFullMoon(ms: number): boolean {
  const SYNODIC = 29.530588853;
  // A known new moon: 6 January 2000, 18:14 UTC.
  const days = ms / 86_400_000 - Date.UTC(2000, 0, 6, 18, 14) / 86_400_000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  return Math.abs(age - SYNODIC / 2) < 0.75;
}

/** A day of the year that is his to celebrate. */
export function dateSecret(ms: number): string | null {
  const d = new Date(ms);
  if (d.getMonth() === 3 && d.getDate() === 1) return "april";
  if (d.getMonth() === 0 && d.getDate() === 1) return "newyear";
  const dayOfYear = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86_400_000) + 1;
  return dayOfYear === 256 ? "programmer" : null;
}

/** Times of day that hold one (the moon only on a full moon's night). */
export const TIMED: readonly (readonly [number, number, string])[] = [
  [11, 11, "wish"],
  [13, 37, "leet"],
  [22, 0, "moon"],
];

/** The next timed one after `now`: when, and which. */
export function nextTimed(now: number): { at: number; id: string } {
  let best: { at: number; id: string } | null = null;
  for (const [h, m, id] of TIMED) {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    if (!best || d.getTime() < best.at) best = { at: d.getTime(), id };
  }
  return best!;
}

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** How far into the Konami code a key takes `at` keys in; the whole code is KONAMI.length. */
export function konamiStep(at: number, key: string): number {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === KONAMI[at]) return at + 1;
  // An up too many still leaves the last two: the code goes on from there.
  if (k === KONAMI[0]) return at === 2 ? 2 : 1;
  return 0;
}

export const KONAMI_LENGTH = KONAMI.length;
