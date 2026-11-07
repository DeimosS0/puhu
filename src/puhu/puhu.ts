// Puhu, the character: one flat shape, two eyes.
// An owl only by its outline — a soft V on top of the head and two feather tufts
// flaring out from its corners — so it reads as one even at 20 px. The engine
// (engine.ts) runs his whole life (states, eyes, emotes, the dance); this file holds the
// body, its colour and where the eyes sit.

import type { RGB } from "./engine";

export type PuhuColor = "kar" | "gece" | "kum" | "gul" | "orman" | "altin";

/** Body and eye colours, components 0…1. Kar is the default; Kar and Gece are his own, the rest come from the feather shop (core/shop.ts). */
export const PUHU_COLORS: Record<PuhuColor, { body: RGB; ink: string }> = {
  kar: { body: [0.945, 0.953, 0.973], ink: "rgb(26,24,30)" },
  gece: { body: [0.224, 0.267, 0.62], ink: "rgb(234,236,250)" },
  kum: { body: [0.925, 0.851, 0.725], ink: "rgb(44,32,20)" },
  gul: { body: [0.976, 0.784, 0.84], ink: "rgb(62,22,38)" },
  orman: { body: [0.212, 0.42, 0.333], ink: "rgb(232,245,236)" },
  altin: { body: [0.98, 0.8, 0.36], ink: "rgb(52,34,8)" },
};

/** Their names, as the wardrobe shows them (his own words: not translated). */
export const PUHU_COLOR_NAMES: Record<PuhuColor, string> = {
  kar: "Kar", gece: "Gece", kum: "Kum", gul: "Gül", orman: "Orman", altin: "Altın",
};

const STORE_KEY = "puhu.color";

function read(): PuhuColor {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v && v in PUHU_COLORS) return v as PuhuColor;
  } catch {
    // No storage (a preview, a test): the default.
  }
  return "kar";
}

let current = read();
// The island, the desktop window and the pill share the choice: one changes it, all follow.
if (typeof window !== "undefined") {
  window.addEventListener?.("storage", (e) => {
    if (e.key === STORE_KEY) current = read();
  });
}

export function puhuColor(): PuhuColor {
  return current;
}

export function setPuhuColor(c: PuhuColor) {
  current = c;
  try {
    localStorage.setItem(STORE_KEY, c);
  } catch {
    // Not kept, still shown until the next start.
  }
}

/** Half-width and half-height of the body without its tufts, in R (the engine's unit). */
export const PUHU_RX = 0.86;
export const PUHU_RY = 0.88;
/** Where the eyes sit on the head (the engine's EYE_SP / EYE_P for Puhu). */
export const PUHU_EYE_SP = 0.38;
export const PUHU_EYE_P = 0.14;
/** Puhu's eyes are a little larger than the engine's base size. */
export const PUHU_EYE_SCALE = 1.18;

/** A colour's body, eyes and wings (the body a shade darker) as CSS. */
export function puhuCssOf(color: PuhuColor): { body: string; ink: string; wing: string } {
  const { body, ink } = PUHU_COLORS[color];
  const css = (k: number) => `rgb(${body.map((v) => Math.round(v * k * 255)).join(", ")})`;
  return { body: css(1), ink, wing: css(0.9) };
}

/** The current colours as CSS: the body, the eyes, the wings. */
export function puhuCss(): { body: string; ink: string; wing: string } {
  return puhuCssOf(current);
}

const angle = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const TOP = -Math.PI / 2;

/**
 * The outline's point at angle `a` (0 = right, π/2 = down), around the body's
 * centre, for a body of radius R. `up` raises the tufts (1 = at rest, 0.3 asleep,
 * 1.3 glad), `lean` (−1…1) bends them as the body moves, `turn` slides them the
 * way the head looks.
 */
export function puhuPoint(a: number, R: number, up: number, lean: number, turn: number): { x: number; y: number } {
  const s = Math.sin(a);
  const c = Math.cos(a);
  let x = R * PUHU_RX * c * (1 + 0.07 * s);
  let y = R * s * (s < 0 ? 0.86 : PUHU_RY) + R * 0.04;
  // The brow: the top dips softly between the tufts.
  const brow = angle(a, TOP + turn * 0.18) / 0.55;
  if (Math.abs(brow) < 1) y += R * 0.12 * Math.pow(1 - brow * brow, 2);
  // The tufts: narrow feathers flaring out from the corners.
  for (const side of [-1, 1]) {
    const d = angle(a, TOP + side * 0.8 + turn * 0.18) / 0.24;
    if (Math.abs(d) >= 1) continue;
    const b = 0.24 * up * Math.pow(1 - d * d, 2);
    x += R * b * (side * 0.95 + lean * 0.6);
    y -= R * b * 0.75;
  }
  return { x, y };
}

/** The outline as a path, at rest, for a body `R` (the greeting, the drop sequence). */
export function puhuPath(R: number, up = 1, lean = 0, turn = 0): Path2D {
  const p = new Path2D();
  for (let i = 0; i <= 96; i++) {
    const { x, y } = puhuPoint((i / 96) * Math.PI * 2, R, up, lean, turn);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}
