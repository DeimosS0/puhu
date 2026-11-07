// The launch greeting (src/puhu/greeting.ts): Puhu must never be cut off by
// the island while it grows, while he lands, shakes and waves, or while it
// shrinks back to the compact island.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GREETING_END, GREETING_W, greetingPose, puhuBounds } from "../src/puhu/greeting.ts";
import { Tracked } from "../src/core/anim.ts";
import { COMPACT_W, NOTCH_H, NOTCH_W, VIEW_LAYOUTS } from "../src/core/layout.ts";

const FRAME = 1 / 60;
const SLACK = 0.5; // anti-aliasing

/** Puhu's box against the island's, which is centred in the 640 px greeting canvas. */
function assertInside(t, tc, w, h) {
  const b = puhuBounds(greetingPose(t, tc));
  if (!b) return;
  const left = GREETING_W / 2 - w / 2;
  const right = GREETING_W / 2 + w / 2;
  const at = `t=${t.toFixed(3)} tc=${tc}`;
  // No check on the top: he flies in from the edge of the screen, so his head
  // is meant to come out of it.
  assert.ok(b.bottom <= h + SLACK, `${at}: bottom ${b.bottom.toFixed(1)} below the island (${h.toFixed(1)})`);
  assert.ok(b.left >= left - SLACK, `${at}: left ${b.left.toFixed(1)} outside ${left.toFixed(1)}`);
  assert.ok(b.right <= right + SLACK, `${at}: right ${b.right.toFixed(1)} outside ${right.toFixed(1)}`);
}

/** Runs the island geometry the way Island does: spring open, then the 340 ms close curve. */
function run(tc) {
  const width = new Tracked(NOTCH_W);
  const height = new Tracked(0);
  width.springTo(GREETING_W);
  height.springTo(VIEW_LAYOUTS.greeting.height);
  let collapsed = false;
  const stop = Number.isFinite(tc) ? tc + 0.6 : GREETING_END + 0.5;
  for (let t = 0; t <= stop; t += FRAME) {
    const now = t * 1000;
    if (!collapsed && t >= tc) {
      collapsed = true;
      width.curveTowards(COMPACT_W, 340, now);
      height.curveTowards(NOTCH_H, 340, now);
    }
    width.step(FRAME, now);
    height.step(FRAME, now);
    assertInside(t, tc, width.value, height.value);
  }
}

test("Puhu stays inside the island for the whole greeting", () => {
  run(Number.POSITIVE_INFINITY);
});

test("Puhu stays inside the island when the greeting is cut short", () => {
  for (let tc = 0.3; tc < GREETING_END + 0.4; tc += 0.1) run(tc);
});

test("he flies in, shakes his feathers, looks round, hoots, waves and sits in the middle", () => {
  const flying = greetingPose(0.4);
  assert.ok(flying.wings > 0.9 && flying.y < 90, `flying in: wings ${flying.wings}, y ${flying.y}`);
  assert.ok(greetingPose(1.2).fluff > 0.9, "feathers puffed up for the shake");
  assert.ok(Math.abs(greetingPose(1.68).swivel) > 1, "looking round");
  assert.equal(greetingPose(2.1).eye, "content", "hooting");
  const waving = greetingPose(2.6);
  assert.ok(waving.wings > 0.9 && waving.wave >= 0, "waving a wing");
  const back = greetingPose(3.6);
  assert.equal(back.x, 320);
  assert.equal(back.wings, 0);
});

test("he lands where the compact island's Puhu sits", () => {
  const end = greetingPose(10, 5);
  assert.equal(end.y, NOTCH_H / 2);
  assert.equal(end.x, GREETING_W / 2 - COMPACT_W / 2 + 40);
  assert.equal(end.minis, 1);
});
