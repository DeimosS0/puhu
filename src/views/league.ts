// The race's leagues as the card and the Nest show them (core/progress.ts leagueOf):
// a name and a colour each, bronze to diamond.

import type { League } from "../core/progress";
import { t } from "../i18n/i18n";

export const LEAGUE_COLOR: Record<League, string> = {
  bronze: "#d4925a",
  silver: "#c9d1dc",
  gold: "#ffd166",
  platinum: "#7fe3d6",
  diamond: "#8fb8ff",
};

export function leagueName(l: League): string {
  switch (l) {
    case "bronze": return t("Bronze league");
    case "silver": return t("Silver league");
    case "gold": return t("Gold league");
    case "platinum": return t("Platinum league");
    case "diamond": return t("Diamond league");
  }
}
