// Puhu's progress, replayed from the facts in the progress log
// (src-tauri/src/progress.rs): points, the level, the streak and its shields,
// today's goal, the day's quests and egg, the feathers. Pure: the same log always
// gives the same state, so a rule can change and everything is recomputed from
// history. What the rules are and why: docs/gamification.md.

import { POTION_MS, QUEST_FEATHERS, QUEST_POINTS, eggFor, questsFor, type DayFacts, type EggReward, type QuestDef } from "./quests";

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** A day runs from 04:00 to 04:00: a round at 01:00 belongs to the evening before. */
const DAY_STARTS_H = 4;
/** Rounds a day, until the person picks their own goal. */
export const DEFAULT_GOAL = 2;
/** A focus round counts when this much of it ran while the computer was awake. */
const COUNTS_FROM = 0.9;
/** 25 minutes of focus is 10 points, 50 minutes is 20. */
const POINTS_PER_MINUTE = 0.4;
const BREAK_POINTS = 2;
const GOAL_POINTS = 5;
/** Past this many rounds in a day, a round is worth half: rest matters too. */
const FULL_ROUNDS = 8;
/** A shield for every 7 days of streak, at most 2 carried. */
const SHIELD_EVERY = 7;
export const MAX_SHIELDS = 2;
/** Streak lengths celebrated bigger than the other days. */
export const MILESTONES: readonly number[] = [3, 7, 14, 30, 50, 100, 200, 365];
/** Feathers for each level reached and each streak milestone. */
const LEVEL_FEATHERS = 10;
const MILESTONE_FEATHERS = 10;

/** The facts in the log, as the island writes them (`at` is when it happened, ms). */
export type ProgressEvent =
  | { v: 1; kind: "focus"; at: number; start: number; minutes: number; ran: number }
  | { v: 1; kind: "break"; at: number; minutes: number }
  | { v: 1; kind: "goal"; at: number; rounds: number }
  | { v: 1; kind: "badge"; at: number; id: string; tier: number }
  | { v: 1; kind: "claude"; at: number }
  | { v: 1; kind: "spend"; at: number; item: string; price: number };

/** What the badges ask of the history (core/badges.ts). */
export interface ProgressStats {
  rounds: number;
  /** Minutes of focus in the rounds that counted. */
  minutes: number;
  /** The longest streak there has been. */
  bestStreak: number;
  breaks: number;
  /** Days the goal was reached, and the most of them in a row. */
  goalDays: number;
  goalRun: number;
  /** The most rounds in one day, and in a row (each begun within 20 minutes of the last). */
  dayRounds: number;
  chain: number;
  /** A round finished between 04:00 and 08:00; between midnight and 04:00 (1 or 0). */
  early: number;
  night: number;
}

/** Rounds closer than this are in a row: a break, a long one, and a moment to start again. */
const CHAIN_GAP = 20 * MINUTE;

export interface ProgressState {
  points: number;
  level: number;
  /** Points into this level, and how many the level takes. */
  into: number;
  size: number;
  /** Focus rounds that counted, ever. */
  rounds: number;
  streak: number;
  best: number;
  shields: number;
  /** Days a shield kept the streak alive (see dayOf). */
  shielded: number[];
  today: {
    day: number;
    rounds: number;
    minutes: number;
    goal: number;
    met: boolean;
    /** The day's quests (core/quests.ts says what each asks), how far along, done. */
    quests: { id: string; target: number; value: number; done: boolean }[];
    /** All three quests done: what the egg held. */
    egg: EggReward | null;
  };
  /** Feathers to spend: earned (quests, eggs, levels, streak milestones) less what the shop took. */
  feathers: number;
  /** What the shop sold that stays (colours), by item id. */
  owned: string[];
  /** Double points until then (an egg's potion), ms; 0 when none. */
  potionUntil: number;
  /**
   * The race against one's own past (weeks from Monday 04:00): this week's points,
   * last week's by the same moment of its week, last week's whole and the week's before.
   */
  race: {
    points: number;
    pace: number;
    last: number;
    before: number;
    /** The last four weeks (as many as there have been) by this same moment of each, on average. */
    average: number;
    /** This week against that average (leagueOf); null before there is a past week to compare with. */
    league: League | null;
  };
  stats: ProgressStats;
  /** Every day with a fact, oldest first: its counted rounds and whether the goal was reached (the Nest's calendar). */
  days: { day: number; rounds: number; met: boolean }[];
  /** The badges earned (their highest tier), newest first. Facts in the log: never taken back. */
  badges: { id: string; tier: number; at: number }[];
}

interface Day extends DayFacts {
  goal: number;
  met: boolean;
  /** The goal the day began with, and its quests for it. */
  startGoal: number;
  quests: QuestDef[];
  questsDone: number;
  egg: EggReward | null;
  lastEnd: number;
  run: number;
}

/** The week a day belongs to, Monday first (day 0, 1 January 1970, was a Thursday). */
export function weekOf(day: number): number {
  return Math.floor((day + 3) / 7);
}

/** When a week begins: its Monday at 04:00, local time. */
function weekStart(week: number): number {
  const d = new Date((week * 7 - 3) * 24 * HOUR);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAY_STARTS_H).getTime();
}

/** The day a moment belongs to, as a whole number of days (local time, from 04:00). */
export function dayOf(ms: number): number {
  const d = new Date(ms - DAY_STARTS_H * HOUR);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / (24 * HOUR);
}

/** Level n takes 50 + 25·(n−1) points to go through. */
export function levelOf(points: number): { level: number; into: number; size: number } {
  let level = 1;
  let into = points;
  let size = 50;
  while (into >= size) {
    into -= size;
    level++;
    size = 50 + 25 * (level - 1);
  }
  return { level, into, size };
}

/** A fact the rules can use; anything else (a newer kind, a broken line) is passed over. */
function isEvent(e: unknown): e is ProgressEvent {
  if (typeof e !== "object" || e === null) return false;
  const x = e as Record<string, unknown>;
  const num = (k: string): boolean => typeof x[k] === "number" && Number.isFinite(x[k]);
  if (!num("at")) return false;
  switch (x.kind) {
    case "focus":
      return num("start") && num("minutes") && num("ran")
        && (x.minutes as number) > 0 && (x.minutes as number) <= 120
        // It can't have run longer than it lasted.
        && (x.ran as number) <= (x.at as number) - (x.start as number) + 1000;
    case "break":
      return num("minutes");
    case "goal":
      return Number.isInteger(x.rounds) && (x.rounds as number) >= 1 && (x.rounds as number) <= 12;
    case "badge":
      return typeof x.id === "string" && x.id.length <= 40 && Number.isInteger(x.tier) && (x.tier as number) >= 1 && (x.tier as number) <= 3;
    case "claude":
      return true;
    case "spend":
      return typeof x.item === "string" && x.item.length <= 40 && Number.isInteger(x.price) && (x.price as number) > 0;
    default:
      return false;
  }
}

export function replay(events: readonly unknown[], now: number): ProgressState {
  const facts = events.filter(isEvent).sort((a, b) => a.at - b.at);
  const days = new Map<number, Day>();
  let goal = DEFAULT_GOAL;
  let points = 0;
  const stats: ProgressStats = { rounds: 0, minutes: 0, bestStreak: 0, breaks: 0, goalDays: 0, goalRun: 0, dayRounds: 0, chain: 0, early: 0, night: 0 };
  const badges = new Map<string, { id: string; tier: number; at: number }>();
  let chain = 0;
  let lastEnd = -Infinity;
  let feathers = 0;
  let potionUntil = 0;
  /** Days an egg gave a shield on, and days one was bought (core/shop.ts). */
  const eggShields = new Set<number>();
  const boughtShields: number[] = [];
  const owned: string[] = [];
  let spent = 0;
  const thisWeek = weekOf(dayOf(now));
  // How far into its week now is: each past week is counted up to the same moment of its own.
  const offset = now - weekStart(thisWeek);
  const paces = [0, 0, 0, 0];
  const weekPoints = new Map<number, number>();
  const newDay = (key: number): Day => ({
    rounds: 0, minutes: 0, breaks: 0, chain: 0, early: 0, evening: 0, long: 0, claude: 0,
    goal, met: false, startGoal: goal, quests: questsFor(key, goal), questsDone: 0, egg: null, lastEnd: -Infinity, run: 0,
  });
  for (const e of facts) {
    if (e.kind === "spend") {
      spent += e.price;
      if (e.item === "shield") boughtShields.push(dayOf(e.at));
      else if (!owned.includes(e.item)) owned.push(e.item);
      continue;
    }
    if (e.kind === "badge") {
      if ((badges.get(e.id)?.tier ?? 0) < e.tier) badges.set(e.id, { id: e.id, tier: e.tier, at: e.at });
      continue;
    }
    if (e.kind === "goal") goal = e.rounds;
    const pointsBefore = points;
    const key = dayOf(e.at);
    const day = days.get(key) ?? newDay(key);
    days.set(key, day);
    day.goal = goal;
    if (e.kind === "claude") {
      day.claude++;
    } else if (e.kind === "focus") {
      if (e.ran < e.minutes * MINUTE * COUNTS_FROM) continue;
      day.rounds++;
      day.minutes += e.minutes;
      const earned = Math.round(e.minutes * POINTS_PER_MINUTE) * (e.at < potionUntil ? 2 : 1);
      points += day.rounds > FULL_ROUNDS ? Math.round(earned / 2) : earned;
      day.run = e.start - day.lastEnd <= CHAIN_GAP ? day.run + 1 : 1;
      day.lastEnd = e.at;
      day.chain = Math.max(day.chain, day.run);
      if (e.minutes >= 50) day.long = 1;
      chain = e.start - lastEnd <= CHAIN_GAP ? chain + 1 : 1;
      lastEnd = e.at;
      stats.chain = Math.max(stats.chain, chain);
      stats.dayRounds = Math.max(stats.dayRounds, day.rounds);
      const hour = new Date(e.at).getHours();
      if (hour < DAY_STARTS_H) stats.night = 1;
      else if (hour < 8) stats.early = 1;
      if (hour >= DAY_STARTS_H && hour < 10) day.early = 1;
      if (hour >= 18 || hour < DAY_STARTS_H) day.evening = 1;
    } else if (e.kind === "break" && day.breaks < day.rounds) {
      // A break earns only after a round of its own: skipping focus to farm breaks does not.
      day.breaks++;
      points += BREAK_POINTS;
    }
    if (!day.met && day.rounds >= day.goal) {
      day.met = true;
      points += GOAL_POINTS;
    }
    // The day's quests, as far as this fact took them; all three hatch its egg.
    const doneNow = day.quests.filter((q) => q.measure(day) >= q.target(day.startGoal)).length;
    if (doneNow > day.questsDone) {
      points += (doneNow - day.questsDone) * QUEST_POINTS;
      feathers += (doneNow - day.questsDone) * QUEST_FEATHERS;
      day.questsDone = doneNow;
      if (doneNow === day.quests.length && !day.egg) {
        day.egg = eggFor(key);
        if (day.egg.kind === "feathers") feathers += day.egg.n;
        else if (day.egg.kind === "shield") eggShields.add(key);
        else potionUntil = e.at + POTION_MS;
      }
    }
    const week = weekOf(key);
    weekPoints.set(week, (weekPoints.get(week) ?? 0) + points - pointsBefore);
    const back = thisWeek - week;
    if (back >= 1 && back <= paces.length && e.at <= weekStart(week) + offset) paces[back - 1] += points - pointsBefore;
  }

  const today = dayOf(now);
  let streak = 0;
  let best = 0;
  let shields = 0;
  const shielded: number[] = [];
  const done = [...days].filter(([, d]) => d.rounds > 0).map(([key]) => key);
  for (let d = Math.min(...done); d <= today; d++) {
    if (eggShields.has(d)) shields = Math.min(MAX_SHIELDS, shields + 1);
    for (const b of boughtShields) if (b === d) shields = Math.min(MAX_SHIELDS, shields + 1);
    if ((days.get(d)?.rounds ?? 0) > 0) {
      streak++;
      best = Math.max(best, streak);
      if (streak % SHIELD_EVERY === 0) shields = Math.min(MAX_SHIELDS, shields + 1);
    } else if (d === today) {
      // Today is not over yet: the streak waits for it.
    } else if (streak > 0 && shields > 0) {
      shields--;
      shielded.push(d);
    } else {
      streak = 0;
    }
  }

  stats.bestStreak = best;
  let run = 0;
  for (const key of [...days.keys()].sort((a, b) => a - b)) {
    const d = days.get(key)!;
    stats.rounds += d.rounds;
    stats.minutes += d.minutes;
    stats.breaks += d.breaks;
    if (!d.met) {
      // A day without the goal ends the run, unless it is today and still under way.
      if (key !== today) run = 0;
      continue;
    }
    stats.goalDays++;
    run = days.get(key - 1)?.met ? run + 1 : 1;
    stats.goalRun = Math.max(stats.goalRun, run);
  }

  const day = days.get(today) ?? newDay(today);
  const level = levelOf(points);
  feathers += (level.level - 1) * LEVEL_FEATHERS + MILESTONES.filter((m) => best >= m).length * MILESTONE_FEATHERS;
  feathers = Math.max(0, feathers - spent);
  const quests = day.quests.map((q) => {
    const target = q.target(day.startGoal);
    const value = Math.min(target, q.measure(day));
    return { id: q.id, target, value, done: value >= target };
  });
  return {
    points,
    ...level,
    rounds: stats.rounds,
    streak,
    best,
    shields,
    shielded,
    today: { day: today, rounds: day.rounds, minutes: day.minutes, goal, met: day.met, quests, egg: day.egg },
    feathers,
    owned,
    potionUntil,
    race: {
      points: weekPoints.get(thisWeek) ?? 0,
      pace: paces[0],
      ...raceAgainst(weekPoints.get(thisWeek) ?? 0, paces, facts.length > 0 ? thisWeek - weekOf(dayOf(facts[0].at)) : 0),
      last: weekPoints.get(thisWeek - 1) ?? 0,
      before: weekPoints.get(thisWeek - 2) ?? 0,
    },
    stats,
    days: [...days].sort(([a], [b]) => a - b).map(([day, d]) => ({ day, rounds: d.rounds, met: d.met })),
    badges: [...badges.values()].sort((a, b) => b.at - a.at),
  };
}

/** The flame's colour grows with the streak. */
export type FlameTier = "orange" | "blue" | "purple" | "rainbow";

export function flameTier(streak: number): FlameTier {
  return streak >= 365 ? "rainbow" : streak >= 100 ? "purple" : streak >= 30 ? "blue" : "orange";
}

/** What a new fact changed, for the island to celebrate in this order. */
export type Moment =
  | { kind: "shield" }
  | { kind: "streak"; from: number; to: number; milestone: boolean }
  | { kind: "goal" }
  | { kind: "level"; level: number }
  | { kind: "quest"; id: string; target: number }
  | { kind: "egg"; reward: EggReward }
  | { kind: "race"; last: number; before: number }
  | { kind: "badge"; id: string; tier: number };

/**
 * The moments between two states. The day's first round lights the flame, and if a
 * shield kept the streak alive since `shieldSeen` (the last shielded day already
 * told), it is told first: that is when the person is there to see it.
 */
export function moments(before: ProgressState, after: ProgressState, shieldSeen: number): Moment[] {
  const out: Moment[] = [];
  const sameDay = before.today.day === after.today.day;
  if (after.today.rounds > 0 && (!sameDay || before.today.rounds === 0)) {
    if (after.shielded.some((d) => d > shieldSeen)) out.push({ kind: "shield" });
    out.push({ kind: "streak", from: before.streak, to: after.streak, milestone: MILESTONES.includes(after.streak) });
  }
  if (after.today.met && !(sameDay && before.today.met)) out.push({ kind: "goal" });
  for (const q of after.today.quests) {
    const was = sameDay && before.today.quests.some((b) => b.id === q.id && b.done);
    if (q.done && !was) out.push({ kind: "quest", id: q.id, target: q.target });
  }
  if (after.today.egg && !(sameDay && before.today.egg)) out.push({ kind: "egg", reward: after.today.egg });
  // The week's first points: if last week beat the one before it, that is told now.
  const newWeek = weekOf(before.today.day) !== weekOf(after.today.day) || before.race.points === 0;
  if (newWeek && after.race.points > 0 && after.race.last > after.race.before) {
    out.push({ kind: "race", last: after.race.last, before: after.race.before });
  }
  if (after.level > before.level) out.push({ kind: "level", level: after.level });
  return out;
}

/**
 * The evening ember: a streak to keep, no round yet today, and the reminder's time
 * ("HH:MM", empty when off) passed on this day (which runs to 04:00).
 */
export function emberDue(state: ProgressState, now: number, reminder: string): boolean {
  const at = reminderAt(now, reminder);
  return at != null && now >= at && state.streak > 0 && state.today.rounds === 0;
}

/** When the reminder falls on the day `now` belongs to, ms; null when it is off. */
function reminderAt(now: number, reminder: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(reminder);
  if (!m) return null;
  const d = new Date(now - DAY_STARTS_H * HOUR);
  const h = Number(m[1]);
  // Past midnight, before the day turns: it belongs to the evening before.
  if (h < DAY_STARTS_H) d.setDate(d.getDate() + 1);
  d.setHours(h, Number(m[2]), 0, 0);
  return d.getTime();
}

/** The next moment the state can change with no new fact: the day turning, or the reminder. */
export function nextChange(now: number, reminder: string): number {
  const d = new Date(now - DAY_STARTS_H * HOUR);
  d.setDate(d.getDate() + 1);
  d.setHours(DAY_STARTS_H, 0, 0, 0);
  const at = reminderAt(now, reminder);
  return at != null && at > now ? Math.min(at, d.getTime()) : d.getTime();
}

/** Leagues against one's own past, lowest first. */
export const LEAGUES = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export type League = (typeof LEAGUES)[number];
/** Where each league begins: this week over the recent average. Gold is keeping up. */
const LEAGUE_FROM = [0, 0.6, 0.9, 1.1, 1.4];

/** This week's league against the average of the past weeks there have been (up to four) by the same moment. */
function raceAgainst(points: number, paces: number[], pastWeeks: number): { average: number; league: League | null } {
  const n = Math.min(paces.length, pastWeeks);
  const average = n > 0 ? paces.slice(0, n).reduce((a, b) => a + b, 0) / n : 0;
  return { average, league: leagueOf(points, average) };
}

export function leagueOf(points: number, average: number): League | null {
  if (average <= 0) return null;
  const ratio = points / average;
  let i = 0;
  while (i + 1 < LEAGUES.length && ratio >= LEAGUE_FROM[i + 1]) i++;
  return LEAGUES[i];
}
