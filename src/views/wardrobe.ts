// Wardrobe view. Opened with a right-click on Puhu or from the tray menu. It holds
// his colours: Kar (the default) or Gece, and those bought with feathers in the
// Nest's shop (core/shop.ts). A click keeps one.

import { h } from "./dom";
import { PUHU_COLOR_NAMES, puhuColor, puhuCssOf, puhuPath, setPuhuColor, type PuhuColor } from "../puhu/puhu";
import { progress } from "../island/progress";
import { SHOP, shopColor } from "../core/shop";
import type { ViewActions, ViewHost } from "./views";
import { tl } from "../i18n/i18n";

const ICON = 28;
/** His own two, then the shop's in its order, once bought. */
function colors(): PuhuColor[] {
  const bought = SHOP.map((i) => shopColor(i.id)).filter((c): c is PuhuColor => c != null && progress.state.owned.includes(`color.${c}`));
  return ["kar", "gece", ...bought];
}

/** A small Puhu in `color`: his outline and two eyes, as the island draws him. */
function drawIcon(canvas: HTMLCanvasElement, color: PuhuColor) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(ICON * dpr);
  canvas.height = Math.round(ICON * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { body, ink } = puhuCssOf(color);
  const R = ICON * 0.36;
  ctx.setTransform(dpr, 0, 0, dpr, (ICON / 2) * dpr, (ICON / 2 + R * 0.06) * dpr);
  ctx.fillStyle = body;
  ctx.fill(puhuPath(R));
  ctx.fillStyle = ink;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * R * 0.31, -R * 0.12, R * 0.13, R * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function buildWardrobe(_actions: ViewActions): ViewHost {
  const note = h("span", { class: "wardrobe-note" });
  const grid = h("div", { class: "wardrobe-grid" });
  const items = new Map<PuhuColor, HTMLButtonElement>();
  let shown = "";
  /** The swatches, made again only when a colour was bought. */
  const fill = () => {
    items.clear();
    grid.replaceChildren();
    for (const color of colors()) {
      const name = PUHU_COLOR_NAMES[color];
      const canvas = h("canvas");
      const button = h(
        "button",
        { class: "wardrobe-item puhu-swatch", title: name, "aria-label": name },
        canvas,
        h("span", { text: name }),
      ) as HTMLButtonElement;
      button.addEventListener("click", () => {
        setPuhuColor(color);
        sync();
      });
      items.set(color, button);
      grid.append(button);
    }
    drawnDpr = 0;
  };
  const el = h(
    "div",
    { class: "view wardrobe" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "stack wardrobe-stack" },
        h("div", { class: "wardrobe-head" }, h("span", { class: "wardrobe-title", text: tl("Wardrobe") }), note),
        grid,
      ),
    ),
  );

  let drawnDpr = 0;
  const sync = () => {
    const list = colors().join();
    if (list !== shown) {
      shown = list;
      fill();
    }
    // Drawn again only on a monitor of another scale, so they stay sharp.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (dpr !== drawnDpr) {
      drawnDpr = dpr;
      for (const [color, button] of items) drawIcon(button.querySelector("canvas") as HTMLCanvasElement, color);
    }
    const current = puhuColor();
    for (const [color, button] of items) button.classList.toggle("on", color === current);
    note.textContent = PUHU_COLOR_NAMES[current] ?? "";
  };

  return { el, sync };
}
