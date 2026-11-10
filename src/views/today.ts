// Today's list in the open island (core/today.ts keeps the rules). Puhu on the left;
// on the right the day, what is still to do in the order to do it, and a line to write
// the next one. Written, the line flies up into the list as a slip of paper; ticked, a
// thing is struck through and folds into a paper plane that flies to Puhu, who catches
// it. Opened, the rows unroll one after another. Nothing moves while nothing happens.

import { TODAY_KEY, dayCount, dayKey, parseTask, prune, readTasks, todayList, waited, type TodayTask } from "../core/today";
import { language, t, tl } from "../i18n/i18n";
import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";

/** What the list asks of the island. */
export interface TodayHost {
  keyboard(on: boolean): void;
  holdOpen(on: boolean): void;
  /** Puhu's middle on screen (viewport px), where a plane flies to. */
  puhuAt(): { x: number; y: number } | null;
  /** Puhu takes a slip, catches a plane, sees the day done, or blows the dust off the list. */
  react(kind: "added" | "done" | "allDone" | "blow"): void;
}

const PLANE = "M2.5 11.2 21 3.5l-5.6 17-4.3-6.6zM11.1 13.9 21 3.5";
/** The slip's room round its words, its height, and a row's (as in style.css). */
const SLIP_PAD = 8;
const SLIP_H = 24;
const ROW_H = 26;
/** Puhu's breath in before it comes out (engine.ts blow()). */
const BLOW_MS = 400;

let tasks: TodayTask[] = [];
const listeners = new Set<() => void>();

function load() {
  try {
    tasks = readTasks(localStorage.getItem(TODAY_KEY));
  } catch {
    tasks = [];
  }
}

function save() {
  tasks = prune(tasks, new Date());
  try {
    localStorage.setItem(TODAY_KEY, JSON.stringify(tasks));
  } catch {
    // Kept for this run only.
  }
  for (const fn of listeners) fn();
}

load();
// Another window (the island, the Puhu window's week) changed it: read it again.
window.addEventListener?.("storage", (e) => {
  if (e.key !== TODAY_KEY) return;
  load();
  for (const fn of listeners) fn();
});

/** Today's list as it stands, for the closed island, the peeks and the Puhu window's week. */
export const Today = {
  all(): readonly TodayTask[] {
    return tasks;
  },
  /** Writes one in, read as the island reads it (its day, its time). */
  add(text: string): TodayTask | null {
    if (!text.trim()) return null;
    const task: TodayTask = { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...parseTask(text, new Date()), created: Date.now() };
    tasks.push(task);
    save();
    return task;
  },
  setDone(id: string, done: boolean) {
    const task = tasks.find((x) => x.id === id);
    if (!task) return;
    task.doneAt = done ? Date.now() : undefined;
    save();
  },
  remove(id: string) {
    tasks = tasks.filter((x) => x.id !== id);
    save();
  },
  /** What its time's reminders have done (core/today.ts nextReminder); undefined clears one. */
  mark(id: string, marks: Pick<TodayTask, "told" | "rang" | "again">) {
    const task = tasks.find((x) => x.id === id);
    if (!task) return;
    Object.assign(task, marks);
    save();
  },
  /** Puhu blew the dust off these today: they stay clean until tomorrow. */
  dusted(ids: readonly string[]) {
    const today = dayKey(new Date());
    for (const task of tasks) if (ids.includes(task.id)) task.dusted = today;
    save();
  },
  list(): TodayTask[] {
    return todayList(tasks, new Date());
  },
  /** What to do now: the first on the list. */
  current(): TodayTask | null {
    return this.list()[0] ?? null;
  },
  /** Done today, and still to do today. */
  count(): { done: number; total: number } {
    return dayCount(tasks, new Date());
  },
  /** Things from earlier days still on the list. */
  carried(): number {
    const now = new Date();
    return this.list().filter((x) => waited(x, now) > 0).length;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** The tag beside a thing: how long it has waited, or its time. */
export function tagFor(task: TodayTask, now: Date): { text: string; waited: boolean } | null {
  const days = waited(task, now);
  if (days === 1) return { text: t("From yesterday"), waited: true };
  if (days > 1) {
    const [y, m, d] = task.day.split("-").map(Number);
    const day = new Date(y, m - 1, d).toLocaleDateString(language(), { weekday: "short" });
    return { text: t("Since {day}", { day }), waited: true };
  }
  return task.time ? { text: task.time, waited: false } : null;
}

export function buildToday(host: TodayHost) {
  const date = h("span", { class: "sub" });
  const count = h("span", { class: "today-count" });
  const head = h("div", { class: "today-head" }, h("span", { class: "title", text: tl("Today") }), date, count);
  const list = h("div", { class: "today-list" });
  const empty = h("div", { class: "today-empty sub", text: tl("Nothing for today. Write it below and Puhu keeps it.") });
  const field = h("input", {
    class: "today-field", type: "text", spellcheck: "false", maxlength: "120", placeholder: tl("Add something to do"),
  }) as HTMLInputElement;
  const add = h("button", { class: "today-add", title: tl("Add"), onclick: () => submit() }, svg(ICONS.arrowUp, 14));
  const line = h("div", { class: "today-line" }, field, add);
  const stack = h("div", { class: "stack today-stack" }, head, list, empty, line);
  const card = h("div", { class: "card" }, stack);
  const el = h("div", { class: "view today" }, card);

  let key = "";
  /** Ticked, on their way to Puhu: the list is not redrawn under them until they land. */
  const leaving = new Set<string>();

  /** `unroll`: the list was just opened, its rows come in one after another. */
  function draw(unroll: boolean) {
    if (leaving.size > 0 && !unroll) return;
    const now = new Date();
    const items = todayList(tasks, now);
    const { done, total } = dayCount(tasks, now);
    date.textContent = now.toLocaleDateString(language(), { weekday: "long", day: "numeric", month: "long" });
    count.textContent = total > 0 ? `${done}/${total}` : "";
    count.classList.toggle("all", total > 0 && done === total);
    empty.style.display = items.length === 0 ? "" : "none";
    const next = items.map((x) => x.id + x.text + (x.time ?? "") + waited(x, now)).join("|");
    if (next === key && !unroll) return;
    key = next;
    clear(list);
    items.forEach((task, i) => {
      const check = h("button", { class: "today-check", title: tl("Done"), onclick: () => finish(task, row) }, svg(ICONS.check, 12, { stroke: 2.4 }));
      const text = h("span", { class: "today-text", text: task.text, title: task.text });
      const row = h("div", { class: "today-row", "data-id": task.id }, check, text);
      const tag = tagFor(task, now);
      if (tag) row.append(h("span", { class: tag.waited ? "today-tag waited" : "today-tag", text: tag.text }));
      // Waited from earlier days: dust on it, more the longer it waits, until Puhu
      // blows it off; it settles again overnight.
      const days = waited(task, now);
      if (days > 0 && task.dusted !== dayKey(now)) {
        row.classList.add("dusty");
        row.style.setProperty("--dust", String(Math.min(1, 0.4 + days * 0.2)));
      }
      if (unroll) {
        row.classList.add("unroll");
        row.style.setProperty("--i", String(i));
      }
      list.append(row);
    });
  }

  function submit() {
    const raw = field.value.trim();
    if (!raw) return;
    const from = field.getBoundingClientRect();
    field.value = "";
    // The field's hint waits until the words have lifted off it.
    field.classList.add("sent");
    window.setTimeout(() => field.classList.remove("sent"), 420);
    host.holdOpen(false);
    const task = Today.add(raw);
    if (!task) return;
    // Not today's (tomorrow, Friday): it goes into the day it is for, out of sight.
    const row = list.querySelector<HTMLElement>(`[data-id="${task.id}"]`);
    if (!row) {
      host.react("added");
      return;
    }
    // Its row opens up as the slip flies, the ones under it sliding down; below the
    // list's view, the list glides down to it.
    row.classList.add("arriving");
    const top = row.getBoundingClientRect().top;
    const shift = Math.max(0, top + ROW_H - list.getBoundingClientRect().bottom);
    if (shift > 0) list.scrollBy({ top: shift, behavior: "smooth" });
    fly(row, task.text, from, top - shift);
  }

  /**
   * The written line lifts out of the field as a slip of paper, flies up into its row
   * and, landing, turns back into the row's own text: the same words in the same place
   * the whole way, so nothing blinks out at the start or pops in at the end.
   */
  function fly(row: HTMLElement, text: string, from: DOMRect, rowTop: number) {
    const toLeft = (row.querySelector(".today-text") ?? row).getBoundingClientRect().left;
    const box = card.getBoundingClientRect();
    const slip = h("div", { class: "today-slip", text });
    // Its words over the field's words, then over the row's (once it is open and in view).
    const x0 = from.left - box.left - SLIP_PAD;
    const y0 = from.top - box.top + from.height / 2 - SLIP_H / 2;
    const dx = toLeft - box.left - SLIP_PAD - x0;
    const dy = rowTop - box.top + ROW_H / 2 - SLIP_H / 2 - y0;
    slip.style.left = `${x0}px`;
    slip.style.top = `${y0}px`;
    card.append(slip);
    row.classList.add("waiting");
    const bare = { backgroundColor: "rgba(255, 246, 220, 0)", color: "#f5f6f8", boxShadow: "0 6px 18px rgba(0, 0, 0, 0)" };
    const paper = { backgroundColor: "#fff6dc", color: "#2a2418", boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)" };
    const at = (x: number, y: number, turn: number, grow: number) => `translate(${x}px, ${y}px) rotate(${turn}deg) scale(${grow})`;
    const flight = slip.animate([
      { ...bare, transform: at(0, 0, 0, 1), fontSize: "12.5px", fontWeight: "400" },
      { ...paper, transform: at(dx * 0.08, -6, -2, 1.05), offset: 0.2 },
      { ...paper, transform: at(dx * 0.6, dy * 0.62 - 10, -3, 1.05), offset: 0.58 },
      { ...paper, transform: at(dx, dy, 0, 1), fontSize: "13px", fontWeight: "500", offset: 0.82 },
      { ...bare, transform: at(dx, dy, 0, 1), fontSize: "13px", fontWeight: "500" },
    ], { duration: 820, easing: "cubic-bezier(0.4, 0, 0.25, 1)", fill: "forwards" });
    flight.onfinish = () => {
      row.classList.remove("waiting", "arriving");
      slip.remove();
      host.react("added");
    };
  }

  /** Ticked: struck through, then it folds into a plane that flies to Puhu. */
  function finish(task: TodayTask, row: HTMLElement) {
    if (leaving.has(task.id)) return;
    leaving.add(task.id);
    row.classList.add("done");
    window.setTimeout(() => {
      const at = row.querySelector(".today-text")?.getBoundingClientRect() ?? row.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      const target = host.puhuAt();
      const plane = h("div", { class: "today-plane" }, svg(PLANE, 16, { stroke: 1.6 }));
      const x0 = at.left - box.left + 4;
      const y0 = at.top - box.top + at.height / 2 - 8;
      plane.style.left = `${x0}px`;
      plane.style.top = `${y0}px`;
      card.append(plane);
      const tx = target ? target.x - box.left - 8 - x0 : -x0;
      const ty = target ? target.y - box.top - 8 - y0 : 0;
      const flight = plane.animate([
        { transform: "translate(0, 0) rotate(-200deg) scale(0.4)", opacity: 0 },
        { transform: "translate(6px, -10px) rotate(-170deg) scale(1)", opacity: 1, offset: 0.18 },
        { transform: `translate(${tx * 0.55}px, ${ty * 0.4 - 30}px) rotate(-200deg) scale(1)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${tx}px, ${ty}px) rotate(-150deg) scale(0.6)`, opacity: 0 },
      ], { duration: 820, easing: "cubic-bezier(0.45, 0, 0.3, 1)" });
      row.classList.add("gone");
      flight.onfinish = () => {
        plane.remove();
        const found = tasks.find((x) => x.id === task.id);
        if (found) found.doneAt = Date.now();
        leaving.delete(task.id);
        save();
        host.react(todayList(tasks, new Date()).length === 0 ? "allDone" : "done");
      };
    }, 380);
  }

  field.addEventListener("focus", () => host.keyboard(true));
  field.addEventListener("input", () => host.holdOpen(field.value.trim() !== ""));
  field.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === "Enter") {
      e.preventDefault();
      submit();
    }
    // Escape still closes the island; the rest stays in the field.
    if (k !== "Escape") e.stopPropagation();
  });

  Today.subscribe(() => draw(false));
  // Past midnight, yesterday's list becomes today's.
  let shownDay = dayKey(new Date());

  return {
    el,
    sync() {
      const today = dayKey(new Date());
      if (today !== shownDay) {
        shownDay = today;
        key = "";
      }
      draw(false);
    },
    focus() {
      draw(true);
      window.setTimeout(() => field.focus(), 120);
      // Once the rows have unrolled, Puhu blows the dust off the ones that waited.
      const dusty = [...list.querySelectorAll<HTMLElement>(".today-row.dusty")];
      if (dusty.length === 0) return;
      const rows = list.children.length;
      window.setTimeout(() => {
        if (!el.classList.contains("on")) return;
        host.react("blow");
        Today.dusted(dusty.map((row) => row.dataset.id ?? ""));
        window.setTimeout(() => dusty.forEach((row, i) => {
          row.style.setProperty("--d", `${i * 60}ms`);
          row.classList.add("blown");
        }), BLOW_MS);
      }, 120 + rows * 55 + 380);
    },
  };
}
