// The quick line's sums (src/core/calc.ts): numbers as the language writes them, and
// percentages the way a shop's calculator takes them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalOf, formatSum, parseSum, readNumber } from "../src/core/calc.ts";

test("sums in Turkish: a decimal comma and a thousands point", () => {
  assert.equal(parseSum("1250*1,18", ","), 1475);
  assert.equal(parseSum("1.250,50 + 49,50", ","), 1300);
  assert.equal(parseSum("(3200-450)/3", ","), 916.666666667);
  assert.equal(parseSum("2^10 - 24", ","), 1000);
  assert.equal(parseSum("12 × 3 ÷ 4", ","), 9);
  assert.equal(parseSum("0,1+0,2", ","), 0.3);
});

test("percentages as a shop's calculator takes them, written before or after", () => {
  assert.equal(parseSum("450 + %18", ","), 531);
  assert.equal(parseSum("450 + 18%", ","), 531);
  assert.equal(parseSum("450 - %20", ","), 360);
  assert.equal(parseSum("450 * %18", ","), 81);
  assert.equal(parseSum("%18 * 450", ","), 81);
  assert.equal(parseSum("200 / 50%", ","), 400);
});

test("English writes a point for decimals and a comma for thousands", () => {
  assert.equal(parseSum("1,250 * 2", "."), 2500);
  assert.equal(parseSum("2.5 * 4", "."), 10);
  // A lone mark that cannot group thousands is a decimal mark after all.
  assert.equal(parseSum("1,5 * 2", "."), 3);
  assert.equal(readNumber("1.250", ","), 1250);
  assert.equal(readNumber("1.5", ","), 1.5);
  assert.equal(readNumber("1,2,3", ","), null);
});

test("not a sum: one number, words, a timer or a time, half written, or nothing to divide by", () => {
  for (const text of ["15", "-5", "18%", "(5)", "12 dk çay", "yarın 14:00 dişçi", "14:30", "2+", "max 3+4", "4/0", ""]) {
    assert.equal(parseSum(text, ","), null, text);
  }
});

test("results are written the language's way", () => {
  assert.equal(decimalOf("tr"), ",");
  assert.equal(decimalOf("en"), ".");
  assert.equal(formatSum(1475.5, "tr"), "1.475,5");
  assert.equal(formatSum(1475.5, "en"), "1,475.5");
});
