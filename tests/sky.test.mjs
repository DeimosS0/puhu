// The weekly sky (src/recap/sky.ts): half hours of real work as stars, things done as
// stars, nothing counted twice, and the week's title.
// Dates are built with local constructors, so the tests hold in any time zone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { keepSky, readSkies, titleOf, trend, weekSky } from "../src/recap/sky.ts";

const MONDAY = new Date(2026, 10, 2); // Monday 2 November 2026
const at = (day, h, m = 0) => new Date(2026, 10, 2 + day, h, m).getTime();
const secs = (ms) => Math.floor(ms / 1000);
const round = (day, h, m, minutes) => ({ at: at(day, h, m) + minutes * 60_000, ran: minutes * 60_000 });
const turn = (from, to) => ({
  agent: "integration_claude", project: "p", start: secs(from), end: secs(to),
  filesChanged: 0, linesAdded: 0, linesRemoved: 0, commandsRun: 0, questions: 0,
});
const sky = (parts) => weekSky({ weekStart: MONDAY, turns: [], focus: [], done: [], work: [], ...parts });

test("an empty week is a quiet one with no brightest day", () => {
  const s = sky({});
  assert.equal(s.stars.length, 0);
  assert.equal(s.brightest, -1);
  assert.equal(s.title, "quiet");
});

test("a half hour is a star from twenty minutes of it", () => {
  // 09:00–09:25: 25 minutes in the 09:00 half hour.
  const one = sky({ focus: [round(0, 9, 0, 25)] });
  assert.deepEqual(one.stars.map((s) => [s.day, s.slot, s.kind]), [[0, 18, "focus"]]);
  assert.equal(one.minutes, 25);
  assert.equal(one.focusRounds, 1);
  // 09:20–09:45: ten minutes in one half hour, fifteen in the next: no star, but the
  // time still counts.
  const split = sky({ focus: [round(0, 9, 20, 25)] });
  assert.equal(split.timeStars, 0);
  assert.equal(split.minutes, 25);
});

test("overlapping agent sessions count their minutes once", () => {
  const s = sky({ turns: [turn(at(1, 14), at(1, 14, 15)), turn(at(1, 14, 5), at(1, 14, 18))] });
  // 14:00–14:18 covered: 18 minutes, under twenty.
  assert.equal(s.timeStars, 0);
  const t = sky({ turns: [turn(at(1, 14), at(1, 14, 15)), turn(at(1, 14, 10), at(1, 14, 25))] });
  assert.equal(t.timeStars, 1);
  assert.equal(t.stars[0].kind, "code");
});

test("a half hour takes the colour of what covered it most, and is one star", () => {
  const work = [[secs(at(2, 10)), [25, 0, 0]]];
  const s = sky({ focus: [round(2, 10, 0, 22)], work });
  assert.deepEqual(s.stars.map((x) => x.kind), ["code"]);
  const design = sky({ work: [[secs(at(3, 15)), [0, 21, 0]]] });
  assert.deepEqual(design.stars.map((x) => [x.day, x.slot, x.kind]), [[3, 30, "design"]]);
});

test("each thing done is a star of its own, and the brightest day has the most", () => {
  const s = sky({ done: [at(4, 11), at(4, 12), at(6, 9)], focus: [round(2, 9, 0, 25)] });
  assert.equal(s.doneStars, 3);
  assert.deepEqual(s.perDay, [0, 0, 1, 0, 2, 0, 1]);
  assert.equal(s.brightest, 4);
  // Outside the week, nothing.
  assert.equal(sky({ done: [at(7, 10), at(-1, 10)] }).doneStars, 0);
});

/** Six or more time stars on the given (day, hour) half hours, all one kind. */
const stars = (list, kind = "code") => list.map(([day, slot]) => ({ day, slot, kind, strength: 1 }));
const title = (list, extra = {}) => titleOf({ stars: list, timeStars: list.filter((s) => s.kind !== "done").length, doneStars: 0, longestRun: 0, ...extra });

test("the titles, the first that fits", () => {
  assert.equal(title(stars([[0, 20], [1, 20]])), "quiet");
  assert.equal(title(stars([[0, 46], [1, 47], [2, 0], [3, 2], [4, 20], [5, 22], [6, 24]])), "nightOwl");
  assert.equal(title(stars([[0, 12], [1, 14], [2, 16], [3, 30], [4, 32], [5, 34]])), "earlyBird");
  assert.equal(title(stars([[0, 24], [1, 26], [2, 28], [3, 30]], "focus").concat(stars([[4, 24], [5, 26]]))), "focusMaster");
  assert.equal(title(stars([[0, 24], [0, 25], [0, 26], [0, 27], [0, 28], [0, 29]]), { longestRun: 6 }), "marathoner");
  assert.equal(title(stars([[0, 24], [1, 24], [2, 24], [3, 24], [4, 24], [5, 24], [6, 24]])), "everyDay");
  assert.equal(title(stars([[0, 24], [1, 24], [5, 24], [5, 26], [6, 24], [6, 26]])), "weekendHero");
  assert.equal(title(stars([[0, 24], [1, 24], [2, 24], [3, 24], [0, 26], [1, 26]]), { doneStars: 15 }), "finisher");
  assert.equal(title(stars([[0, 24], [1, 24], [2, 24], [3, 24], [0, 26], [1, 26]])), "steady");
});

test("a marathon is counted on one day, in a row", () => {
  // Three hours with an agent one afternoon, then a little on the next two.
  const s = sky({ turns: [turn(at(1, 14), at(1, 17)), turn(at(2, 14), at(2, 14, 25)), turn(at(3, 14), at(3, 14, 25))] });
  assert.equal(s.longestRun, 6);
  assert.equal(s.title, "marathoner");
  // All of it in focus rounds: the focus comes first.
  assert.equal(sky({ focus: [round(1, 9, 0, 180)] }).title, "focusMaster");
});

test("a year of summaries, one per week, oldest first", () => {
  let list = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date(2026, 0, 5 + i * 7);
    const week = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    list = keepSky(list, { week, title: "steady", stars: i, minutes: 0, done: 0 });
  }
  assert.equal(list.length, 53);
  assert.equal(list[52].stars, 59);
  // The same week again replaces it.
  list = keepSky(list, { ...list[52], stars: 99 });
  assert.equal(list.length, 53);
  assert.equal(list[52].stars, 99);
  assert.deepEqual(readSkies(JSON.stringify(list)), list);
  assert.deepEqual(readSkies("not json"), []);
  assert.deepEqual(readSkies(null), []);
});

test("against the weeks before: more, the fullest, or nothing", () => {
  const earlier = [10, 20, 30].map((stars, i) => ({ week: `2026-10-0${i + 1}`, title: "steady", stars, minutes: 0, done: 0 }));
  assert.deepEqual(trend(40, 30, earlier), { kind: "best" });
  assert.deepEqual(trend(25, 20, earlier.slice(0, 2)), { kind: "more", percent: 25 });
  // A lighter week is never pointed out.
  assert.equal(trend(10, 30, earlier), null);
  assert.equal(trend(31, 30, earlier.slice(0, 2)), null);
  assert.equal(trend(0, null, []), null);
});
