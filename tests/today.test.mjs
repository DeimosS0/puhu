// Today's list (src/core/today.ts): what is written lands on a day and a time, what is
// not done comes along to the next day, and the order is the order to do it in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dayCount, parseTask, prune, readTasks, todayList, waited } from "../src/core/today.ts";

// Friday 6 November 2026, 09:15.
const NOW = new Date(2026, 10, 6, 9, 15);

test("a day and a time are read out of the text, in Turkish and English", () => {
  assert.deepEqual(parseTask("yarın 14:00 diş hekimi", NOW), { text: "diş hekimi", day: "2026-11-07", time: "14:00" });
  assert.equal(parseTask("toplantı 10:00'da", NOW).text, "toplantı");
  assert.deepEqual(parseTask("Rapor yaz", NOW), { text: "Rapor yaz", day: "2026-11-06", time: undefined });
  assert.deepEqual(parseTask("call Ben tomorrow at 9.30", NOW), { text: "call Ben at", day: "2026-11-07", time: "09:30" });
  assert.equal(parseTask("toplantı 16:30'da", NOW).time, "16:30");
});

test("a weekday is the next one, today included; Turkish endings and cumartesi are read right", () => {
  assert.equal(parseTask("cuma sunum", NOW).day, "2026-11-06");
  assert.equal(parseTask("cumaya sunum", NOW).day, "2026-11-06");
  assert.equal(parseTask("cumartesi pazar", NOW).day, "2026-11-07");
  assert.equal(parseTask("perşembe spor", NOW).day, "2026-11-12");
  assert.equal(parseTask("pazartesi teslim", NOW).day, "2026-11-09");
  assert.equal(parseTask("pazartesi teslim", NOW).text, "teslim");
});

test("nothing but a day word keeps the words, and a word that merely contains one is left alone", () => {
  assert.equal(parseTask("yarın", NOW).text, "yarın");
  assert.equal(parseTask("Cumhuriyet töreni", NOW).day, "2026-11-06");
  assert.equal(parseTask("Cumhuriyet töreni", NOW).text, "Cumhuriyet töreni");
  assert.deepEqual(parseTask("pazarlama toplantısı", NOW), { text: "pazarlama toplantısı", day: "2026-11-06", time: undefined });
  assert.equal(parseTask("yarına kadar bitir", NOW).day, "2026-11-07");
});

const task = (over) => ({ id: over.text, created: 0, ...over });

test("what waited from earlier days comes first, then today's as written, then the ones with a time", () => {
  const tasks = [
    task({ text: "meeting", day: "2026-11-06", time: "14:00", created: 1 }),
    task({ text: "report", day: "2026-11-06", created: 2 }),
    task({ text: "old", day: "2026-11-04", created: 3 }),
    task({ text: "older", day: "2026-11-03", created: 4 }),
    task({ text: "early call", day: "2026-11-06", time: "10:00", created: 5 }),
    task({ text: "tomorrow", day: "2026-11-07", created: 6 }),
    task({ text: "done", day: "2026-11-06", created: 7, doneAt: NOW.getTime() }),
  ];
  assert.deepEqual(todayList(tasks, NOW).map((t) => t.text), ["older", "old", "report", "early call", "meeting"]);
  assert.equal(waited(tasks[3], NOW), 3);
  assert.equal(waited(tasks[1], NOW), 0);
  assert.deepEqual(dayCount(tasks, NOW), { done: 1, total: 6 });
});

test("the stored list is read leniently and old done things are let go", () => {
  assert.deepEqual(readTasks("not json"), []);
  assert.deepEqual(readTasks('[{"id":1},{"id":"a","text":"x","day":"2026-11-06","created":1}]').map((t) => t.id), ["a"]);
  const long = task({ text: "long ago", day: "2026-10-01", doneAt: new Date(2026, 9, 1).getTime() });
  const recent = task({ text: "recent", day: "2026-11-01", doneAt: new Date(2026, 10, 1).getTime() });
  assert.deepEqual(prune([long, recent], NOW).map((t) => t.text), ["recent"]);
});

test("the week shows what was done each past day, today's list, and what waits ahead", async () => {
  const { dayItems, weekStart } = await import("../src/core/today.ts");
  const at = (d, h = 12) => new Date(2026, 10, d, h).getTime();
  const tasks = [
    task({ text: "done tue", day: "2026-11-03", doneAt: at(3) }),
    task({ text: "late", day: "2026-11-04" }),
    task({ text: "done today", day: "2026-11-05", doneAt: at(6, 8) }),
    task({ text: "today", day: "2026-11-06" }),
    task({ text: "monday", day: "2026-11-09", time: "10:00" }),
  ];
  const view = (day) => dayItems(tasks, day, NOW).map((i) => `${i.task.text}${i.done ? "+" : ""}${i.waited ? `~${i.waited}` : ""}`);
  assert.deepEqual(view("2026-11-03"), ["done tue+"]);
  assert.deepEqual(view("2026-11-04"), [], "what was not done came along to today");
  assert.deepEqual(view("2026-11-06"), ["late~2", "today", "done today+"]);
  assert.deepEqual(view("2026-11-09"), ["monday"]);
  assert.equal(weekStart(NOW).getDate(), 2, "the week starts on Monday the 2nd");
  assert.equal(weekStart(NOW, 1).getDate(), 9);
});
