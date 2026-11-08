// Timers (src/core/timer.ts): a length and what it is for, read out of what was written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLeft, parseTimer } from "../src/core/timer.ts";

test("a length is read in Turkish and English, with what it is for around it", () => {
  assert.deepEqual(parseTimer("12 dk çay"), { label: "çay", seconds: 720, kind: "tea" });
  assert.deepEqual(parseTimer("çay 12dk"), { label: "çay", seconds: 720, kind: "tea" });
  assert.deepEqual(parseTimer("yumurta 7 dakika"), { label: "yumurta", seconds: 420, kind: "egg" });
  assert.deepEqual(parseTimer("10 min coffee"), { label: "coffee", seconds: 600, kind: "coffee" });
  assert.deepEqual(parseTimer("set a timer for 90 seconds"), { label: "", seconds: 90, kind: "hourglass" });
  assert.deepEqual(parseTimer("toplantı 10 dk sonra"), { label: "toplantı", seconds: 600, kind: "hourglass" });
});

test("lengths add up, halves and decimals count", () => {
  assert.equal(parseTimer("1 saat 20 dk fırın")?.seconds, 4800);
  assert.equal(parseTimer("1,5 saat")?.seconds, 5400);
  assert.equal(parseTimer("yarım saat çamaşır")?.seconds, 1800);
  assert.equal(parseTimer("45 sn")?.seconds, 45);
});

test("no length, a clock time, a word that only starts like a unit, or too long: not a timer", () => {
  assert.equal(parseTimer("diş hekimi"), null);
  assert.equal(parseTimer("yarın 14:00 diş"), null);
  assert.equal(parseTimer("3 ders çalış"), null);
  assert.equal(parseTimer("2 saat 10:30 toplantı"), null);
  assert.equal(parseTimer("20 saat"), null);
});

test("what is left reads like a clock", () => {
  assert.equal(formatLeft(247_000), "4:07");
  assert.equal(formatLeft(3_727_000), "1:02:07");
  assert.equal(formatLeft(-5), "0:00");
  assert.equal(formatLeft(400), "0:01");
});
