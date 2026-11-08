// A PDF or a smaller picture being made from the drop (island/convert.ts), then what came
// out. Pages fly in onto the desk beside Puhu and are stapled with a red PDF tag; a photo
// is wrung out like a sponge, little squares of it squeezed off its sides at each squeeze,
// until it pops smaller with a wobble and its size rolls down; or it turns its tag to JPG. Then the new file's name, its pages
// or sizes, and Copy (the file itself, for Ctrl+V into a chat or a mail), Show in folder
// and Open. Every move is a short animation on its own; nothing runs once it has landed.

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type Converted } from "../core/bridge";
import { State, type Converting } from "../core/state";
import { language, t, tl } from "../i18n/i18n";
import type { ViewActions, ViewHost } from "./views";

/** A page lands every so often while a PDF is made; at most this many show on the desk. */
const PAGE_EVERY_MS = 380;
const MAX_ON_DESK = 5;
const SPRING = "cubic-bezier(0.22, 1.2, 0.36, 1)";
/** "Smaller": one squeeze, and how much smaller each leaves it until it is done. */
const SQUEEZE_MS = 640;
const SQUEEZE_STEP = 0.05;
/** The picture's colours, for what is squeezed out of it. */
const BITS = ["#8fd0ff", "#cfe9ff", "#4caf7d", "#2f8f5b", "#ffd166"];
/** Where the photo's middle is on the desk. */
const MID = { x: 26, y: 33 };

const WORKING: Record<Converting["kind"], () => string> = {
  pdf: () => t("Making the PDF…"),
  small: () => t("Making it smaller…"),
  jpg: () => t("Making the JPG…"),
};

function size(bytes: number): string {
  const fmt = new Intl.NumberFormat(language(), { maximumFractionDigits: bytes < 10 * 1024 * 1024 ? 1 : 0 });
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${fmt.format(bytes / (1024 * 1024))} MB`;
}

/** "3 pages · 1.4 MB", or "4.2 MB → 780 KB" for a picture. */
function meta(made: Converted): string {
  if (made.pages > 0) {
    const pages = made.pages === 1 ? t("1 page") : t("{n} pages", { n: made.pages });
    return `${pages} · ${size(made.size)}`;
  }
  return `${size(made.before)} → ${size(made.size)}`;
}

/** A photo, drawn: a sky, a sun, two hills. */
function photo(): HTMLElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("viewBox", "0 0 56 44");
  el.innerHTML =
    '<rect width="56" height="44" rx="6" fill="#8fd0ff"/><circle cx="40" cy="13" r="5" fill="#ffd166"/>' +
    '<path d="M0 44V31l12-10 11 9 9-7 24 15v6z" fill="#4caf7d"/><path d="M0 44V36l18-9 20 17z" fill="#2f8f5b"/>';
  return h("div", { class: "cv-photo" }, el as unknown as HTMLElement);
}

export function buildConvert(actions: ViewActions): ViewHost {
  const desk = h("div", { class: "cv-desk" });
  const staple = h("i", { class: "cv-staple" });
  const tag = h("span", { class: "cv-tag" });
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub" });
  const copyLabel = h("span", { text: tl("Copy") });
  const copy = h("button", { class: "btn primary" }, svg(ICONS.copy, 13), copyLabel);
  const reveal = h("button", { class: "btn secondary", text: tl("Show in folder") });
  const open = h("button", { class: "btn secondary", text: tl("Open") });
  const ok = h("button", { class: "btn secondary", text: tl("OK"), onclick: () => actions.setView("choose") });
  const made = h("div", { class: "actions made" }, copy, reveal, open);
  const missed = h("div", { class: "actions miss" }, ok);
  const card = h(
    "div",
    { class: "card cv-card" },
    desk,
    h("div", { class: "stack" }, title, sub, made, missed),
  );
  const el = h("div", { class: "view" }, card);

  let shown: Converting | null = null;
  let pageTimer: number | null = null;
  let onDesk = 0;
  /** The photo's size between squeezes. */
  let squeezed = 1;
  let copied: number | null = null;

  const path = () => State.converting?.done?.path ?? "";
  copy.onclick = () => {
    void Bridge.madeCopy(path()).then((ok) => {
      if (!ok) return;
      copyLabel.textContent = t("Copied");
      if (copied != null) window.clearTimeout(copied);
      copied = window.setTimeout(() => (copyLabel.textContent = t("Copy")), 1600);
    });
  };
  reveal.onclick = () => void Bridge.madeReveal(path());
  open.onclick = () => void Bridge.madeOpen(path());

  const stopPages = () => {
    if (pageTimer != null) window.clearInterval(pageTimer);
    pageTimer = null;
  };

  /**
   * Little squares of the picture squeezed off its sides: up and out, then falling away,
   * each on its own arc (a few points of a parabola), turning as it goes.
   */
  const spurt = (n: number, spread = 1) => {
    for (let i = 0; i < n; i++) {
      const bit = h("i", { class: "cv-bit" });
      bit.style.background = BITS[Math.floor(Math.random() * BITS.length)];
      const side = Math.random() < 0.5 ? -1 : 1;
      bit.style.left = `${MID.x + side * (22 + Math.random() * 6)}px`;
      bit.style.top = `${MID.y - 12 + Math.random() * 22}px`;
      const dx = side * (14 + Math.random() * 20) * spread;
      const peak = -(8 + Math.random() * 14) * spread;
      const at = 0.35;
      const a = -peak / (at * at);
      const spin = (Math.random() - 0.5) * 420;
      const size = 0.7 + Math.random() * 0.6;
      const frames = [0, 0.15, 0.35, 0.55, 0.75, 1].map((t) => ({
        transform: `translate(${(dx * t).toFixed(1)}px, ${(a * t * t - 2 * a * at * t).toFixed(1)}px) rotate(${(spin * t).toFixed(0)}deg) scale(${(size * (t === 0 ? 0.4 : 1 - t * 0.3)).toFixed(2)})`,
        opacity: t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4,
        offset: t,
      }));
      desk.append(bit);
      bit.animate(frames, { duration: 640 + Math.random() * 220, easing: "linear" }).onfinish = () => bit.remove();
    }
  };

  /** A few sparkles round the photo once it is done. */
  const sparkle = (n: number) => {
    for (let i = 0; i < n; i++) {
      const spark = h("span", { class: "cv-spark", text: "✦" });
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      spark.style.left = `${MID.x - 5 + Math.cos(angle) * 30}px`;
      spark.style.top = `${MID.y - 7 + Math.sin(angle) * 24}px`;
      desk.append(spark);
      spark.animate(
        [
          { transform: "scale(0) rotate(0deg)", opacity: 0 },
          { transform: "scale(1.2) rotate(70deg)", opacity: 1, offset: 0.4 },
          { transform: "scale(0) rotate(150deg)", opacity: 0 },
        ],
        { duration: 560, delay: i * 90, easing: "ease-out", fill: "backwards" },
      ).onfinish = () => spark.remove();
    }
  };

  /** One squeeze: wrung flat and wide, back up past round, a little smaller than before. */
  const squeeze = (picture: HTMLElement) => {
    const from = squeezed;
    squeezed = Math.max(0.8, squeezed - SQUEEZE_STEP);
    const to = squeezed;
    picture.animate(
      [
        { transform: `scale(${from})` },
        { transform: `scale(${from * 1.17}, ${from * 0.8})`, offset: 0.35 },
        { transform: `scale(${to * 0.94}, ${to * 1.08})`, offset: 0.62 },
        { transform: `scale(${to})` },
      ],
      { duration: SQUEEZE_MS, easing: "ease-in-out", fill: "forwards" },
    );
    window.setTimeout(() => spurt(3), SQUEEZE_MS * 0.3);
  };

  /** The size after rolls down from what it was to what it is. */
  const roll = (from: number, to: number, ms: number) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      sub.textContent = `${size(from)} → ${size(from + (to - from) * eased)}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /** One more page flies in from the right and lands on the pile, a little askew. */
  const page = () => {
    const sheet = h("div", { class: "cv-page" });
    const tilt = (Math.random() - 0.5) * 12;
    const dx = (Math.random() - 0.5) * 4;
    const lift = -Math.min(onDesk, MAX_ON_DESK) * 1.2;
    desk.insertBefore(sheet, staple);
    onDesk++;
    sheet.animate(
      [
        { transform: "translate(96px, -34px) rotate(22deg) scale(0.86)", opacity: 0 },
        { opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px, ${lift}px) rotate(${tilt}deg)`, opacity: 1 },
      ],
      { duration: 480, easing: SPRING, fill: "forwards" },
    );
    // The pile keeps its height: the oldest page under it goes.
    const pages = desk.querySelectorAll(".cv-page");
    if (pages.length > MAX_ON_DESK) pages[0].remove();
  };

  const start = (c: Converting) => {
    stopPages();
    desk.replaceChildren(staple, tag);
    onDesk = 0;
    staple.getAnimations().forEach((a) => a.cancel());
    tag.getAnimations().forEach((a) => a.cancel());
    card.classList.remove("done", "miss");
    card.dataset.kind = c.kind;
    title.textContent = WORKING[c.kind]();
    const names = State.droppedPaths.map((p) => p.split(/[\\/]/).pop() ?? "");
    sub.textContent = names.length > 1 ? t("{n} files are ready.", { n: names.length }) : (names[0] ?? "");
    if (c.kind === "pdf") {
      page();
      pageTimer = window.setInterval(() => {
        // Pictures: one page each. A document: pages until it is done.
        if (c.pages === 0 || onDesk < c.pages) page();
        else stopPages();
      }, PAGE_EVERY_MS);
      return;
    }
    const picture = photo();
    desk.insertBefore(picture, staple);
    const ext = (State.droppedPaths[0] ?? "").split(".").pop()?.toUpperCase() ?? "";
    tag.textContent = c.kind === "jpg" ? ext : "";
    if (c.kind === "small") {
      // Wrung out while it works, a squeeze at a time.
      squeezed = 1;
      squeeze(picture);
      pageTimer = window.setInterval(() => squeeze(picture), SQUEEZE_MS);
      return;
    }
    tag.animate([{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1)" }], { duration: 320, easing: SPRING, fill: "forwards" });
    // A little wobble while it becomes a JPG.
    picture.animate(
      [{ transform: "rotate(0)" }, { transform: "rotate(-5deg)" }, { transform: "rotate(4deg)" }, { transform: "rotate(0)" }],
      { duration: 700, iterations: Infinity, easing: "ease-in-out" },
    );
  };

  const land = (c: Converting, result: Converted) => {
    stopPages();
    // A picture short of its pages gets them all at once: the pile is what was made.
    while (c.kind === "pdf" && c.pages > 0 && onDesk < Math.min(c.pages, MAX_ON_DESK)) page();
    card.classList.add("done");
    title.textContent = result.name;
    sub.textContent = meta(result);
    if (c.kind === "pdf") {
      // Ka-chunk: the staple goes in, the pile jumps, the tag comes.
      staple.animate(
        [{ opacity: 0, transform: "rotate(-40deg) scale(1.9)" }, { opacity: 1, transform: "rotate(-40deg) scale(1)" }],
        { duration: 170, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
      );
      desk.animate([{ transform: "translateY(0)" }, { transform: "translateY(3px)" }, { transform: "translateY(-1px)" }, { transform: "translateY(0)" }], { duration: 260, delay: 150 });
      tag.textContent = "PDF";
      tag.animate([{ opacity: 0, transform: "scale(0) rotate(-12deg)" }, { opacity: 1, transform: "scale(1) rotate(-6deg)" }], { duration: 420, delay: 260, easing: SPRING, fill: "forwards" });
      return;
    }
    const picture = desk.querySelector<HTMLElement>(".cv-photo");
    picture?.getAnimations().forEach((a) => a.cancel());
    if (c.kind === "small") {
      // One last hard squeeze, a pop down to its new size, a jelly wobble; the squares
      // fly, sparkles, the size rolls down and the tag says by how much.
      const b = squeezed;
      picture?.animate(
        [
          { transform: `scale(${b})` },
          { transform: `scale(${b * 1.22}, ${b * 0.74})`, offset: 0.22 },
          { transform: "scale(0.54, 0.7)", offset: 0.42 },
          { transform: "scale(0.7, 0.56)", offset: 0.58 },
          { transform: "scale(0.59, 0.66)", offset: 0.74 },
          { transform: "scale(0.64, 0.61)", offset: 0.88 },
          { transform: "scale(0.62)" },
        ],
        { duration: 860, easing: "ease-out", fill: "forwards" },
      );
      window.setTimeout(() => {
        spurt(9, 1.35);
        sparkle(4);
      }, 190);
      sub.textContent = `${size(result.before)} → ${size(result.before)}`;
      window.setTimeout(() => roll(result.before, result.size, 760), 220);
      tag.textContent = `−${Math.max(1, Math.round((1 - result.size / Math.max(1, result.before)) * 100))}%`;
      tag.animate([{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1) rotate(-6deg)" }], { duration: 420, delay: 480, easing: SPRING, fill: "forwards" });
      return;
    }
    // The tag turns over: what it was, then JPG.
    const flip = tag.animate([{ transform: "scale(1) rotateY(0)" }, { transform: "scale(1) rotateY(90deg)" }], { duration: 160, easing: "ease-in", fill: "forwards" });
    flip.onfinish = () => {
      tag.textContent = "JPG";
      tag.animate([{ transform: "scale(1) rotateY(-90deg)" }, { transform: "scale(1.08) rotateY(0)" }, { transform: "scale(1) rotateY(0)" }], { duration: 300, easing: "ease-out", fill: "forwards" });
    };
  };

  const fail = (error: string) => {
    stopPages();
    desk.querySelectorAll(".cv-page, .cv-photo").forEach((n) => n.getAnimations().forEach((a) => a.pause()));
    card.classList.add("miss");
    title.textContent = t("That didn't work");
    sub.textContent = error;
  };

  return {
    el,
    sync() {
      const c = State.converting;
      if (c === shown) return;
      const before = shown;
      shown = c;
      if (!c) {
        stopPages();
        return;
      }
      // Each run is a new object: working first, then made or failed.
      if (!c.done && !c.error) {
        start(c);
        return;
      }
      // Opened on a run already over: its pile is laid out first.
      if (!before || before.done || before.error) start(c);
      if (c.done) land(c, c.done);
      else fail(c.error ?? "");
    },
  };
}
