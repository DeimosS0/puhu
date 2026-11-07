// Focus play's badges and Puhu's titles (docs/gamification.md): what each badge asks of
// the history the progress log replays to (core/progress.ts ProgressStats). Tiered
// badges go bronze, silver, gold. A badge earned is written to the log as a fact of its
// own (island/progress.ts), so it is never taken back, even if a rule changes later;
// a new badge can still be earned for what was done before it existed.

import { N_, t, tn } from "../i18n/i18n";
import type { ProgressState, ProgressStats } from "./progress";
import { SECRETS } from "./secrets";

export interface BadgeDef {
  id: string;
  name: string;
  /** What earns a tier, from its threshold. */
  hint: (n: number) => string;
  /** A 24-unit outline icon. */
  icon: string;
  /** The tiers' thresholds of `measure`, lowest first; one entry for a badge without tiers. */
  tiers: readonly number[];
  measure: (s: ProgressStats) => number;
  /** Found by doing something unusual (core/secrets.ts), never by the stats. */
  secret?: boolean;
}

export const BADGES: readonly BadgeDef[] = [
  {
    id: "streak", name: N_("On fire"), tiers: [3, 7, 30], measure: (s) => s.bestStreak,
    hint: (n) => tn("A streak of {count} day", "A streak of {count} days", n),
    icon: "M12 2.6c.5 2.5 2.2 4.1 3.7 5.8 1.6 1.8 3 3.7 3 6.4a6.7 6.7 0 0 1-13.4 0c0-2.5 1.1-4.3 2.5-5.6.3 1.6 1.1 2.8 2.3 3.3-.3-3.5.6-6.7 1.9-9.9z",
  },
  {
    id: "rounds", name: N_("Focused"), tiers: [10, 100, 500], measure: (s) => s.rounds,
    hint: (n) => tn("{count} focus round", "{count} focus rounds", n),
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 1 0 0-8z",
  },
  {
    id: "goals", name: N_("Goal getter"), tiers: [5, 30, 100], measure: (s) => s.goalDays,
    hint: (n) => tn("The daily goal on {count} day", "The daily goal on {count} days", n),
    icon: "M8 12.4l2.7 2.7L16 9.8M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z",
  },
  {
    id: "week", name: N_("Perfect week"), tiers: [7], measure: (s) => s.goalRun,
    hint: () => t("The daily goal 7 days in a row"),
    icon: "M5 6h14v13H5zM5 10h14M9 4v4M15 4v4",
  },
  {
    id: "marathon", name: N_("Marathon"), tiers: [4], measure: (s) => s.chain,
    hint: () => t("4 rounds in a row"),
    icon: "M4 8h8M4 12h6M4 16h4M14 6l6 6-6 6",
  },
  {
    id: "ultra", name: N_("Ultra"), tiers: [8], measure: (s) => s.dayRounds,
    hint: () => t("8 rounds in one day"),
    icon: "M13 3L5 13h6l-1 8 8-10h-6l1-8z",
  },
  {
    id: "breaks", name: N_("Break master"), tiers: [10, 50, 200], measure: (s) => s.breaks,
    hint: (n) => tn("{count} break taken", "{count} breaks taken", n),
    icon: "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M11 3v3",
  },
  {
    id: "early", name: N_("Early bird"), tiers: [1], measure: (s) => s.early,
    hint: () => t("A round done before 08:00"),
    icon: "M4 18h16M7 18a5 5 0 0 1 10 0M12 8v2M5.6 11.6l1.4 1.4M18.4 11.6L17 13",
  },
  {
    id: "night", name: N_("Night owl"), tiers: [1], measure: (s) => s.night,
    hint: () => t("A round done after midnight"),
    icon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  },
];

/** The secret badges, one for each surprise: hidden until found, so they hint at nothing. */
export const SECRET_BADGES: readonly BadgeDef[] = SECRETS.map((s) => ({
  id: `secret.${s.id}`,
  name: s.name,
  hint: () => t(s.found),
  icon: "M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z",
  tiers: [1],
  measure: () => 0,
  secret: true,
}));

/** Bronze, silver, gold; a badge without tiers is gold, a secret one violet. */
const TIER_COLORS = ["#d4925a", "#c9d1dc", "#ffd166"] as const;
const SECRET_COLOR = "#c084fc";

export function badgeDef(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id) ?? SECRET_BADGES.find((b) => b.id === id);
}

export function tierColor(def: BadgeDef, tier: number): string {
  if (def.secret) return SECRET_COLOR;
  return def.tiers.length === 1 ? TIER_COLORS[2] : TIER_COLORS[Math.min(3, Math.max(1, tier)) - 1];
}

/** The tier the stats reach: 0 none, then 1 to the number of tiers. */
export function tierOf(def: BadgeDef, stats: ProgressStats): number {
  const value = def.measure(stats);
  return def.tiers.filter((n) => value >= n).length;
}

/** Badges, or higher tiers of them, the history reaches and the log does not have yet. */
export function newBadges(state: ProgressState): { id: string; tier: number }[] {
  const out: { id: string; tier: number }[] = [];
  for (const def of BADGES) {
    const tier = tierOf(def, state.stats);
    const has = state.badges.find((b) => b.id === def.id)?.tier ?? 0;
    if (tier > has) out.push({ id: def.id, tier });
  }
  return out;
}

/** Puhu's title, from his level. */
const TITLES: readonly (readonly [number, string])[] = [
  [50, N_("Wise owl")],
  [30, N_("Sage")],
  [20, N_("Apprentice")],
  [10, N_("Night watch")],
  [5, N_("Fledgling")],
  [1, N_("Owlet")],
];

export function levelTitle(level: number): string {
  return TITLES.find(([from]) => level >= from)?.[1] ?? TITLES[TITLES.length - 1][1];
}
