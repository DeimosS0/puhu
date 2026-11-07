// The weather Puhu dresses for (src/core/weather.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { dress, nextRain, rainLaterToday, rainSoon, weatherIcon } from "../src/core/weather.ts";

const NOW = new Date(2026, 10, 7, 10, 0).getTime();
const Q = 15 * 60_000;
const reading = (over = {}) => ({
  place: "İzmir, Türkiye", temp: 14, code: 3, isDay: true, high: 17, low: 9,
  rain: [0, 1, 2, 3, 4, 5].map((i) => [NOW + i * Q, 0]), hours: [], at: NOW, ...over,
});
const wetFrom = (slot, mm = 0.5) => reading().rain.map(([t], i) => [t, i >= slot ? mm : 0]);

test("rain, cold, sun and a clear night each dress him", () => {
  assert.deepEqual(dress(reading({ code: 61 }), NOW), { umbrella: true, scarf: false, sun: false, moon: false });
  assert.deepEqual(dress(reading({ temp: 3 }), NOW), { umbrella: false, scarf: true, sun: false, moon: false });
  assert.deepEqual(dress(reading({ code: 0, temp: 29 }), NOW), { umbrella: false, scarf: false, sun: true, moon: false });
  assert.deepEqual(dress(reading({ code: 1, isDay: false }), NOW), { umbrella: false, scarf: false, sun: false, moon: true });
  // Snowing: a scarf, whatever the thermometer says.
  assert.equal(dress(reading({ code: 73, temp: 7 }), NOW).scarf, true);
  // Cloudy and mild: nothing.
  assert.deepEqual(dress(reading(), NOW), { umbrella: false, scarf: false, sun: false, moon: false });
});

test("the rain to come takes the umbrella out when its quarter hour starts", () => {
  const w = reading({ rain: wetFrom(2) });
  assert.equal(dress(w, NOW).umbrella, false);
  assert.equal(dress(w, NOW + 2 * Q + 1).umbrella, true);
});

test("an old reading says nothing", () => {
  assert.equal(dress(reading({ code: 61 }), NOW + 4 * 3600_000), null);
  assert.equal(rainSoon(reading({ rain: wetFrom(1) }), NOW + 4 * 3600_000), null);
});

test("rain soon is told in fives of minutes, only while it is dry and only within 45 minutes", () => {
  assert.equal(rainSoon(reading({ rain: wetFrom(2) }), NOW), 30);
  assert.equal(rainSoon(reading({ rain: wetFrom(1) }), NOW + 12 * 60_000), 5);
  assert.equal(rainSoon(reading({ rain: wetFrom(4) }), NOW), null);
  assert.equal(nextRain(reading({ rain: wetFrom(4) }), NOW), NOW + 4 * Q);
  assert.equal(rainSoon(reading({ code: 61, rain: wetFrom(2) }), NOW), null);
  assert.equal(rainSoon(reading({ rain: wetFrom(0) }), NOW), null);
});

test("the morning names the hour the rain starts today", () => {
  const H = 3600_000;
  const hours = [0, 1, 2, 3, 4, 5].map((i) => [NOW + i * H, i === 5 ? 1.2 : i === 2 ? 0.1 : 0]);
  assert.equal(rainLaterToday(reading({ hours }), NOW), NOW + 5 * H);
  assert.equal(rainLaterToday(reading({ hours: hours.map(([t]) => [t, 0]) }), NOW), null);
});

test("the weather's picture", () => {
  assert.equal(weatherIcon(reading({ code: 80 })), "umbrella");
  assert.equal(weatherIcon(reading({ code: 71 })), "snow");
  assert.equal(weatherIcon(reading({ code: 0 })), "sun");
  assert.equal(weatherIcon(reading({ code: 1, isDay: false })), "moon");
  assert.equal(weatherIcon(reading({ code: 45 })), "cloud");
});
