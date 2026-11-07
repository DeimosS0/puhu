// Focus play's feather shop (docs/gamification.md): what feathers buy. A shield for a
// missed day, and new colours for Puhu's wardrobe; some colours also wait for a level,
// and no amount of feathers opens them sooner. A purchase is a fact in the progress log
// (a "spend"), so the balance and what is owned are replayed like everything else.

import { N_ } from "../i18n/i18n";
import type { ProgressState } from "./progress";
import type { PuhuColor } from "../puhu/puhu";

export interface ShopItem {
  /** "shield", or "color.<PuhuColor>". */
  id: string;
  price: number;
  /** A colour that also waits for this level. */
  level?: number;
}

/** What a shield costs: a little more than a good day's quests and egg. */
export const SHIELD_PRICE = 60;

export const SHOP: readonly ShopItem[] = [
  { id: "shield", price: SHIELD_PRICE },
  { id: "color.kum", price: 120 },
  { id: "color.gul", price: 150 },
  { id: "color.orman", price: 150 },
  { id: "color.altin", price: 300, level: 10 },
];

/** What the shop says of each, by id. */
export const SHOP_NAMES: Record<string, string> = {
  shield: N_("Shield"),
};

/** The colours the shop sells, as the wardrobe names them. */
export function shopColor(id: string): PuhuColor | null {
  return id.startsWith("color.") ? (id.slice(6) as PuhuColor) : null;
}

export type ShopState = "buy" | "short" | "locked" | "full" | "owned";

/** Whether `item` can be bought now: enough feathers, the level reached, not owned, room for a shield. */
export function shopState(s: ProgressState, item: ShopItem, maxShields: number): ShopState {
  if (item.id !== "shield" && s.owned.includes(item.id)) return "owned";
  if (item.level && s.level < item.level) return "locked";
  if (item.id === "shield" && s.shields >= maxShields) return "full";
  return s.feathers >= item.price ? "buy" : "short";
}
