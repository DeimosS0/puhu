// Alarms (src/core/alarm.ts): a ring every few seconds for a minute, then every half
// minute, and quiet after ten minutes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRing } from "../src/core/alarm.ts";

test("an alarm rings every 5 s for a minute, every 30 s after, and goes quiet after ten minutes", () => {
  const rings = [0];
  for (let next = nextRing(0, 0); next != null; next = nextRing(0, next)) rings.push(next);
  assert.deepEqual(rings.slice(0, 14), [0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000, 55_000, 60_000, 90_000]);
  assert.equal(rings.at(-1), 600_000);
  assert.equal(rings.length, 31);
});
