// A badge or a level just earned (Island.showToast): the island opens on it for a few
// seconds, Puhu celebrating on the left, the medal catching the light, what it is and
// how it was earned. A click opens Puhu's card.

import { badgeDef, levelTitle, tierColor } from "../core/badges";
import { washRGBA } from "../core/layout";
import { language, t, tn } from "../i18n/i18n";
import { Toast } from "../island/toast";
import { h, clear, svg } from "./dom";
import type { ViewActions, ViewHost } from "./views";

const STAR_ICON = "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z";
const TIERS = [() => t("Bronze"), () => t("Silver"), () => t("Gold")];

export function buildBadgeToast(actions: ViewActions): ViewHost {
  const stack = h("div", { class: "stack toast-stack" });
  const card = h("div", { class: "card wash toast-card", onclick: () => actions.setView("puhuCard") }, stack);
  card.style.setProperty("--wash", washRGBA("amber"));
  const el = h("div", { class: "view" }, card);
  let key = "";

  return {
    el,
    sync() {
      const m = Toast.moment;
      const next = `${Toast.generation}~${language()}`;
      if (!m || next === key) return;
      key = next;
      clear(stack);
      let color = "#ffd166";
      let icon = STAR_ICON;
      let eyebrow = "";
      let title = "";
      let sub = "";
      if (m.kind === "level") {
        eyebrow = t("Level up!");
        title = `${t("Level {level}", { level: m.level })} · ${t(levelTitle(m.level))}`;
        sub = `+${tn("{count} feather", "{count} feathers", 10)}`;
      } else if (m.kind === "badge") {
        const def = badgeDef(m.id);
        if (!def) return;
        color = tierColor(def, m.tier);
        icon = def.icon;
        eyebrow = def.secret ? t("Secret badge found!") : t("New badge!");
        title = def.tiers.length > 1 ? `${t(def.name)} · ${TIERS[m.tier - 1]()}` : t(def.name);
        sub = def.hint(def.tiers[m.tier - 1]);
      } else {
        return;
      }
      const medal = h("span", { class: "toast-medal" }, svg(icon, 24, { stroke: 2 }) as unknown as HTMLElement);
      stack.style.setProperty("--medal", color);
      stack.append(h("div", { class: "toast-row" },
        medal,
        h("div", { class: "toast-text" },
          h("div", { class: "toast-eyebrow", text: eyebrow }),
          h("div", { class: "title one-line", text: title }),
          h("div", { class: "sub toast-sub", text: sub }),
        ),
      ));
    },
  };
}
