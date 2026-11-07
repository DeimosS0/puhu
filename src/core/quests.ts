// Focus play's daily quests (docs/gamification.md): three a day, picked from a pool by
// the day itself, so a day's quests are the same on every replay and every launch;
// their targets follow the goal the day began with. All three done hatch the day's
// egg: feathers mostly, sometimes a shield, now and then an hour of double points.
// Pure, like the rules that use it (core/progress.ts).

import { t, tn } from "../i18n/i18n";

/** What a day's facts add up to, for its quests. */
export interface DayFacts {
  rounds: number;
  minutes: number;
  breaks: number;
  /** The most rounds in a row that day. */
  chain: number;
  /** A round done before 10:00; one done from 18:00 to the day's end; a 50-minute one (1 or 0). */
  early: number;
  evening: number;
  long: number;
  /** Turns Claude finished that day (recorded only while this quest is open). */
  claude: number;
}

export interface QuestDef {
  id: string;
  /** How much of `measure` the quest asks on a day with this goal. */
  target: (goal: number) => number;
  measure: (d: DayFacts) => number;
  /** What it asks, with its target. */
  text: (n: number) => string;
  /** Only offered from a goal of this many rounds. */
  minGoal?: number;
}

export const QUESTS: readonly QuestDef[] = [
  { id: "rounds", target: (g) => Math.min(8, g + 1), measure: (d) => d.rounds, text: (n) => tn("Finish {count} round", "Finish {count} rounds", n) },
  { id: "minutes", target: (g) => (g === 1 ? 25 : g * 25 - 5), measure: (d) => d.minutes, text: (n) => tn("Focus for {count} minute", "Focus for {count} minutes", n) },
  { id: "breaks", target: (g) => Math.min(g, 2), measure: (d) => d.breaks, text: (n) => tn("Take {count} break", "Take {count} breaks", n) },
  { id: "early", target: () => 1, measure: (d) => d.early, text: () => t("A round before 10:00") },
  { id: "evening", target: () => 1, measure: (d) => d.evening, text: () => t("A round after 18:00") },
  { id: "chain", target: () => 2, measure: (d) => d.chain, text: () => t("Two rounds in a row"), minGoal: 2 },
  { id: "long", target: () => 1, measure: (d) => d.long, text: () => t("A 50-minute round"), minGoal: 2 },
  { id: "claude", target: () => 3, measure: (d) => d.claude, text: () => t("Finish 3 things with Claude") },
];

/** What each quest done is worth. */
export const QUEST_FEATHERS = 5;
export const QUEST_POINTS = 5;

/** A small, steady generator from a seed (mulberry32): the same day, the same picks. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** The day's three quests, for the goal it began with. */
export function questsFor(day: number, goal: number): QuestDef[] {
  const rand = seeded(day * 7919 + 17);
  const pool = QUESTS.filter((q) => (q.minGoal ?? 1) <= goal);
  const out: QuestDef[] = [];
  while (out.length < 3 && pool.length > 0) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

export type EggReward = { kind: "feathers"; n: number } | { kind: "shield" } | { kind: "potion" };

/** What the day's egg holds: feathers (10 to 25) two times in three, else a shield, now and then an hour of double points. */
export function eggFor(day: number): EggReward {
  const r = seeded(day * 104729 + 3)();
  if (r < 0.65) return { kind: "feathers", n: 10 + Math.floor((r / 0.65) * 16) };
  if (r < 0.85) return { kind: "shield" };
  return { kind: "potion" };
}

/** A potion's double points last this long from the egg. */
export const POTION_MS = 60 * 60_000;
