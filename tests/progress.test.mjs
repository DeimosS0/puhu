// Puhu's progress, replayed from the log (src/core/progress.ts), and the Pomodoro's
// report of a finished phase that feeds it (src/core/pomodoro.ts).

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { dayOf, emberDue, flameTier, levelOf, moments, nextChange, replay } from "../src/core/progress.ts";
import { Pomodoro } from "../src/core/pomodoro.ts";

const MIN = 60_000;
/** A moment in November 2026, local time. */
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m).getTime();
const focus = (end, minutes = 25, ran = minutes * MIN) => ({ v: 1, kind: "focus", at: end, start: end - minutes * MIN, minutes, ran });
const rest = (end, minutes = 5) => ({ v: 1, kind: "break", at: end, minutes });
/** The points without what the day's quests added (core/quests.ts has its own tests). */
const base = (s) => s.points - s.today.quests.filter((q) => q.done).length * 5;
/** The moments the base rules give, without the quests' and the week's race. */
const kinds = (list) => list.filter((m) => m.kind !== "quest" && m.kind !== "egg" && m.kind !== "race");

test("the day turns at 04:00, not at midnight", () => {
  assert.equal(dayOf(at(6, 1)), dayOf(at(5, 23)));
  assert.equal(dayOf(at(6, 3, 59)), dayOf(at(5, 9)));
  assert.equal(dayOf(at(6, 4)), dayOf(at(5, 23)) + 1);
});

test("rounds turn into points, points into levels that grow longer", () => {
  assert.equal(replay([focus(at(5, 10))], at(5, 12)).points, 10);
  assert.equal(replay([focus(at(5, 10), 50)], at(5, 12)).points, 20);
  assert.deepEqual(levelOf(49), { level: 1, into: 49, size: 50 });
  assert.deepEqual(levelOf(50), { level: 2, into: 0, size: 75 });
  assert.deepEqual(levelOf(130), { level: 3, into: 5, size: 100 });
});

test("a round counts only if it really ran", () => {
  const end = at(5, 10);
  assert.equal(replay([focus(end, 25, 12 * MIN)], end).rounds, 0);
  assert.equal(replay([focus(end, 25, 23 * MIN)], end).rounds, 1);
  // Longer than it lasted: not a round this app wrote.
  assert.equal(replay([{ ...focus(end), ran: 40 * MIN }], end).rounds, 0);
});

test("the goal is 2 rounds until chosen, and pays once a day", () => {
  const two = replay([focus(at(5, 10)), focus(at(5, 11))], at(5, 12));
  const { day, rounds, minutes, goal, met } = two.today;
  assert.deepEqual({ day, rounds, minutes, goal, met }, { day: dayOf(at(5, 12)), rounds: 2, minutes: 50, goal: 2, met: true });
  assert.equal(base(two), 25);
  assert.equal(base(replay([focus(at(5, 10)), focus(at(5, 11)), focus(at(5, 12))], at(5, 13))), 35);
  const easy = replay([{ v: 1, kind: "goal", at: at(5, 9), rounds: 1 }, focus(at(5, 10))], at(5, 12));
  assert.equal(easy.today.met, true);
  assert.equal(base(easy), 15);
});

test("a break earns only after a round, and rounds past eight are worth half", () => {
  assert.equal(base(replay([rest(at(5, 9)), rest(at(5, 9, 30))], at(5, 12))), 0);
  assert.equal(base(replay([focus(at(5, 10)), rest(at(5, 10, 5)), rest(at(5, 10, 10))], at(5, 12))), 12);
  const ten = Array.from({ length: 10 }, (_, i) => focus(at(5, 8 + i)));
  assert.equal(base(replay(ten, at(5, 20))), 8 * 10 + 2 * 5 + 5);
});

test("the streak waits for today, breaks on a missed day, and a shield saves one", () => {
  const days = (list) => list.map((d) => focus(at(d, 10)));
  assert.equal(replay(days([1, 2, 3]), at(3, 12)).streak, 3);
  assert.equal(replay(days([1, 2, 3]), at(4, 9)).streak, 3);
  const missed = replay(days([1, 2, 3]), at(5, 9));
  assert.equal(missed.streak, 0);
  assert.equal(missed.best, 3);

  const week = days([1, 2, 3, 4, 5, 6, 7]);
  assert.equal(replay(week, at(7, 12)).shields, 1);
  const saved = replay([...week, focus(at(9, 10))], at(9, 12));
  assert.equal(saved.streak, 8);
  assert.equal(saved.shields, 0);
  assert.deepEqual(saved.shielded, [dayOf(at(8, 12))]);
});

test("what the rules don't know is passed over", () => {
  const state = replay([{ v: 1, kind: "rekey", at: 1 }, null, "focus", { kind: "focus", at: 2 }, { kind: "goal", at: 3, rounds: 0 }], at(5, 12));
  assert.equal(state.points, 0);
  assert.equal(state.today.goal, 2);
});

test("the day's first round lights the flame; the goal and a level have their moments", () => {
  const before = replay([focus(at(4, 10)), focus(at(5, 9))], at(6, 9));
  const first = replay([focus(at(4, 10)), focus(at(5, 9)), focus(at(6, 10))], at(6, 10));
  assert.deepEqual(kinds(moments(before, first, 0)), [{ kind: "streak", from: 2, to: 3, milestone: true }]);
  const second = replay([focus(at(4, 10)), focus(at(5, 9)), focus(at(6, 10)), focus(at(6, 11))], at(6, 11));
  // The second round: the goal (and no flame again: that was the first one's).
  assert.deepEqual(kinds(moments(first, second, 0)).filter((m) => m.kind !== "level"), [{ kind: "goal" }]);
  // The round that crosses 50 points (level 2) has the level's moment.
  const rounds = Array.from({ length: 8 }, (_, i) => focus(at(7, 8 + i)));
  const k = rounds.findIndex((_, i) => replay(rounds.slice(0, i + 1), at(7, 20)).level === 2);
  const crossing = moments(replay(rounds.slice(0, k), at(7, 20)), replay(rounds.slice(0, k + 1), at(7, 20)), 0);
  assert.ok(crossing.some((m) => m.kind === "level" && m.level === 2));
  assert.equal(flameTier(29), "orange");
  assert.equal(flameTier(30), "blue");
  assert.equal(flameTier(365), "rainbow");
});

test("a shield that kept the streak is told with the next first round, once", () => {
  const week = [1, 2, 3, 4, 5, 6, 7].map((d) => focus(at(d, 10)));
  const before = replay(week, at(9, 9));
  const after = replay([...week, focus(at(9, 10))], at(9, 10));
  const told = [{ kind: "shield" }, { kind: "streak", from: 7, to: 8, milestone: false }];
  assert.deepEqual(kinds(moments(before, after, 0)), told);
  assert.deepEqual(kinds(moments(before, after, dayOf(at(8, 12)))), told.slice(1));
});

test("the evening ember: a streak to keep, no round yet, from the reminder's time to 04:00", () => {
  const yesterday = replay([focus(at(5, 10))], at(6, 21));
  assert.equal(emberDue(yesterday, at(6, 21), "20:00"), true);
  assert.equal(emberDue(yesterday, at(6, 19), "20:00"), false);
  assert.equal(emberDue(yesterday, at(6, 21), ""), false);
  // Past midnight it is still that evening's day.
  assert.equal(emberDue(replay([focus(at(5, 10))], at(7, 1)), at(7, 1), "20:00"), true);
  assert.equal(emberDue(replay([focus(at(5, 10)), focus(at(6, 20))], at(6, 21)), at(6, 21), "20:00"), false);
  assert.equal(emberDue(replay([], at(6, 21)), at(6, 21), "20:00"), false);
  assert.equal(nextChange(at(6, 19), "20:00"), at(6, 20));
  assert.equal(nextChange(at(6, 21), "20:00"), at(7, 4));
  assert.equal(nextChange(at(7, 1), ""), at(7, 4));
});

test("a finished Pomodoro phase reports how long it ran awake; a skip reports nothing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: at(5, 10) });
  // Second by second, as the page lives it (the mock runs a long tick's timers at its end).
  const live = (ms) => {
    for (let left = ms; left > 0; left -= 1000) t.mock.timers.tick(Math.min(1000, left));
  };
  const done = [];
  Pomodoro.onComplete((d) => done.push(d));
  try {
    Pomodoro.start();
    live(25 * MIN + 2000);
    assert.equal(done.length, 1);
    assert.equal(done[0].phase, "focus");
    assert.equal(done[0].minutes, 25);
    assert.ok(done[0].ran >= 24.9 * MIN && done[0].ran <= 25 * MIN + 2000, String(done[0].ran));

    Pomodoro.skip();
    assert.equal(done.length, 1);

    // Ten minutes in, the computer sleeps past the end: only the ten minutes ran.
    live(10 * MIN);
    t.mock.timers.setTime(Date.now() + 30 * MIN);
    live(1500);
    assert.equal(done.length, 2);
    assert.ok(done[1].ran < 11 * MIN, String(done[1].ran));
    assert.equal(replay([focus(done[1].end, 25, done[1].ran)], done[1].end).rounds, 0);
  } finally {
    Pomodoro.stop();
    mock.timers.reset();
  }
});

test("a round survives the page reloading: it carries on and counts what ran before", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: at(5, 14) });
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const live = (ms) => {
    for (let left = ms; left > 0; left -= 1000) t.mock.timers.tick(Math.min(1000, left));
  };
  const done = [];
  Pomodoro.onComplete((d) => done.push(d));
  try {
    Pomodoro.start();
    live(10 * MIN);
    // The page goes away: what it kept is all that is left of the round.
    const kept = store.get("puhu.pomodoro.run");
    Pomodoro.stop();
    store.set("puhu.pomodoro.run", kept);
    t.mock.timers.setTime(Date.now() + 3000);
    Pomodoro.restore();
    assert.equal(Pomodoro.phase, "focus");
    live(15 * MIN + 2000);
    assert.equal(done.at(-1).phase, "focus");
    assert.ok(done.at(-1).ran >= 24.9 * MIN, String(done.at(-1).ran));
  } finally {
    Pomodoro.stop();
    delete globalThis.localStorage;
    mock.timers.reset();
  }
});

test("the race: this week against last week by the same moment, and the weeks before", () => {
  // 2 and 9 November 2026 are Mondays.
  const lastMon = focus(at(2, 10));
  const lastTue = focus(at(3, 10));
  const thisMon = focus(at(9, 10));
  const s = replay([lastMon, lastTue, thisMon], at(9, 11));
  assert.equal(s.race.points, s.points - replay([lastMon, lastTue], at(9, 11)).points);
  assert.equal(s.race.pace, replay([lastMon], at(9, 11)).points);
  assert.equal(s.race.last, replay([lastMon, lastTue], at(9, 11)).points);
  assert.equal(s.race.before, 0);

  // The week's first round, after a week better than the one before it: told.
  const weekBefore = [focus(at(27, 10))].map((f) => ({ ...f, at: f.at - 31 * 86_400_000, start: f.start - 31 * 86_400_000 }));
  const before = replay([...weekBefore, lastMon, lastTue], at(9, 9));
  const after = replay([...weekBefore, lastMon, lastTue, thisMon], at(9, 11));
  assert.ok(moments(before, after, 0).some((m) => m.kind === "race"));
  assert.ok(!moments(after, replay([...weekBefore, lastMon, lastTue, thisMon, focus(at(9, 12))], at(9, 13)), 0).some((m) => m.kind === "race"));
});

test("leagues: this week against the past weeks' average by the same moment", async () => {
  const { leagueOf } = await import("../src/core/progress.ts");
  assert.equal(leagueOf(10, 0), null);
  assert.equal(leagueOf(10, 100), "bronze");
  assert.equal(leagueOf(70, 100), "silver");
  assert.equal(leagueOf(100, 100), "gold");
  assert.equal(leagueOf(120, 100), "platinum");
  assert.equal(leagueOf(150, 100), "diamond");
  // Last Monday two rounds by 11:00, this Monday one: below last week's pace.
  const s = replay([focus(at(2, 9)), focus(at(2, 10)), focus(at(9, 10))], at(9, 11));
  assert.equal(s.race.pace, replay([focus(at(2, 9)), focus(at(2, 10))], at(9, 11)).points);
  assert.equal(s.race.average, s.race.pace);
  assert.equal(s.race.league, leagueOf(s.race.points, s.race.average));
  assert.equal(replay([focus(at(9, 10))], at(9, 11)).race.league, null);
});
