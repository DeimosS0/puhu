// Focus play's daily quests and eggs (src/core/quests.ts), as the replay counts them
// (src/core/progress.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { dayOf, replay } from "../src/core/progress.ts";
import { eggFor, questsFor } from "../src/core/quests.ts";

const MIN = 60_000;
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m).getTime();
const focus = (end, minutes = 25) => ({ v: 1, kind: "focus", at: end, start: end - minutes * MIN, minutes, ran: minutes * MIN });
const rest = (end) => ({ v: 1, kind: "break", at: end, minutes: 5 });

/** A day that does every quest but Claude's: early, in a row, a long one, breaks, an evening one. */
const fullDay = (d) => [
  focus(at(d, 8)), rest(at(d, 8, 5)), focus(at(d, 8, 35)), rest(at(d, 8, 40)),
  focus(at(d, 12), 50), focus(at(d, 19)),
];
/** November days whose quests this day can all do (no Claude among them). */
const doable = Array.from({ length: 30 }, (_, i) => i + 1).filter((d) => !questsFor(dayOf(at(d, 12)), 2).some((q) => q.id === "claude"));

test("three different quests a day, the same on every replay, fitting the goal", () => {
  const day = dayOf(at(5, 12));
  const ids = questsFor(day, 2).map((q) => q.id);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(questsFor(day, 2).map((q) => q.id), ids);
  for (let d = day; d < day + 60; d++) {
    assert.ok(!questsFor(d, 1).some((q) => q.id === "chain" || q.id === "long"), String(d));
  }
});

test("eggs: feathers mostly, sometimes a shield, now and then a potion", () => {
  const n = { feathers: 0, shield: 0, potion: 0 };
  for (let d = 20000; d < 21000; d++) n[eggFor(d).kind]++;
  assert.ok(n.feathers > 550 && n.feathers < 750, JSON.stringify(n));
  assert.ok(n.shield > 120 && n.shield < 280, JSON.stringify(n));
  assert.ok(n.potion > 80 && n.potion < 220, JSON.stringify(n));
  assert.deepEqual(eggFor(20500), eggFor(20500));
});

test("all three quests done: points and feathers for each, and the day's egg", () => {
  const d = doable[0];
  const s = replay(fullDay(d), at(d, 20));
  assert.ok(s.today.quests.every((q) => q.done), JSON.stringify(s.today.quests));
  assert.deepEqual(s.today.egg, eggFor(dayOf(at(d, 12))));
  const egg = s.today.egg.kind === "feathers" ? s.today.egg.n : 0;
  assert.equal(s.feathers, 3 * 5 + egg + (s.level - 1) * 10);
});

test("a shield egg keeps a later missed day; a potion doubles the next hour's rounds", () => {
  const shieldDay = doable.find((d) => eggFor(dayOf(at(d, 12))).kind === "shield");
  const kept = replay([...fullDay(shieldDay), focus(at(shieldDay + 2, 10))], at(shieldDay + 2, 12));
  // The shielded day keeps the streak without adding to it.
  assert.equal(kept.streak, 2);
  assert.deepEqual(kept.shielded, [dayOf(at(shieldDay + 1, 12))]);

  const potionDay = doable.find((d) => eggFor(dayOf(at(d, 12))).kind === "potion");
  if (potionDay == null) return;
  const facts = fullDay(potionDay);
  // The fact that finished the third quest hatched the egg: a round half an hour later counts twice.
  const hatched = facts.find((_, i) => replay(facts.slice(0, i + 1), at(potionDay, 23)).today.egg).at;
  const without = replay(facts, at(potionDay, 23)).points;
  const withRound = replay([...facts, focus(hatched + 30 * MIN)], at(potionDay, 23)).points;
  assert.equal(withRound - without, 20);
});

test("Claude's quest counts the turns written for it", () => {
  const d = Array.from({ length: 30 }, (_, i) => i + 1).find((x) => questsFor(dayOf(at(x, 12)), 2).some((q) => q.id === "claude"));
  const claude = (m) => ({ v: 1, kind: "claude", at: at(d, 11, m) });
  const s = replay([claude(1), claude(2), claude(3)], at(d, 12));
  assert.deepEqual(s.today.quests.find((q) => q.id === "claude"), { id: "claude", target: 3, value: 3, done: true });
});

test("the shop: a purchase spends feathers, a colour stays owned, a shield joins the others", async () => {
  const { SHOP, shopState } = await import("../src/core/shop.ts");
  const d = doable[0];
  const earned = replay(fullDay(d), at(d, 20));
  const kum = SHOP.find((i) => i.id === "color.kum");
  const shield = SHOP.find((i) => i.id === "shield");
  assert.equal(shopState(earned, kum, 2), earned.feathers >= kum.price ? "buy" : "short");
  const rich = { ...earned, feathers: 500 };
  assert.equal(shopState(rich, SHOP.find((i) => i.id === "color.altin"), 2), "locked");
  const bought = replay([...fullDay(d), { v: 1, kind: "spend", at: at(d, 21), item: "color.kum", price: 1 }, { v: 1, kind: "spend", at: at(d, 21, 5), item: "shield", price: 1 }], at(d, 22));
  assert.equal(bought.feathers, earned.feathers - 2);
  assert.deepEqual(bought.owned, ["color.kum"]);
  assert.equal(shopState(bought, kum, 2), "owned");
  assert.equal(bought.shields, earned.shields + 1);
  assert.equal(shopState({ ...bought, shields: 2 }, shield, 2), "full");
});
