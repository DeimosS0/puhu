// Focus play's first question (src/island/focus-intro.ts): asked while unanswered and
// held as the island's waiting card until answered; "yes" records the goal and turns
// focus play on, "not now" turns it off.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { calls, sent } from "./tauri.mjs";
import { FocusIntro } from "../src/island/focus-intro.ts";
import { POMODORO_ID, Pomodoro } from "../src/core/pomodoro.ts";
import { State } from "../src/core/state.ts";

const host = { alerts: [], collapses: 0, reactions: [] };
const fakeHost = {
  alert: (view) => host.alerts.push(view),
  collapse: () => host.collapses++,
  reactToGoal: (n) => host.reactions.push(n),
};

beforeEach(() => {
  calls.length = 0;
  Object.assign(host, { alerts: [], collapses: 0, reactions: [] });
  FocusIntro.step = "ask";
  FocusIntro.goal = 2;
  State.waitingCard = null;
  State.pendingApproval = null;
});

test("asked once the island is quiet, and only while unanswered", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  State.settings.focusGame = true;
  FocusIntro.launch(fakeHost);
  t.mock.timers.tick(60_000);
  assert.deepEqual(host.alerts, []);

  // Not started above (it was answered), so a second launch still asks.
  State.settings.focusGame = null;
  FocusIntro.launch(fakeHost);
  t.mock.timers.tick(2000);
  assert.deepEqual(host.alerts, ["focusIntro"]);
  // Held until answered: the island opens on it again, below a permission only.
  assert.equal(State.waitingCard, "focusIntro");
  assert.equal(State.isPinned, true);
  assert.equal(State.defaultView(), "focusIntro");
  State.pendingApproval = { requestId: "r", pillId: "integration_claude" };
  assert.equal(State.defaultView(), "approval");
});

test("yes, a goal, OK: focus play on, the goal recorded, the Pomodoro's pill in", () => {
  State.settings.focusGame = null;
  State.settings.activeIntegrations = ["integration_github"];
  FocusIntro.yes();
  FocusIntro.pick(4);
  FocusIntro.pick(4);
  assert.deepEqual(host.reactions, [2, 4]);
  State.waitingCard = "focusIntro";
  FocusIntro.confirm();
  assert.equal(FocusIntro.step, "deal");
  assert.equal(State.waitingCard, null);
  assert.equal(State.settings.focusGame, true);
  assert.ok(State.settings.activeIntegrations.includes(POMODORO_ID));
  assert.equal(sent("save_settings").at(-1).settings.focusGame, true);
  const goal = sent("progress_add").at(-1).event;
  assert.equal(goal.kind, "goal");
  assert.equal(goal.rounds, 4);

  FocusIntro.startFirst();
  assert.equal(Pomodoro.phase, "focus");
  assert.equal(host.collapses, 1);
  Pomodoro.stop();
});

test("not now: focus play off, nothing recorded", () => {
  State.settings.focusGame = null;
  State.waitingCard = "focusIntro";
  FocusIntro.notNow();
  assert.equal(State.waitingCard, null);
  assert.equal(FocusIntro.step, "later");
  assert.equal(State.settings.focusGame, false);
  assert.equal(sent("save_settings").at(-1).settings.focusGame, false);
  assert.deepEqual(sent("progress_add"), []);
});
