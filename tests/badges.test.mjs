// Focus play's badges (src/core/badges.ts) from the stats the log replays to
// (src/core/progress.ts): earned once, written down, never earned twice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { replay } from "../src/core/progress.ts";
import { levelTitle, newBadges } from "../src/core/badges.ts";

const MIN = 60_000;
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m).getTime();
const focus = (end, minutes = 25) => ({ v: 1, kind: "focus", at: end, start: end - minutes * MIN, minutes, ran: minutes * MIN });
const ids = (state) => newBadges(state).map((b) => `${b.id}:${b.tier}`);

test("the stats: rounds in a row, the most in a day, early and late, the goal days", () => {
  // Four rounds 5 minutes apart, then one an hour later; a round at 07:00 and one at 01:00.
  const day = [10, 10.5, 11, 11.5, 13].map((h) => focus(at(5, Math.floor(h), (h % 1) * 60)));
  const s = replay([...day, focus(at(6, 7)), focus(at(7, 1))], at(7, 12)).stats;
  assert.equal(s.chain, 4);
  assert.equal(s.dayRounds, 5);
  assert.equal(s.early, 1);
  assert.equal(s.night, 1);
  assert.equal(s.rounds, 7);
  // 5 Nov reached 2; 6 Nov one round at 07:00 (no); 7 Nov 01:00 belongs to 6 Nov: two, reached.
  assert.equal(s.goalDays, 2);
  assert.equal(s.goalRun, 2);
});

test("badges come as the history reaches them, and a written one is not given again", () => {
  const three = [1, 2, 3].map((d) => focus(at(d, 10)));
  assert.deepEqual(ids(replay(three, at(3, 12))), ["streak:1"]);
  const written = [...three, { v: 1, kind: "badge", at: at(3, 12), id: "streak", tier: 1 }];
  assert.deepEqual(ids(replay(written, at(3, 13))), []);
  // A week on: the next tier, and the badge the log keeps is the highest.
  const week = [...written, ...[4, 5, 6, 7].map((d) => focus(at(d, 10)))];
  assert.deepEqual(ids(replay(week, at(7, 12))), ["streak:2"]);
  const state = replay([...week, { v: 1, kind: "badge", at: at(7, 12), id: "streak", tier: 2 }], at(7, 13));
  assert.deepEqual(state.badges.map((b) => [b.id, b.tier]), [["streak", 2]]);
  // Never taken back: the log says earned, whatever the rounds say now.
  assert.equal(replay([{ v: 1, kind: "badge", at: 1, id: "ultra", tier: 1 }], at(7, 13)).badges[0].id, "ultra");
});

test("Puhu's title grows with his level", () => {
  assert.equal(levelTitle(1), "Owlet");
  assert.equal(levelTitle(5), "Fledgling");
  assert.equal(levelTitle(12), "Night watch");
  assert.equal(levelTitle(64), "Wise owl");
});
