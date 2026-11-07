// The moment the badge toast shows (Island.showToast), read by its card
// (views/badgetoast.ts): a badge or a level just earned.

import type { Moment } from "../core/progress";

export const Toast = {
  moment: null as Moment | null,
  /** Bumped for each one, so the card rebuilds. */
  generation: 0,
};
