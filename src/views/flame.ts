// Focus play's flame, drawn in code: an outer flame in the streak's colour (orange,
// blue from 30 days, purple from 100, a turning rainbow from 365: core/progress.ts
// flameTier) and a pale core. Used by the island's moments, beside a running
// Pomodoro, on its card and as the evening ember.

import type { FlameTier } from "../core/progress";

const NS = "http://www.w3.org/2000/svg";
const OUTER = "M12 2.6c.5 2.5 2.2 4.1 3.7 5.8 1.6 1.8 3 3.7 3 6.4a6.7 6.7 0 0 1-13.4 0c0-2.5 1.1-4.3 2.5-5.6.3 1.6 1.1 2.8 2.3 3.3-.3-3.5.6-6.7 1.9-9.9z";
const CORE = "M12 12.6c1.2 1.1 2.3 2.3 2.3 3.8a2.3 2.3 0 0 1-4.6 0c0-1.5 1.1-2.7 2.3-3.8z";

/** A shield that keeps the streak through a missed day. */
export const SHIELD_ICON = "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z";
/** Feathers, focus play's currency; the egg the day's quests hatch. */
export const FEATHER_ICON = "M19.5 4.5C13 4.5 8 8.5 7 15l-2.5 4.5M19.5 4.5c0 6.5-4.5 11.5-11 12.5M19.5 4.5L9 15";
export const EGG_ICON = "M12 3c3.6 0 6.5 5.2 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.2 8.4 3 12 3z";

/** Each tier's colour, for the text beside the flame. */
export const FLAME_COLOR: Record<FlameTier, string> = {
  orange: "#ff8a3d",
  blue: "#5ac8fa",
  purple: "#b28dff",
  rainbow: "#ffd166",
};

/** A flame `size` px tall; `unlit` (the day's first round not done yet) is a pale outline of one. */
export function flame(tier: FlameTier, size: number, unlit = false): SVGSVGElement {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("class", `flame ${tier}${unlit ? " unlit" : ""}`);
  for (const [d, cls] of [[OUTER, "outer"], [CORE, "core"]]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    el.append(p);
  }
  return el;
}
