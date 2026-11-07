// Puhu's card (hold Puhu in the open island, or the streak beside the Pomodoro's dots).
// On the left, him: his level and how far into it, the streak, today against the goal,
// the shields, the feathers, the rounds so far, the badges earned (newest first). On the
// right, the day: its three quests, the egg they hatch, and the daily goal to change.
// Focus play at a glance; the whole of it will be the Nest's.

import { BADGES, badgeDef, levelTitle, tierColor } from "../core/badges";
import { washRGBA } from "../core/layout";
import { flameTier } from "../core/progress";
import { QUESTS, type EggReward } from "../core/quests";
import { language, t, tn } from "../i18n/i18n";
import { GOALS } from "../island/focus-intro";
import { chooseGoal, progress } from "../island/progress";
import { Bridge } from "../core/bridge";
import { LEAGUE_COLOR, leagueName } from "./league";
import { h, clear, svg } from "./dom";
import { EGG_ICON, FEATHER_ICON, SHIELD_ICON, flame } from "./flame";
import type { ViewActions, ViewHost } from "./views";

/** As many badges as fit on one line; the count says how many there are. */
const MAX_BADGES = 7;
const ROUND_ICON = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 1 0 0-8z";
const TICK_ICON = "M7.5 12.4l3 3 6-6.4";
/** The way into the Nest: Puhu's tree. */
const NEST_ICON = "M12 21v-6M12 15l-3-2.5M12 13l3-2M7.5 13.5a4.5 4.5 0 0 1-1-8.4A5 5 0 0 1 16.4 5a4 4 0 0 1 .1 8.5z";

function chip(icon: Element, text: string, title?: string): HTMLElement {
  return h("span", { class: "puhu-chip", title }, icon as HTMLElement, h("span", { text }));
}

/** Today's rounds against the goal, as a small ring. */
function todayRing(done: number, goal: number): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", "13");
  el.setAttribute("height", "13");
  el.setAttribute("class", "today-ring");
  const c = 2 * Math.PI * 9;
  for (const [cls, part] of [["track", 1], ["arc", Math.min(1, done / goal)]] as const) {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "9");
    circle.setAttribute("class", cls);
    circle.setAttribute("stroke-dasharray", `${(c * part).toFixed(2)} ${c.toFixed(2)}`);
    el.append(circle);
  }
  return el;
}

/** What an egg held, in a few words. */
export function eggText(reward: EggReward): string {
  if (reward.kind === "feathers") return tn("{count} feather", "{count} feathers", reward.n);
  return reward.kind === "shield" ? t("A shield") : t("Double points for an hour");
}

export function buildPuhuCard(actions: ViewActions): ViewHost {
  const stack = h("div", { class: "stack puhu-stack" });
  const card = h("div", { class: "card wash" }, stack);
  card.style.setProperty("--wash", washRGBA("amber"));
  const el = h("div", { class: "view" }, card);

  // Rebuilt only when what it shows changes: rebuilding between a mouse-down
  // and a mouse-up would swallow the click.
  let key = "";

  function him(): HTMLElement {
    const s = progress.state;
    const fill = h("div", { class: "fill" });
    fill.style.width = `${Math.round((s.into / s.size) * 100)}%`;
    const chips = h("div", { class: "puhu-chips" },
      chip(flame(flameTier(s.streak), 13, s.today.rounds === 0), tn("{count}-day streak", "{count}-day streak", s.streak)),
      chip(todayRing(s.today.rounds, s.today.goal), t("{done}/{goal} today", { done: s.today.rounds, goal: s.today.goal })),
    );
    if (s.shields > 0) chips.append(chip(svg(SHIELD_ICON, 12, { stroke: 2 }), String(s.shields), t("Shields")));
    chips.append(
      chip(svg(FEATHER_ICON, 12, { stroke: 2 }), String(s.feathers), t("Feathers")),
      chip(svg(ROUND_ICON, 12, { stroke: 2 }), tn("{count} round", "{count} rounds", s.rounds)),
    );
    if (s.potionUntil > Date.now()) {
      const until = new Date(s.potionUntil).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });
      chips.append(h("span", { class: "puhu-chip potion", text: t("Double points until {time}", { time: until }) }));
    }

    // The race against one's own past: this week, and last week by the same moment of it.
    const r = s.race;
    const race = h("div", { class: "puhu-race", title: t("Points this week, against last week by this time") });
    const top = Math.max(r.points, r.pace, 1);
    for (const [cls, label, value] of [["you", t("This week"), r.points], ["past", t("Last week by now"), r.pace]] as const) {
      const fill = h("span", { class: "fill" });
      fill.style.width = `${Math.round((value / top) * 100)}%`;
      const name = h("span", { class: "l", text: label });
      // This week in its league's colour, the league named on hover.
      if (cls === "you" && r.league) {
        name.style.color = LEAGUE_COLOR[r.league];
        name.title = leagueName(r.league);
      }
      race.append(h("div", { class: `race-row ${cls}` }, name, h("span", { class: "track" }, fill), h("span", { class: "v", text: String(value) })));
    }

    const badges = h("div", { class: "puhu-badges" });
    for (const b of s.badges.slice(0, MAX_BADGES)) {
      const def = badgeDef(b.id);
      if (!def) continue;
      const medal = h("span", { class: "medal", title: `${t(def.name)} · ${def.hint(def.tiers[b.tier - 1])}` }, svg(def.icon, 12, { stroke: 2 }) as unknown as HTMLElement);
      medal.style.setProperty("--medal", tierColor(def, b.tier));
      badges.append(medal);
    }
    // Secret ones are counted apart: how many there are to find is part of the secret.
    const secrets = s.badges.filter((b) => badgeDef(b.id)?.secret).length;
    if (s.badges.length === 0) badges.append(h("span", { class: "puhu-none", text: t("Badges come with your rounds.") }));
    else badges.append(h("span", { class: "puhu-count", text: `${s.badges.length - secrets}/${BADGES.length}` }));
    if (secrets > 0) badges.append(h("span", { class: "puhu-count secret", title: t("Secret badges"), text: `✦ ${secrets}` }));

    return h("div", { class: "puhu-col" },
      h("div", { class: "puhu-head" },
        h("span", { class: "title", text: t("Level {level}", { level: s.level }) }),
        h("span", { class: "puhu-rank", text: t(levelTitle(s.level)) }),
        h("span", { class: "puhu-xp", text: `${s.into} / ${s.size}` }),
        h("button", { class: "puhu-nest", title: t("Nest"), onclick: () => void Bridge.openSettingsWindow("nest") }, svg(NEST_ICON, 13, { stroke: 2 }) as unknown as HTMLElement),
      ),
      h("div", { class: "puhu-bar" }, fill),
      chips,
      ...(r.points > 0 || r.pace > 0 || r.last > 0 ? [race] : []),
      badges,
    );
  }

  function day(): HTMLElement {
    const s = progress.state;
    const egg = s.today.egg;
    const eggEl = h("span", { class: `puhu-egg${egg ? " hatched" : ""}`, title: egg ? eggText(egg) : t("All three quests hatch it") },
      svg(EGG_ICON, 13, { stroke: 2 }) as unknown as HTMLElement,
      ...(egg ? [h("span", { text: eggText(egg) })] : []),
    );
    const quests = h("div", { class: "puhu-quests" });
    for (const q of s.today.quests) {
      const def = QUESTS.find((d) => d.id === q.id);
      if (!def) continue;
      quests.append(h("div", { class: `puhu-quest${q.done ? " done" : ""}` },
        h("span", { class: "box" }, ...(q.done ? [svg(TICK_ICON, 10, { stroke: 2.6 }) as unknown as HTMLElement] : [])),
        h("span", { class: "q", text: def.text(q.target), title: def.text(q.target) }),
        h("span", { class: "n", text: q.done ? "" : `${q.value}/${q.target}` }),
      ));
    }
    const goals = h("div", { class: "puhu-goals" }, h("span", { class: "l", text: t("Daily goal") }));
    for (const g of GOALS) {
      goals.append(h("button", {
        class: `puhu-goal${g.rounds === s.today.goal ? " on" : ""}`,
        title: t(g.name),
        onclick: () => {
          if (g.rounds === s.today.goal) return;
          actions.blip();
          void chooseGoal(g.rounds);
        },
      }, String(g.rounds)));
    }
    return h("div", { class: "puhu-col" },
      h("div", { class: "puhu-day" }, h("span", { class: "l", text: t("Today's quests") }), eggEl),
      quests,
      goals,
    );
  }

  return {
    el,
    sync() {
      const s = progress.state;
      const potion = s.potionUntil > Date.now() ? s.potionUntil : 0;
      const next = JSON.stringify([s.level, s.into, s.streak, s.today, s.shields, s.feathers, s.rounds, s.badges, s.race, potion, language()]);
      if (next === key) return;
      key = next;
      clear(stack);
      stack.append(h("div", { class: "puhu-cols" }, him(), day()));
    },
  };
}
