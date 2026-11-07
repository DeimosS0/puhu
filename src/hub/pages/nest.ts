// Puhu's Nest (docs/gamification.md): focus play as a whole. His tree, grown from the
// rounds and drawn once; his level and the numbers that made it; the calendar of the
// days; the feather shop; every badge, the secret ones hidden until found. Read from the progress log
// when the page opens (this window does not share the island's memory) and drawn again
// only when it is shown again: nothing here moves on its own.

import { h, clear, svg } from "../../views/dom";
import { t, tn } from "../../i18n/i18n";
import { Bridge } from "../../core/bridge";
import { BADGES, SECRET_BADGES, levelTitle, tierColor, type BadgeDef } from "../../core/badges";
import { MAX_SHIELDS, MILESTONES, dayOf, replay, type ProgressState } from "../../core/progress";
import { SHOP, SHOP_NAMES, shopColor, shopState, type ShopItem } from "../../core/shop";
import { PUHU_COLOR_NAMES, puhuColor, puhuCssOf, puhuPath, setPuhuColor, type PuhuColor } from "../../puhu/puhu";
import { FEATHER_ICON, SHIELD_ICON } from "../../views/flame";
import { drawTree, seasonOf, treeAge } from "../../nest/tree";
import { onEvent } from "../../core/bridge";
import type { HubContext } from "../shell";
import { number } from "../ui";
import { LEAGUE_COLOR, leagueName } from "../../views/league";

/** The calendar's span: this many weeks, the current one last. */
const WEEKS = 26;
const TREE_W = 380;
const TREE_H = 330;

function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m >= 60) return t("{0} h {1}", { 0: Math.floor(m / 60), 1: String(m % 60).padStart(2, "0") });
  return t("{0} min", { 0: m });
}

function stat(label: string, value: string, sub: string | null = null): HTMLElement {
  const el = h("div", { class: "nest-stat" }, h("div", { class: "label", text: label }), h("b", { text: value }));
  if (sub) el.append(h("div", { class: "sub", text: sub }));
  return el;
}

/** The tree, in its own card, on a sky for the time of day. */
function treeCard(s: ProgressState, seed: number): HTMLElement {
  const now = new Date();
  const night = now.getHours() >= 20 || now.getHours() < 6;
  const canvas = h("canvas", { class: "nest-tree" }) as HTMLCanvasElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(TREE_W * dpr);
  canvas.height = Math.round(TREE_H * dpr);
  canvas.style.width = `${TREE_W}px`;
  canvas.style.height = `${TREE_H}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(dpr, dpr);
    const sky = ctx.createLinearGradient(0, 0, 0, TREE_H);
    sky.addColorStop(0, night ? "#0b1020" : "#1b2230");
    sky.addColorStop(1, night ? "#1a2236" : "#2a3446");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, TREE_W, TREE_H);
    drawTree(ctx, TREE_W, TREE_H, {
      age: treeAge(s.rounds),
      goalDays: s.stats.goalDays,
      lanterns: MILESTONES.filter((m) => s.best >= m).length,
      season: seasonOf(now),
      night,
      seed,
    });
  }
  const caption = s.rounds === 0 ? t("Your rounds will grow into a tree here.") : `${t("Level {level}", { level: s.level })} · ${t(levelTitle(s.level))}`;
  return h("div", { class: "hub-card nest-tree-card" }, canvas, h("div", { class: "nest-caption", text: caption }));
}

/** The week's tile with its league, against the last four weeks by the same moment. */
function league(s: ProgressState, tile: HTMLElement): HTMLElement {
  const l = s.race.league;
  if (!l) return tile;
  const chip = h("div", { class: "nest-league", title: t("Your week against your own last four, by this time"), text: leagueName(l) });
  chip.style.setProperty("--league", LEAGUE_COLOR[l]);
  tile.insertBefore(chip, tile.children[1] ?? null);
  return tile;
}

function numbers(s: ProgressState): HTMLElement {
  const fill = h("div", { class: "fill" });
  fill.style.width = `${Math.round((s.into / s.size) * 100)}%`;
  return h("div", { class: "nest-side" },
    h("div", { class: "hub-card nest-level" },
      h("div", { class: "nest-level-head" },
        h("b", { text: t("Level {level}", { level: s.level }) }),
        h("span", { class: "rank", text: t(levelTitle(s.level)) }),
        h("span", { class: "xp", text: `${s.into} / ${s.size}` }),
      ),
      h("div", { class: "nest-bar" }, fill),
    ),
    h("div", { class: "nest-stats" },
      stat(t("Streak"), number(s.streak), t("Best: {count}", { count: s.best })),
      stat(t("Rounds"), number(s.rounds), duration(s.stats.minutes)),
      stat(t("Feathers"), number(s.feathers)),
      stat(t("Goal days"), number(s.stats.goalDays)),
      stat(t("Shields"), number(s.shields)),
      league(s, stat(t("This week"), number(s.race.points), t("Last week: {count}", { count: s.race.pace }))),
    ),
  );
}

/** The last weeks, a column each, Monday at the top: a round, the goal, a shield. */
function calendar(s: ProgressState): HTMLElement {
  const byDay = new Map(s.days.map((d) => [d.day, d]));
  const shielded = new Set(s.shielded);
  const today = dayOf(Date.now());
  // The Monday that starts the first column (day 0, 1 January 1970, was a Thursday).
  const thisMonday = today - ((today + 3) % 7);
  const first = thisMonday - (WEEKS - 1) * 7;
  const grid = h("div", { class: "nest-days" });
  for (let d = first; d < thisMonday + 7; d++) {
    const day = byDay.get(d);
    const cls = d > today ? "future" : shielded.has(d) ? "shield" : day?.met ? "met" : day && day.rounds > 0 ? "round" : "none";
    const date = new Date(d * 86_400_000);
    const cell = h("i", { class: `${cls}${d === today ? " today" : ""}`, title: `${date.getUTCDate()}.${date.getUTCMonth() + 1} · ${tn("{count} round", "{count} rounds", day?.rounds ?? 0)}` });
    grid.append(cell);
  }
  const legend = h("div", { class: "nest-legend" },
    ...([["none", t("No round")], ["round", t("A round")], ["met", t("Goal reached")], ["shield", t("Kept by a shield")]] as const)
      .map(([cls, text]) => h("span", {}, h("i", { class: cls }), h("span", { text }))),
  );
  return h("div", { class: "hub-card" }, h("div", { class: "nest-title", text: t("Your days") }), grid, legend);
}

function medal(def: BadgeDef, tier: number): HTMLElement {
  const el = h("span", { class: `nest-medal${tier === 0 ? " locked" : ""}` }, svg(def.icon, 18, { stroke: 2 }) as unknown as HTMLElement);
  if (tier > 0) el.style.setProperty("--medal", tierColor(def, tier));
  return el;
}

/** Every badge: earned ones in their tier's colour, the rest waiting with what they ask. */
function badges(s: ProgressState): HTMLElement {
  const earned = new Map(s.badges.map((b) => [b.id, b.tier]));
  const tiers = [t("Bronze"), t("Silver"), t("Gold")];
  const grid = h("div", { class: "nest-badges" });
  for (const def of BADGES) {
    const tier = earned.get(def.id) ?? 0;
    const next = def.tiers[Math.min(tier, def.tiers.length - 1)];
    const done = tier >= def.tiers.length;
    const label = def.tiers.length > 1 && tier > 0 ? `${t(def.name)} · ${tiers[tier - 1]}` : t(def.name);
    grid.append(h("div", { class: `nest-badge${tier === 0 ? " locked" : ""}` },
      medal(def, tier),
      h("div", { class: "text" },
        h("b", { text: label }),
        // Earned in full: what it took; part of the way: the next tier; not yet: what it asks.
        h("span", { text: done ? def.hint(def.tiers[tier - 1]) : tier > 0 ? t("Next: {goal}", { goal: def.hint(next) }) : def.hint(next) }),
      ),
    ));
  }
  // The secret ones found, and a hint that there are more.
  for (const def of SECRET_BADGES.filter((d) => earned.has(d.id))) {
    grid.append(h("div", { class: "nest-badge secret" }, medal(def, 1), h("div", { class: "text" }, h("b", { text: t(def.name) }), h("span", { text: def.hint(1) }))));
  }
  grid.append(h("div", { class: "nest-badge locked secret" },
    h("span", { class: "nest-medal locked", text: "?" }),
    h("div", { class: "text" }, h("b", { text: "???" }), h("span", { text: t("More are hidden. Puhu won't say where.") })),
  ));
  return h("div", { class: "hub-card" }, h("div", { class: "nest-title", text: t("Badges") }), grid);
}

/** Puhu in a colour, small, for the shop. */
function swatch(color: PuhuColor): HTMLElement {
  const size = 38;
  const canvas = h("canvas", { class: "nest-swatch" }) as HTMLCanvasElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const { body, ink } = puhuCssOf(color);
    const R = size * 0.36;
    ctx.setTransform(dpr, 0, 0, dpr, (size / 2) * dpr, (size / 2 + R * 0.06) * dpr);
    ctx.fillStyle = body;
    ctx.fill(puhuPath(R));
    ctx.fillStyle = ink;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * R * 0.31, -R * 0.12, R * 0.13, R * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

/**
 * The feather shop: a shield for a missed day, and colours for Puhu's wardrobe. A
 * purchase is written to the log; a colour bought is worn at once, and the island
 * follows (it shares the choice and hears the log changed).
 */
function shop(s: ProgressState, redraw: () => void): HTMLElement {
  const grid = h("div", { class: "nest-shop" });
  const buy = async (item: ShopItem) => {
    try {
      await Bridge.progressAdd({ v: 1, kind: "spend", at: Date.now(), item: item.id, price: item.price });
    } catch {
      return;
    }
    const color = shopColor(item.id);
    if (color) setPuhuColor(color);
    void Bridge.progressChanged();
    redraw();
  };
  for (const item of SHOP) {
    const color = shopColor(item.id);
    const state = shopState(s, item, MAX_SHIELDS);
    const price = h("span", { class: "price" }, svg(FEATHER_ICON, 12, { stroke: 2 }) as unknown as HTMLElement, h("span", { text: number(item.price) }));
    let action: HTMLElement;
    if (state === "owned" && color) {
      const wearing = puhuColor() === color;
      action = h("button", { class: "nest-buy", disabled: wearing, text: wearing ? t("Wearing") : t("Wear"), onclick: () => { setPuhuColor(color); redraw(); } });
    } else if (state === "locked") {
      action = h("button", { class: "nest-buy", disabled: true, text: t("From level {level}", { level: item.level ?? 0 }) });
    } else if (state === "full") {
      action = h("button", { class: "nest-buy", disabled: true, text: t("You carry two") });
    } else {
      action = h("button", { class: `nest-buy${state === "buy" ? " ready" : ""}`, disabled: state !== "buy", title: state === "short" ? t("Not enough feathers") : "", onclick: () => void buy(item) }, price);
    }
    const icon = color ? swatch(color) : h("span", { class: "nest-medal", style: "--medal:#8fd3ff" }, svg(SHIELD_ICON, 18, { stroke: 2 }) as unknown as HTMLElement);
    grid.append(h("div", { class: "nest-shop-item" },
      icon,
      h("div", { class: "text" },
        h("b", { text: color ? PUHU_COLOR_NAMES[color] : t(SHOP_NAMES[item.id] ?? item.id) }),
        h("span", { text: color ? t("A colour for Puhu's wardrobe") : t("Keeps your streak through a missed day") }),
      ),
      action,
    ));
  }
  const balance = h("span", { class: "nest-balance" }, svg(FEATHER_ICON, 14, { stroke: 2 }) as unknown as HTMLElement, h("span", { text: number(s.feathers) }));
  return h("div", { class: "hub-card" }, h("div", { class: "nest-shop-head" }, h("div", { class: "nest-title", text: t("Feather shop") }), balance), grid);
}

export async function nestPage(page: HTMLElement, ctx: HubContext) {
  const body = h("div", { class: "nest" });
  page.append(ctx.hero("nest", t("Nest"), t("Puhu's tree, your streak and every badge.")), body);

  async function draw() {
    const log = await Bridge.progressRead();
    const events = log?.events ?? [];
    const s = replay(events, Date.now());
    // The tree's seed: when this install's first fact was, so each one grows its own.
    const firstAt = events.reduce<number>((min, e) => Math.min(min, Number((e as { at?: number }).at) || min), Infinity);
    const seed = Number.isFinite(firstAt) ? Math.floor(firstAt / 1000) % 1_000_003 : 1;
    clear(body);
    body.append(h("div", { class: "nest-top" }, treeCard(s, seed), numbers(s)), calendar(s), shop(s, () => void draw()), badges(s));
  }

  await draw();
  // Back on screen: the island may have recorded rounds meanwhile.
  const off = await onEvent<boolean>("hub-visible", (shown) => {
    if (shown && body.isConnected) void draw();
  });
  ctx.onLeave = () => off?.();
}
