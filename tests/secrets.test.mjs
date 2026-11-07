// Puhu's surprises (src/core/secrets.ts) and their secret badges (src/core/badges.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { KONAMI_LENGTH, copiedSecret, dateSecret, isFullMoon, konamiStep, nextTimed } from "../src/core/secrets.ts";
import { badgeDef, newBadges, tierColor } from "../src/core/badges.ts";
import { replay } from "../src/core/progress.ts";

test("what he knows when it is copied", () => {
  assert.equal(copiedSecret("  Puhu "), "noticed");
  assert.equal(copiedSecret("Hello, World!"), "hello");
  assert.equal(copiedSecret("sudo rm -rf /tmp/x"), "danger");
  assert.equal(copiedSecret("🦉"), "mirror");
  assert.equal(copiedSecret("puhu is cute"), null);
  assert.equal(copiedSecret("rm -r notes"), null);
});

test("the moon, the days of the year and the times of day", () => {
  // Full moon on 24 November 2026 (about 14:53 UTC); new moon on 9 November.
  assert.equal(isFullMoon(Date.UTC(2026, 10, 24, 15)), true);
  assert.equal(isFullMoon(Date.UTC(2026, 10, 9, 12)), false);
  assert.equal(dateSecret(new Date(2027, 3, 1, 10).getTime()), "april");
  assert.equal(dateSecret(new Date(2027, 0, 1, 10).getTime()), "newyear");
  // The 256th day: 13 September, or the 12th in a leap year.
  assert.equal(dateSecret(new Date(2026, 8, 13, 10).getTime()), "programmer");
  assert.equal(dateSecret(new Date(2028, 8, 12, 10).getTime()), "programmer");
  assert.equal(dateSecret(new Date(2026, 8, 14, 10).getTime()), null);
  assert.deepEqual(nextTimed(new Date(2026, 10, 5, 10).getTime()), { at: new Date(2026, 10, 5, 11, 11).getTime(), id: "wish" });
  assert.equal(nextTimed(new Date(2026, 10, 5, 12).getTime()).id, "leet");
  assert.deepEqual(nextTimed(new Date(2026, 10, 5, 23).getTime()), { at: new Date(2026, 10, 6, 11, 11).getTime(), id: "wish" });
});

test("the Konami code, typed in full, counts; a slip starts over", () => {
  const keys = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "B", "a"];
  assert.equal(keys.reduce(konamiStep, 0), KONAMI_LENGTH);
  assert.equal(["ArrowUp", "ArrowUp", "x"].reduce(konamiStep, 0), 0);
  // Three ups: the code goes on from the last two.
  assert.equal(["ArrowUp", "ArrowUp", "ArrowUp", "ArrowDown"].reduce(konamiStep, 0), 3);
});

test("secret badges: found, never earned by the stats, violet", () => {
  const def = badgeDef("secret.answer");
  assert.ok(def?.secret);
  assert.equal(tierColor(def, 1), "#c084fc");
  const state = replay([{ v: 1, kind: "badge", at: 1, id: "secret.answer", tier: 1 }], Date.now());
  assert.equal(state.badges[0].id, "secret.answer");
  assert.ok(!newBadges(state).some((b) => b.id.startsWith("secret.")));
});
