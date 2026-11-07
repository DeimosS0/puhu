// The Pomodoro's card, its pill focused in the open island: the time left on a ring,
// play or pause, stop and on to the next phase, the length of the rounds, and four dots
// for the rounds towards the long break. With focus play on, a thin ring round the dial
// has a segment for each round of the day's goal, and the streak's flame sits by the
// dots. It redraws itself once a second while it is on screen, and not at all otherwise.

import { POMODORO_PRESETS, Pomodoro, formatRemaining } from "../core/pomodoro";
import { flameTier } from "../core/progress";
import { tl } from "../i18n/i18n";
import { progress } from "../island/progress";
import { h, svg } from "./dom";
import { flame } from "./flame";
import { ICONS } from "./icons";

/** The phases' colours, as in the compact island. */
export const POMODORO_COLOR = { focus: "#ff7a59", break: "#6ccb5f", long: "#64b5ff" } as const;

const R = 25;
const C = 2 * Math.PI * R;
/** The day's goal round the dial: a segment for each round, a little gap between. */
const GR = 30.5;
const GC = 2 * Math.PI * GR;
const GAP = 2.4;

/** The first `done` of `goal` segments drawn, the rest left out. */
function segments(done: number, goal: number): string {
  const seg = GC / goal - GAP;
  const parts: number[] = [];
  for (let i = 0; i < done; i++) parts.push(seg, GAP);
  return [...parts, 0, GC].map((n) => n.toFixed(2)).join(" ");
}

/** `openPuhuCard`: the streak beside the dots opens Puhu's card. */
export function buildPomodoroCard(openPuhuCard: () => void) {
  const ns = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(ns, "svg");
  ring.setAttribute("viewBox", "-4 -4 68 68");
  const circle = (cls: string, r = R) => {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "30");
    c.setAttribute("cy", "30");
    c.setAttribute("r", String(r));
    c.setAttribute("class", cls);
    ring.append(c);
    return c;
  };
  const goalTrack = circle("goal-track", GR);
  const goalArc = circle("goal-arc", GR);
  circle("track");
  const arc = circle("arc");
  arc.setAttribute("stroke-dasharray", C.toFixed(2));
  const time = h("div", { class: "pomo-time" });
  const dial = h("div", { class: "pomo-dial" }, ring as unknown as HTMLElement, time);

  const phase = h("div", { class: "pomo-phase" });
  const dots = h("div", { class: "pomo-dots" }, h("i"), h("i"), h("i"), h("i"));
  const streak = h("button", { class: "pomo-streak", title: tl("Puhu's card"), onclick: openPuhuCard });

  const main = h("button", { class: "pomo-main", onclick: () => {
    if (!Pomodoro.running) Pomodoro.start();
    else if (Pomodoro.paused) Pomodoro.resume();
    else Pomodoro.pause();
  } });
  const stop = h("button", { class: "pomo-btn", title: tl("Stop"), onclick: () => Pomodoro.stop() }, svg(ICONS.xmark, 12));
  const next = h("button", { class: "pomo-btn", title: tl("Next"), onclick: () => Pomodoro.skip() }, svg(ICONS.forward, 12));
  const buttons = h("div", { class: "pomo-buttons" }, stop, main, next);

  const presets = POMODORO_PRESETS.map(([focus, rest], i) =>
    h("button", { class: "pomo-preset", onclick: () => Pomodoro.setPreset(i) }, `${focus}/${rest}`));
  const presetRow = h("div", { class: "pomo-presets" }, ...presets);

  const side = h("div", { class: "pomo-side" }, h("div", { class: "pomo-phase-row" }, phase, dots, streak), buttons, presetRow);
  const el = h("div", { class: "pomo-card" }, dial, side);

  let shownMain = "";
  let goalKey = "";
  let streakKey = "";

  /** Focus play's part, redrawn only when the day's rounds, the goal or the streak change. */
  function syncProgress() {
    const s = progress.state;
    const on = progress.on;
    const goal = s.today.goal;
    const nextGoal = on ? `${Math.min(s.today.rounds, goal)}/${goal}` : "";
    if (nextGoal !== goalKey) {
      // Reached just now: the ring shines once.
      if (on && s.today.met && goalKey !== "" && !el.classList.contains("met")) {
        el.classList.remove("shine");
        void el.offsetWidth;
        el.classList.add("shine");
      }
      goalKey = nextGoal;
      el.classList.toggle("goal", on);
      el.classList.toggle("met", on && s.today.met);
      goalTrack.setAttribute("stroke-dasharray", segments(goal, goal));
      goalArc.setAttribute("stroke-dasharray", segments(Math.min(s.today.rounds, goal), goal));
    }
    const lit = s.today.rounds > 0;
    const nextStreak = on && s.streak > 0 ? `${flameTier(s.streak)}|${lit}|${s.streak}` : "";
    if (nextStreak !== streakKey) {
      streakKey = nextStreak;
      streak.replaceChildren();
      if (nextStreak) streak.append(flame(flameTier(s.streak), 12, !lit) as unknown as HTMLElement, String(s.streak));
    }
  }

  function sync() {
    syncProgress();
    const running = Pomodoro.running;
    const p = Pomodoro.phase ?? "focus";
    el.style.setProperty("--pomo", POMODORO_COLOR[p]);
    el.classList.toggle("idle", !running);
    el.classList.toggle("paused", Pomodoro.paused);
    time.textContent = formatRemaining(running ? Pomodoro.remaining() : Pomodoro.length("focus"));
    arc.setAttribute("stroke-dashoffset", (C * (1 - Pomodoro.progress())).toFixed(2));
    phase.textContent = String(p === "focus" ? tl("Focus") : p === "long" ? tl("Long break") : tl("Break"));
    const mainKind = !running ? "start" : Pomodoro.paused ? "resume" : "pause";
    if (mainKind !== shownMain) {
      shownMain = mainKind;
      main.replaceChildren(svg(mainKind === "pause" ? ICONS.pause : ICONS.play, 13));
      main.title = String(mainKind === "start" ? tl("Start a Pomodoro") : mainKind === "pause" ? tl("Pause") : tl("Play"));
    }
    stop.style.visibility = running ? "" : "hidden";
    next.style.visibility = running ? "" : "hidden";
    presets.forEach((b, i) => b.classList.toggle("on", i === Pomodoro.preset));
    [...dots.children].forEach((d, i) => d.classList.toggle("on", i < Pomodoro.dots));
  }
  Pomodoro.onTick(() => {
    if (el.isConnected) sync();
  });
  return { el, sync };
}
