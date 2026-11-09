// The weekly sky (docs/weekly-card.md): a star for every half hour of real work and for
// every thing done, a title for how the week went. Pure: what it is given in, the week
// out; no DOM, no Tauri, so tests/sky.test.mjs runs it as it is.
//
// A half hour of the week is a time star when 20 minutes of it were covered by one of a
// focus round, an agent at work or (only if the user turned it on) work in a coding,
// design or writing program; it takes the colour of what covered it most, and nothing
// is counted twice. Each thing ticked on Today's list is a star of its own.

import type { RecapTurn } from "./summary";
import { addDays } from "./summary";

export type StarKind = "focus" | "code" | "design" | "writing" | "done";

export interface Star {
  /** 0 Monday … 6 Sunday. */
  day: number;
  /** The half hour of the day, 0 (00:00) … 47 (23:30). */
  slot: number;
  kind: StarKind;
  /** How much of its half hour was covered (0…1); 0.5 for a thing done. */
  strength: number;
}

export type SkyTitle =
  | "quiet" | "nightOwl" | "earlyBird" | "focusMaster" | "marathoner" | "everyDay" | "weekendHero" | "finisher" | "steady";

export interface WeekSky {
  weekStart: Date;
  weekEnd: Date;
  stars: Star[];
  timeStars: number;
  doneStars: number;
  /** Stars on each day, Monday first. */
  perDay: number[];
  /** The day with the most stars, or -1 for an empty sky. */
  brightest: number;
  title: SkyTitle;
  /** Minutes of work in the week (each half hour's most covered source, so none twice). */
  minutes: number;
  focusRounds: number;
  /** The longest run of time stars in a row on one day, in half hours. */
  longestRun: number;
}

/** A focus round as the progress log keeps it (ms): it ran `ran` before `at`. */
export interface FocusRound {
  at: number;
  ran: number;
}

/** Working time from activity.rs: a half hour's start (Unix s), minutes [code, design, writing]. */
export type WorkSlot = [number, [number, number, number]];

export interface SkyInput {
  weekStart: Date;
  turns: readonly RecapTurn[];
  focus: readonly FocusRound[];
  /** When each thing on Today's list was ticked (ms). */
  done: readonly number[];
  work: readonly WorkSlot[];
}

/** A half hour counts from this many minutes. */
export const STAR_MINUTES = 20;
const SLOTS = 48;

/** (day, slot) of a moment, in the week starting at `weekStart`; null outside it. */
function place(ms: number, weekStart: Date): { day: number; slot: number } | null {
  const d = new Date(ms);
  const day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - weekStart.getTime()) / 86_400_000);
  if (day < 0 || day > 6) return null;
  return { day, slot: d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0) };
}

/** Each minute of [from, to) in the week, counted once per source, into its half hour. */
function cover(minutes: Map<number, Set<number>>, from: number, to: number, weekStart: Date) {
  const startMinute = Math.floor(from / 60_000);
  const endMinute = Math.ceil(to / 60_000);
  for (let m = startMinute; m < endMinute; m++) {
    const at = place(m * 60_000, weekStart);
    if (!at) continue;
    const key = at.day * SLOTS + at.slot;
    if (!minutes.has(key)) minutes.set(key, new Set());
    minutes.get(key)!.add(m);
  }
}

export function weekSky(input: SkyInput): WeekSky {
  const { weekStart } = input;
  const end = addDays(weekStart, 7);
  const from = weekStart.getTime();
  const to = end.getTime();
  const within = (a: number, b: number) => b > from && a < to;

  // Minutes per half hour, per source; overlapping turns or rounds count once.
  const focus = new Map<number, Set<number>>();
  const agent = new Map<number, Set<number>>();
  let focusRounds = 0;
  for (const r of input.focus) {
    const start = r.at - Math.max(0, r.ran);
    if (!within(start, r.at)) continue;
    if (r.at >= from && r.at < to) focusRounds++;
    cover(focus, Math.max(start, from), Math.min(r.at, to), weekStart);
  }
  for (const t of input.turns) {
    const a = t.start * 1000;
    const b = t.end * 1000;
    if (b > a && within(a, b)) cover(agent, Math.max(a, from), Math.min(b, to), weekStart);
  }
  const work = new Map<number, [number, number, number]>();
  for (const [start, minutes] of input.work) {
    const at = place(start * 1000, weekStart);
    if (!at) continue;
    const key = at.day * SLOTS + at.slot;
    const had = work.get(key) ?? [0, 0, 0];
    work.set(key, [had[0] + minutes[0], had[1] + minutes[1], had[2] + minutes[2]].map((m) => Math.min(30, m)) as [number, number, number]);
  }

  const stars: Star[] = [];
  let minutes = 0;
  for (let key = 0; key < 7 * SLOTS; key++) {
    const w = work.get(key) ?? [0, 0, 0];
    const sources: [StarKind, number][] = [
      ["focus", focus.get(key)?.size ?? 0],
      ["code", Math.max(agent.get(key)?.size ?? 0, w[0])],
      ["design", w[1]],
      ["writing", w[2]],
    ];
    // What covered it most gives it its colour; a tie goes to the first (focus first).
    const [kind, covered] = sources.reduce((best, s) => (s[1] > best[1] ? s : best));
    minutes += Math.min(30, covered);
    if (covered >= STAR_MINUTES) {
      stars.push({ day: Math.floor(key / SLOTS), slot: key % SLOTS, kind, strength: Math.min(1, covered / 30) });
    }
  }
  const timeStars = stars.length;
  for (const ms of input.done) {
    const at = place(ms, weekStart);
    if (at) stars.push({ ...at, kind: "done", strength: 0.5 });
  }
  const doneStars = stars.length - timeStars;

  const perDay = [0, 0, 0, 0, 0, 0, 0];
  for (const s of stars) perDay[s.day]++;
  const top = Math.max(...perDay);
  const brightest = top > 0 ? perDay.indexOf(top) : -1;

  // The longest run of time stars in a row, on one day.
  let longestRun = 0;
  for (let day = 0; day < 7; day++) {
    let run = 0;
    for (let slot = 0; slot < SLOTS; slot++) {
      const lit = stars.some((s) => s.kind !== "done" && s.day === day && s.slot === slot);
      run = lit ? run + 1 : 0;
      longestRun = Math.max(longestRun, run);
    }
  }

  const sky: WeekSky = {
    weekStart, weekEnd: new Date(to - 1000), stars, timeStars, doneStars, perDay, brightest,
    title: "steady", minutes, focusRounds, longestRun,
  };
  sky.title = titleOf(sky);
  return sky;
}

/** How the week went, the first that fits (docs/weekly-card.md's table). */
export function titleOf(sky: { stars: Star[]; timeStars: number; doneStars: number; longestRun: number }): SkyTitle {
  const time = sky.stars.filter((s) => s.kind !== "done");
  const share = (test: (s: Star) => boolean) => (time.length > 0 ? time.filter(test).length / time.length : 0);
  const hour = (s: Star) => Math.floor(s.slot / 2);
  if (sky.timeStars < 6) return "quiet";
  if (share((s) => hour(s) >= 22 || hour(s) < 4) >= 0.35) return "nightOwl";
  if (share((s) => hour(s) >= 5 && hour(s) < 10) >= 0.35) return "earlyBird";
  if (share((s) => s.kind === "focus") >= 0.6) return "focusMaster";
  if (sky.longestRun >= 6) return "marathoner";
  if (new Set(time.map((s) => s.day)).size === 7) return "everyDay";
  if (share((s) => s.day >= 5) >= 0.4) return "weekendHero";
  if (sky.doneStars >= 15) return "finisher";
  return "steady";
}

// ── The weeks kept (a year of summaries, no hour in them) ──────────────────────

/** A week's summary, kept for a year: for "your fullest sky" and the year's card. */
export interface SkySummary {
  /** Monday, YYYY-MM-DD. */
  week: string;
  title: SkyTitle;
  stars: number;
  minutes: number;
  done: number;
}

/** Stored key: never rename it. */
export const SKIES_KEY = "puhu.skies";
const KEEP_WEEKS = 53;

export function readSkies(raw: string | null): SkySummary[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list)
      ? list.filter((s): s is SkySummary => s && typeof s.week === "string" && typeof s.stars === "number")
      : [];
  } catch {
    return [];
  }
}

/** The list with `summary` in its week's place, a year at most, oldest first. */
export function keepSky(list: readonly SkySummary[], summary: SkySummary): SkySummary[] {
  const others = list.filter((s) => s.week !== summary.week);
  return [...others, summary].sort((a, b) => a.week.localeCompare(b.week)).slice(-KEEP_WEEKS);
}

/**
 * Against the weeks before: "more" with how much more than last week, "best" for the
 * fullest sky of three weeks or more kept, otherwise nothing (a lighter week is never
 * pointed out).
 */
export function trend(
  stars: number,
  lastWeek: number | null,
  earlier: readonly SkySummary[],
): { kind: "best" } | { kind: "more"; percent: number } | null {
  if (stars > 0 && earlier.length >= 3 && earlier.every((s) => s.stars < stars)) return { kind: "best" };
  if (lastWeek && lastWeek > 0) {
    const percent = Math.round(((stars - lastWeek) / lastWeek) * 100);
    if (percent >= 5) return { kind: "more", percent };
  }
  return null;
}
