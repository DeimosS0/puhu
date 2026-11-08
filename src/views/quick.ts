// The line pulled down from the island (island.ts pullDown): write a timer ("12 dk çay")
// or something to do ("yarın 14:00 diş") and Enter; under the field, what Puhu reads in
// it as it is written, and the timers running (each with its × ) or a few ready lengths.
// And the card a timer rings with: what is ready, OK or five minutes more.

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { Timers, formatLeft, parseTimer, type TimerKind, type TimerSpec } from "../core/timer";
import { parseTask, dayKey } from "../core/today";
import { N_, t, tl } from "../i18n/i18n";
import type { ViewActions, ViewHost } from "./views";

/** The ready lengths, when no timer runs: an egg, a tea, a pause, a round. */
const PRESETS: { seconds: number; kind: TimerKind }[] = [
  { seconds: 180, kind: "egg" },
  { seconds: 300, kind: "hourglass" },
  { seconds: 600, kind: "hourglass" },
  { seconds: 900, kind: "tea" },
];
const KIND_ICON: Record<TimerKind, string> = { tea: "🍵", coffee: "☕", egg: "🥚", hourglass: "⏳" };
const DEFAULT_LABEL = N_("Timer");

/** "45 sn", "12 dk", "1 sa 20 dk". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return t("{n} sec", { n: seconds });
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return t("{0} min", { 0: minutes });
  return minutes > 0 ? `${t("{n} h", { n: hours })} ${t("{0} min", { 0: minutes })}` : t("{n} h", { n: hours });
}

/** What a timer is called: what it was written for, else "Timer". */
export function timerName(label: string): string {
  return label ? label.charAt(0).toLocaleUpperCase() + label.slice(1) : t(DEFAULT_LABEL);
}

export function buildQuick(actions: ViewActions): ViewHost {
  const field = h("input", {
    class: "today-field quick-field", type: "text", spellcheck: "false", maxlength: "120",
    placeholder: tl("12 min tea, tomorrow 14:00 dentist…"),
  }) as HTMLInputElement;
  const send = h("button", { class: "today-add", title: tl("Add"), onclick: () => submit() }, svg(ICONS.arrowUp, 14));
  const reading = h("div", { class: "quick-reading" });
  const chips = h("div", { class: "quick-chips" });
  const line = h("div", { class: "today-line quick-line" }, field, send);
  const stack = h("div", { class: "stack quick-stack" }, line, reading, chips);
  const el = h("div", { class: "view quick" }, h("div", { class: "card" }, stack));

  let chipsFor: string | null = null;

  /** What Puhu reads in the field: a timer, or a line for today's list. */
  const read = (): { timer: TimerSpec | null; text: string } => {
    const text = field.value.trim();
    return { timer: text ? parseTimer(text) : null, text };
  };

  const showReading = () => {
    const { timer, text } = read();
    reading.replaceChildren();
    reading.classList.toggle("on", text !== "");
    if (!text) return;
    if (timer) {
      reading.append(svg(ICONS.timer, 13), document.createTextNode(`${timerName(timer.label)} · ${formatDuration(timer.seconds)}`));
      return;
    }
    const task = parseTask(text, new Date());
    const when = [task.day !== dayKey(new Date()) ? task.day.split("-").reverse().slice(0, 2).join(".") : "", task.time ?? ""].filter(Boolean).join(" ");
    reading.append(svg(ICONS.checklist, 13, { stroke: 2 }), document.createTextNode(when ? `${t("Goes on today's list")} · ${when}` : t("Goes on today's list")));
  };

  const drawChips = () => {
    const now = Date.now();
    const running = Timers.all().filter((x) => x.endsAt > now);
    const key = running.length ? running.map((x) => `${x.id}:${formatLeft(x.endsAt - now)}`).join("|") : "ready";
    if (key === chipsFor) return;
    chipsFor = key;
    if (running.length > 0) {
      chips.replaceChildren(
        ...running.map((x) =>
          h(
            "span",
            { class: "quick-chip running" },
            h("span", { class: "ico", text: KIND_ICON[x.kind] }),
            h("span", { text: timerName(x.label) }),
            h("b", { text: formatLeft(x.endsAt - now) }),
            h("button", { class: "x", title: tl("Cancel"), onclick: () => actions.timerCancel(x.id) }, svg(ICONS.xmark, 8)),
          ),
        ),
      );
      return;
    }
    chips.replaceChildren(
      ...PRESETS.map((p) =>
        h(
          "button",
          { class: "quick-chip", onclick: () => actions.timer({ label: "", seconds: p.seconds, kind: p.kind }) },
          h("span", { class: "ico", text: KIND_ICON[p.kind] }),
          h("span", { text: formatDuration(p.seconds) }),
        ),
      ),
    );
  };

  /** Enter: the line goes up and away into the island, which does the rest. */
  const submit = () => {
    const { timer, text } = read();
    if (!text) return;
    line.animate(
      [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-18px) scale(0.96)", opacity: 0 }],
      { duration: 240, easing: "cubic-bezier(0.4, 0, 1, 1)" },
    );
    field.value = "";
    showReading();
    actions.holdOpen(false);
    if (timer) actions.timer(timer);
    else actions.addToday(text);
  };

  field.addEventListener("focus", () => actions.keyboard(true));
  field.addEventListener("input", () => {
    actions.holdOpen(field.value.trim() !== "");
    showReading();
  });
  field.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === "Enter") {
      e.preventDefault();
      submit();
    }
    // Escape still closes the island; the rest stays in the field.
    if (k !== "Escape") e.stopPropagation();
  });

  return {
    el,
    sync() {
      drawChips();
    },
    focus() {
      chipsFor = null;
      drawChips();
      showReading();
      window.setTimeout(() => field.focus(), 120);
    },
  };
}

export function buildTimerDone(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub" });
  const ok = h("button", { class: "btn primary", text: tl("OK"), onclick: () => actions.timerAnswer(false) });
  const more = h("button", { class: "btn secondary", text: tl("+{n} min", { n: 5 }), onclick: () => actions.timerAnswer(true) });
  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card" }, h("div", { class: "stack", style: "padding:0 18px 0 112px" }, title, sub, h("div", { class: "actions" }, ok, more))),
  );
  return {
    el,
    sync() {
      const timer = State.timerRing;
      if (!timer) return;
      title.textContent = timer.label ? t("{label} is ready!", { label: timerName(timer.label) }) : t("Time's up!");
      sub.textContent = t("{duration} have passed", { duration: formatDuration(timer.seconds) });
    },
  };
}
