// What dropped files can be made into (src/island/convert.ts): the choose card's buttons.

import { test } from "node:test";
import assert from "node:assert/strict";
import { offers } from "../src/island/convert.ts";

test("photos make a PDF; one photo can also be made smaller, and a JPG when it is not one", () => {
  assert.deepEqual(offers(["C:\\a\\IMG_1.JPG"]), ["pdf", "small"]);
  assert.deepEqual(offers(["C:\\a\\logo.png"]), ["pdf", "small", "jpg"]);
  assert.deepEqual(offers(["C:\\a\\iphone.HEIC"]), ["pdf", "small", "jpg"]);
  assert.deepEqual(offers(["C:\\a\\1.jpg", "C:\\a\\2.png"]), ["pdf"]);
});

test("a Word document or plain text makes a PDF; anything else, or a mix, makes nothing", () => {
  assert.deepEqual(offers(["C:\\a\\odev.docx"]), ["pdf"]);
  assert.deepEqual(offers(["C:\\a\\not.txt"]), ["pdf"]);
  assert.deepEqual(offers(["C:\\a\\odev.docx", "C:\\a\\b.docx"]), []);
  assert.deepEqual(offers(["C:\\a\\1.jpg", "C:\\a\\odev.docx"]), []);
  assert.deepEqual(offers(["C:\\a\\sunum.pptx"]), []);
  assert.deepEqual(offers(["C:\\a\\eski.doc"]), []);
  assert.deepEqual(offers([]), []);
});
