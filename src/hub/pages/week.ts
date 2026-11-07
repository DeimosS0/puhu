// Today's list in the Puhu window, as a week: a strip of seven days, Monday first, each
// with a dot for every thing on it (green done, amber still to do), and under it the day
// picked, in full. Past days keep what was done on them; today has its list (what waited
// from before on top); the days ahead what is for them. A line writes one in, read as the
// island reads it ("yarın 14:00 …"); a thing is ticked or unticked, or deleted. The
// island's own list (views/today.ts) keeps the things; both windows follow each other.

import { h, clear } from "../../views/dom";
import { language, t } from "../../i18n/i18n";
import { dayItems, dayKey, weekStart, type DayItem } from "../../core/today";
import { Today, tagFor } from "../../views/today";
import type { HubContext } from "../shell";
import { button, card, icon, iconButton } from "../ui";

/** Dots under a day in the strip, at most. */
const MAX_DOTS = 6;

export function weekPage(page: HTMLElement, ctx: HubContext) {
  let offset = 0;
  let picked = dayKey(new Date());
  const field = h("input", { class: "hub-input", type: "text", spellcheck: "false", maxlength: "120", placeholder: t("Add something to do") }) as HTMLInputElement;
  field.style.flex = "1";
  const line = card(h("div", { class: "hub-row" }, field, button(t("Add"), () => submit(), "primary")));
  const nav = h("div", { class: "week-nav" },
    iconButton("chevronLeft", t("Previous"), () => go(offset - 1)),
    button(t("This week"), () => go(0, dayKey(new Date())), "", true),
    iconButton("chevronRight", t("Next"), () => go(offset + 1)),
  );
  const strip = h("div", { class: "week-strip" });
  const dayTitle = h("div", { class: "week-title" });
  const list = h("div", { class: "week-items" });
  const dayCard = card(dayTitle, list);
  page.append(
    ctx.hero("week", t("Today"), t("What there is to do, day by day: written in the island (Ctrl+Alt+B) or here."), [nav]),
    h("div", { class: "week-body" }, line, strip, dayCard),
  );

  /** Another week; its first day picked unless one is given. */
  function go(next: number, day?: string) {
    offset = next;
    picked = day ?? dayKey(weekStart(new Date(), offset));
    draw();
  }

  function submit() {
    const task = Today.add(field.value);
    if (!task) return;
    field.value = "";
    // Written for another day: that day comes up, in its week.
    const now = new Date();
    const [y, m, d] = task.day.split("-").map(Number);
    const weeks = Math.round((weekStart(new Date(y, m - 1, d)).getTime() - weekStart(now).getTime()) / (7 * 86_400_000));
    go(weeks, task.day < dayKey(now) ? dayKey(now) : task.day);
  }

  field.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      submit();
    }
  });

  function row(it: DayItem): HTMLElement {
    const check = h("button", { class: "week-check", title: t("Done"), onclick: () => Today.setDone(it.task.id, !it.done) });
    check.append(icon("check"));
    const remove = h("button", { class: "week-remove", title: t("Delete"), onclick: () => Today.remove(it.task.id) });
    remove.append(icon("x"));
    const el = h("div", { class: `week-item${it.done ? " done" : ""}${it.waited > 0 ? " waited" : ""}` },
      check, h("span", { class: "text", text: it.task.text, title: it.task.text }));
    const tag = it.done ? null : tagFor(it.task, new Date());
    if (tag) el.append(h("span", { class: tag.waited ? "tag waited" : "tag", text: tag.text }));
    el.append(remove);
    return el;
  }

  function draw() {
    const now = new Date();
    const today = dayKey(now);
    const monday = weekStart(now, offset);
    clear(strip);
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const key = dayKey(date);
      const items = dayItems(Today.all(), key, now);
      const dots = h("span", { class: "dots" });
      for (const it of items.slice(0, MAX_DOTS)) dots.append(h("i", { class: it.done ? "done" : it.waited > 0 ? "waited" : "" }));
      strip.append(h("button", {
        class: `week-pill${key === today ? " today" : ""}${key === picked ? " on" : ""}${key < today ? " past" : ""}`,
        onclick: () => {
          picked = key;
          draw();
        },
      },
      h("span", { class: "name", text: date.toLocaleDateString(language(), { weekday: "short" }) }),
      h("b", { text: String(date.getDate()) }),
      dots));
    }
    const [y, m, d] = picked.split("-").map(Number);
    dayTitle.textContent = new Date(y, m - 1, d).toLocaleDateString(language(), { weekday: "long", day: "numeric", month: "long" });
    const items = dayItems(Today.all(), picked, now);
    clear(list);
    for (const it of items) list.append(row(it));
    if (items.length === 0) list.append(h("div", { class: "week-empty", text: "—" }));
  }

  const stop = Today.subscribe(draw);
  ctx.onLeave = () => void stop();
  draw();
}
