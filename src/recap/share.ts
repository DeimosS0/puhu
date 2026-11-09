// The 1080 × 1920 image of the week, drawn once into an offscreen canvas: the week's sky
// (recap/sky.ts). A constellation a day along a Milky Way arc, a star for each half hour
// of work and each thing done, Puhu on a branch below it dressed for the week's title,
// the title and two lines, three numbers and how it compares. No project, no program,
// no time of day in it. Puhu comes from the island's own engine.

import { BotEngine } from "../puhu/engine";
import { formatDuration, weekRangeLabel } from "./summary";
import type { SkyTitle, StarKind, WeekSky } from "./sky";
import { N_, language, t } from "../i18n/i18n";
import { SCRIPT_FONTS } from "../core/fonts";

export const SHARE_W = 1080;
export const SHARE_H = 1920;

const FONT = `system-ui, "Segoe UI Variable Display", "Segoe UI", "Cantarell", "Ubuntu", ${SCRIPT_FONTS}, sans-serif`;

/** Each kind of star's colour (r,g,b). */
export const STAR_COLOR: Record<StarKind, string> = {
  focus: "255,214,140",
  code: "180,192,255",
  design: "255,176,206",
  writing: "150,214,255",
  done: "140,240,200",
};

/** The titles' names, shown with t(). */
export const TITLE_NAME: Record<SkyTitle, string> = {
  quiet: N_("A Quiet Week"),
  nightOwl: N_("Night Owl"),
  earlyBird: N_("Early Bird"),
  focusMaster: N_("Focus Master"),
  marathoner: N_("Marathoner"),
  everyDay: N_("Every Day"),
  weekendHero: N_("Weekend Hero"),
  finisher: N_("Finisher"),
  steady: N_("Steady Flight"),
};

/** The line each title says of the week. */
const TITLE_LINE: Record<SkyTitle, string> = {
  quiet: N_("A quiet week: few stars, but bright ones."),
  nightOwl: N_("Most of your stars lit up after dark."),
  earlyBird: N_("Most of your stars lit up before ten in the morning."),
  focusMaster: N_("Most of your stars came from focus rounds."),
  marathoner: N_("You kept going for {time} at a stretch."),
  everyDay: N_("A star every day of the week."),
  weekendHero: N_("Most of your stars lit up at the weekend."),
  finisher: N_("Everything you finished became a star."),
  steady: N_("Your sky filled up, star by star."),
};

/** What the week's title and the first line say, in the current language. */
export function skyWords(sky: WeekSky): { title: string; line: string; day: string } {
  const day = sky.brightest >= 0
    ? new Date(sky.weekStart.getFullYear(), sky.weekStart.getMonth(), sky.weekStart.getDate() + sky.brightest)
      .toLocaleDateString(language(), { weekday: "long" })
    : "";
  return {
    title: t(TITLE_NAME[sky.title]),
    line: t(TITLE_LINE[sky.title], { time: formatDuration(sky.longestRun * 30) }),
    day: day ? t("The brightest day: {day}.", { day }) : "",
  };
}

/** How the week compares, as the pill says it (or nothing). */
export function trendWords(trend: { kind: "best" } | { kind: "more"; percent: number } | null): string {
  if (!trend) return "";
  return trend.kind === "best" ? t("Your fullest sky yet") : t("{percent}% more stars than last week", { percent: trend.percent });
}

/** Puhu's dress for each title: the props the engine already has. */
export function dressFor(engine: BotEngine, title: SkyTitle) {
  const none = { umbrella: false, scarf: false, sun: false, moon: false };
  switch (title) {
    case "quiet": engine.setWeather({ ...none, scarf: true }); break;
    case "nightOwl": engine.setWeather({ ...none, moon: true }); break;
    case "earlyBird": engine.setActivity("code"); break;
    case "focusMaster": engine.setAccessories(false, [129, 140, 248], true); break;
    case "marathoner": engine.setAccessories(false, [244, 80, 94], false); break;
    case "everyDay": engine.setActivity("design"); break;
    case "weekendHero": engine.setAccessories(true, null, false); break;
    case "finisher": engine.setActivity("writing"); break;
    case "steady": break;
  }
}

type Ctx = CanvasRenderingContext2D;

function font(x: Ctx, weight: number, size: number) {
  x.font = `${weight} ${size}px ${FONT}`;
}

/** Lowers the font size until `text` fits `maxW`. */
function fit(x: Ctx, text: string, weight: number, size: number, maxW: number) {
  let s = size;
  font(x, weight, s);
  while (x.measureText(text).width > maxW && s > size * 0.55) {
    s -= 2;
    font(x, weight, s);
  }
}

function round(x: Ctx, l: number, top: number, w: number, h: number, r: number) {
  x.beginPath();
  x.roundRect(l, top, w, h, r);
}

/** A seeded random (the same week draws the same sky). */
function seeded(seed: number) {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 7;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function star(x: Ctx, px: number, py: number, size: number, kind: StarKind) {
  const c = STAR_COLOR[kind];
  const g = x.createRadialGradient(px, py, 0, px, py, size * 5);
  g.addColorStop(0, `rgba(${c},0.5)`);
  g.addColorStop(1, `rgba(${c},0)`);
  x.fillStyle = g;
  x.beginPath();
  x.arc(px, py, size * 5, 0, Math.PI * 2);
  x.fill();
  if (size > 4.5) {
    x.strokeStyle = `rgba(${c},0.55)`;
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(px - size * 3.2, py);
    x.lineTo(px + size * 3.2, py);
    x.moveTo(px, py - size * 3.2);
    x.lineTo(px, py + size * 3.2);
    x.stroke();
  }
  x.fillStyle = `rgba(${c},0.9)`;
  x.beginPath();
  x.arc(px, py, size, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#fff";
  x.beginPath();
  x.arc(px, py, size * 0.5, 0, Math.PI * 2);
  x.fill();
}

/** At most this many stars a day are drawn (the brightest); the numbers count them all. */
const DRAWN_PER_DAY = 26;

/** Where each day's stars go: x, y and size, in a sky `w` × `h` (also the island's). */
export function constellations(sky: WeekSky, w: number, h: number): { day: number; points: { x: number; y: number; size: number; kind: StarKind }[]; cx: number; cy: number }[] {
  const arcY = (u: number) => h * 0.78 - h * 0.6 * Math.sin(Math.PI * u);
  const slot = (w * 0.84) / 6;
  const scale = w / 1080;
  const out = [];
  for (let day = 0; day < 7; day++) {
    const mine = sky.stars.filter((s) => s.day === day).sort((a, b) => b.strength - a.strength).slice(0, DRAWN_PER_DAY);
    const u = 0.08 + day * (0.84 / 6);
    const cx = w * u;
    const cy = arcY(u) + 40 * scale;
    const n = mine.length;
    const spreadX = Math.min(slot * 0.4, (18 + Math.sqrt(n) * 12) * scale);
    const spreadY = (26 + Math.sqrt(n) * 19) * scale;
    const rnd = seeded(sky.weekStart.getTime() / 86_400_000 + day * 977);
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const points: { x: number; y: number; size: number; kind: StarKind }[] = [];
    for (let k = 0, i = 0; i < n && k < n * 60; k++) {
      const px = cx + (rnd() * 2 - 1) * spreadX;
      const py = cy + gauss() * spreadY;
      if (points.some((q) => Math.hypot(q.x - px, q.y - py) < 19 * scale)) continue;
      const s = mine[i++];
      points.push({ x: px, y: py, size: (2.2 + s.strength * 3.2 + rnd() * 1.2) * scale, kind: s.kind });
    }
    // Joined in a ring around their middle, so the lines never cross.
    points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    out.push({ day, points, cx, cy });
  }
  return out;
}

/**
 * The week's constellations, drawn into `x` over a sky `w` × `h`, the first `upTo` stars;
 * `boost` makes stars and lines larger than the scale would (the island's small sky).
 */
export function drawConstellations(x: Ctx, sky: WeekSky, w: number, h: number, upTo = Infinity, boost = 1) {
  const scale = (w / 1080) * boost;
  let drawn = 0;
  for (const c of constellations(sky, w, h)) {
    const bright = c.day === sky.brightest;
    if (c.points.length > 2) {
      x.strokeStyle = `rgba(210,218,255,${bright ? 0.38 : 0.2})`;
      x.lineWidth = (bright ? 2.2 : 1.5) * scale;
      x.beginPath();
      c.points.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
      if (c.points.length > 4) x.closePath();
      x.stroke();
    }
    for (const q of c.points) {
      if (drawn++ >= upTo) return;
      star(x, q.x, q.y, q.size * boost + (bright ? 1.4 * scale : 0), q.kind);
    }
  }
}

export function renderShareImage(sky: WeekSky, compare: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const x = canvas.getContext("2d");
  if (!x) return canvas;
  const W = SHARE_W;
  const H = SHARE_H;
  const words = skyWords(sky);

  // The night, and the Milky Way's dust across it.
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#05081a");
  bg.addColorStop(0.6, "#0f1235");
  bg.addColorStop(1, "#1c1440");
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  const rnd = seeded(sky.weekStart.getTime() / 86_400_000);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const SKY_TOP = 420;
  const SKY_H = 860;
  for (let i = 0; i < 900; i++) {
    const u = rnd();
    x.fillStyle = `rgba(220,225,255,${0.04 + rnd() * 0.16})`;
    x.beginPath();
    x.arc(60 + u * (W - 120), SKY_TOP + SKY_H * 0.78 - SKY_H * 0.6 * Math.sin(Math.PI * u) + 40 + gauss() * 120, 0.5 + rnd() * 1.1, 0, Math.PI * 2);
    x.fill();
  }
  for (let i = 0; i < 120; i++) {
    x.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.2})`;
    x.beginPath();
    x.arc(rnd() * W, rnd() * 1400, 0.6 + rnd() * 1.2, 0, Math.PI * 2);
    x.fill();
  }

  // The title, its line and the week.
  x.textBaseline = "top";
  x.textAlign = "center";
  x.fillStyle = "rgba(199,210,254,0.75)";
  font(x, 600, 24);
  x.fillText(`PUHU · ${t("Your week").toLocaleUpperCase(language())}`, W / 2, 112);
  x.fillStyle = "#ffffff";
  fit(x, words.title, 800, 100, W - 120);
  x.fillText(words.title, W / 2, 160);
  x.fillStyle = "rgba(232,235,250,0.9)";
  fit(x, words.line, 400, 34, W - 140);
  x.fillText(words.line, W / 2, 292);
  if (words.day) {
    fit(x, words.day, 400, 34, W - 140);
    x.fillText(words.day, W / 2, 336);
  }
  x.fillStyle = "rgba(199,210,254,0.55)";
  font(x, 500, 24);
  x.fillText(weekRangeLabel(sky), W / 2, 396);

  // The constellations, a day each, Monday on the left, the brightest named.
  x.save();
  x.translate(0, SKY_TOP);
  drawConstellations(x, sky, W, SKY_H);
  x.restore();
  for (const c of constellations(sky, W, SKY_H)) {
    if (c.points.length === 0) continue;
    const day = new Date(sky.weekStart.getFullYear(), sky.weekStart.getMonth(), sky.weekStart.getDate() + c.day)
      .toLocaleDateString(language(), { weekday: "short" });
    const bottom = Math.max(...c.points.map((p) => p.y));
    const bright = c.day === sky.brightest;
    x.fillStyle = `rgba(226,230,245,${bright ? 0.75 : 0.35})`;
    font(x, bright ? 700 : 500, 20);
    x.fillText(day, c.cx, SKY_TOP + bottom + 22);
  }

  // Puhu on a branch below his sky, his feet curled over it, dressed for the week.
  x.lineCap = "round";
  x.strokeStyle = "#140f22";
  x.lineWidth = 34;
  x.beginPath();
  x.moveTo(-20, 1400);
  x.quadraticCurveTo(420, 1330, 760, 1385);
  x.stroke();
  x.lineWidth = 14;
  x.beginPath();
  x.moveTo(640, 1366);
  x.quadraticCurveTo(720, 1320, 800, 1330);
  x.stroke();
  x.fillStyle = "#1c1630";
  for (const [lx, ly, a] of [[790, 1322, -0.5], [180, 1374, 0.6], [705, 1338, 0.9]] as const) {
    x.save();
    x.translate(lx, ly);
    x.rotate(a);
    x.beginPath();
    x.ellipse(0, -16, 9, 18, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  const engine = new BotEngine();
  engine.setState("idle", true);
  dressFor(engine, sky.title);
  for (let i = 0; i < 240; i++) engine.update(1 / 60);
  const size = 300;
  const R = size * 0.3;
  const bx = 430;
  const bodyBottom = 1342;
  x.fillStyle = "rgb(145,145,150)";
  for (const sd of [-1, 1]) {
    x.save();
    x.translate(bx + sd * R * 0.3, bodyBottom - 4);
    for (const toe of [-0.45, 0, 0.45]) {
      x.save();
      x.rotate(toe);
      x.beginPath();
      x.roundRect(-R * 0.038, 0, R * 0.076, R * 0.2, R * 0.038);
      x.fill();
      x.restore();
    }
    x.restore();
  }
  x.save();
  x.translate(bx - size / 2, bodyBottom - R * 0.94 - size / 2);
  engine.draw(x, size, size);
  x.restore();

  // Three numbers, and how the week compares.
  const tiles: [string, string][] = [
    [String(sky.timeStars + sky.doneStars), t("stars")],
    [formatDuration(sky.minutes), t("at work")],
    [String(sky.doneStars), t("things done")],
  ];
  const tw = 300;
  const gap = 30;
  const left = (W - 3 * tw - 2 * gap) / 2;
  const ty = 1480;
  x.textBaseline = "top";
  tiles.forEach(([v, l], i) => {
    const l0 = left + i * (tw + gap);
    x.fillStyle = "rgba(255,255,255,0.07)";
    round(x, l0, ty, tw, 160, 30);
    x.fill();
    x.fillStyle = "#fff";
    fit(x, v, 800, 54, tw - 30);
    x.fillText(v, l0 + tw / 2, ty + 30);
    x.fillStyle = "rgba(226,230,245,0.62)";
    fit(x, l, 500, 25, tw - 30);
    x.fillText(l, l0 + tw / 2, ty + 100);
  });
  if (compare) {
    fit(x, compare, 600, 27, W - 200);
    const pw = x.measureText(compare).width + 64;
    x.fillStyle = "rgba(140,240,200,0.13)";
    round(x, W / 2 - pw / 2, 1680, pw, 58, 29);
    x.fill();
    x.fillStyle = "#8cf0c8";
    x.textBaseline = "middle";
    x.fillText(compare, W / 2, 1710);
  }
  x.textBaseline = "top";
  x.fillStyle = "rgba(226,230,245,0.45)";
  font(x, 700, 30);
  x.fillText("p u h u", W / 2, 1832);
  return canvas;
}

/** The canvas as a PNG data URL, for Rust to write to disk. */
export function toPngDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

/** The canvas as a PNG blob, for the clipboard. */
export function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
