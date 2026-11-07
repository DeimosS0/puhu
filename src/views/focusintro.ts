// Focus play's first question (island/focus-intro.ts decides when): will you focus
// with Puhu, then how many rounds a day, then the deal. Same left inset as the
// other cards, Puhu on the left trying on each goal.

import { h, clear } from "./dom";
import { washRGBA } from "../core/layout";
import { POMODORO_ID } from "../core/pomodoro";
import { State } from "../core/state";
import { FocusIntro, GOALS } from "../island/focus-intro";
import type { ViewHost } from "./views";
import { language, t, tn } from "../i18n/i18n";

function btn(label: string, kind: "primary" | "secondary", onClick: () => void): HTMLButtonElement {
  return h("button", { class: `btn ${kind}`, onclick: onClick }, h("span", { text: label }));
}

const rounds = (n: number) => tn("{count} round", "{count} rounds", n);

export function buildFocusIntro(): ViewHost {
  const stack = h("div", { class: "stack intro-stack" });
  const card = h("div", { class: "card wash" }, stack);
  card.style.setProperty("--wash", washRGBA("amber"));
  const el = h("div", { class: "view" }, card);

  // Rebuilt only when what it shows changes: rebuilding between a mouse-down
  // and a mouse-up would swallow the click.
  let key = "";

  function ask() {
    stack.append(
      h("div", { class: "title", text: t("Focus with me?") }),
      h("div", { class: "sub intro-line", text: t("Your Pomodoro rounds keep a streak alive, I grow with you, and there are secret badges to find.") }),
      h("div", { class: "actions" },
        btn(t("Yes, let's go!"), "primary", () => FocusIntro.yes()),
        btn(t("Not now"), "secondary", () => FocusIntro.notNow()),
      ),
    );
  }

  function goal() {
    const goals = h("div", { class: "intro-goals" });
    for (const g of GOALS) {
      goals.append(h("button", {
        class: `intro-goal${g.rounds === FocusIntro.goal ? " on" : ""}`,
        onclick: () => FocusIntro.pick(g.rounds),
      },
        h("span", { class: "n", text: t(g.name) }),
        h("span", { class: "r", text: rounds(g.rounds) }),
      ));
    }
    stack.append(
      h("div", { class: "title", text: t("How many rounds a day?") }),
      goals,
      h("div", { class: "actions" }, btn(t("OK"), "primary", () => FocusIntro.confirm())),
    );
  }

  function deal() {
    stack.append(h("div", { class: "title", text: t("Deal: {rounds} a day", { rounds: rounds(FocusIntro.goal) }) }));
    // No slot was free for the Pomodoro's pill: a round started now could not be paused or stopped.
    if (!State.isKept(POMODORO_ID)) {
      stack.append(
        h("div", { class: "sub intro-line", text: t("Turn on the Pomodoro in Settings → Active pills to start your rounds.") }),
        h("div", { class: "actions" }, btn(t("OK"), "primary", () => FocusIntro.done())),
      );
      return;
    }
    stack.append(
      h("div", { class: "sub intro-line", text: t("Shall we start the first one together?") }),
      h("div", { class: "actions" },
        btn(t("Start the first round"), "primary", () => FocusIntro.startFirst()),
        btn(t("Later"), "secondary", () => FocusIntro.done()),
      ),
    );
  }

  function later() {
    stack.append(
      h("div", { class: "title", text: t("Maybe later, then") }),
      h("div", { class: "sub intro-line", text: t("You can turn it on any time in Settings.") }),
      h("div", { class: "actions" }, btn(t("OK"), "primary", () => FocusIntro.done())),
    );
  }

  return {
    el,
    sync() {
      const next = `${FocusIntro.step}~${FocusIntro.goal}~${language()}`;
      if (next === key) return;
      key = next;
      clear(stack);
      ({ ask, goal, deal, later })[FocusIntro.step]();
    },
  };
}
