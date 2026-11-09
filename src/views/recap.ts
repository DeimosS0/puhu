// Weekly recap card and its share panel. Rather than a separate share
// panel, the card flips to a share mode inside the island, because a
// window created after launch comes up blank in WebView2 (see lib.rs).
//
// It opens on the week's sky (recap/sky.ts): its constellations twinkle in once, then
// nothing moves; beside them the week's title, its line and three numbers. A week with
// agents has their page too. The image is drawn once, when share mode opens.

import { h, clear } from "./dom";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { washRGBA } from "../core/layout";
import { Recap } from "../recap/recap";
import { drawConstellations, renderShareImage, skyWords, toPngBlob, toPngDataUrl, trendWords } from "../recap/share";
import type { WeekSky } from "../recap/sky";
import {
  addDays, dayKey, formatCount, formatDuration, weekRangeLabel, type WeeklySummary,
} from "../recap/summary";
import type { ViewActions, ViewHost } from "./views";
import { language, onLanguageChange, t, tl, type Msg } from "../i18n/i18n";

/** User-visible strings, in the current language (src/i18n). */
const T = {
  get title() { return t("Weekly recap"); },
  get noActivity() { return t("No stars last week"); },
  get noActivitySub() { return t("Your sky fills with focus rounds, things done and agent sessions. Check back next Monday."); },
  get coding() { return t("coding"); },
  get session() { return t("session"); },
  get sessions() { return t("sessions"); },
  get file() { return t("file"); },
  get files() { return t("files"); },
  get lines() { return t("lines"); },
  get commands() { return t("commands"); },
  get topAgent() { return t("Top agent"); },
  get topProject() { return t("Top project"); },
  get busiestDay() { return t("Busiest day"); },
  get longest() { return t("Longest session"); },
  get permissions() { return t("Permissions"); },
  allowedDenied: (allowed: number, denied: number) => t("{allowed} allowed, {denied} denied", { allowed, denied }),
  get questions() { return t("Questions"); },
  get ok() { return t("OK"); },
  get saving() { return t("Saving…"); },
  savedAs: (name: string) => t("Saved as {name}", { name }),
  get copied() { return t("Copied — paste it anywhere."); },
  get copyUnavailable() { return t("Copying images isn't available here — use Save image."); },
};

function btn(label: string | Msg, kind: "primary" | "secondary", onClick: () => void): HTMLButtonElement {
  return h("button", { class: `btn ${kind}`, onclick: onClick }, h("span", { text: label }));
}

function chip(value: string | HTMLElement, label: string): HTMLElement {
  return h("div", { class: "recap-chip" },
    typeof value === "string" ? h("div", { class: "v", text: value }) : value,
    h("div", { class: "l", text: label }),
  );
}

/** One line of the facts on the right: its name, and its value in white. */
function fact(label: string, value: string): HTMLElement {
  return h("div", { class: "recap-fact" },
    h("span", { class: "l", text: label, title: label }),
    h("span", { class: "n", text: value, title: value }),
  );
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildRecap(actions: ViewActions): ViewHost {
  const card = h("div", { class: "card wash recap-card" });
  card.style.setProperty("--wash", washRGBA("indigo"));
  const el = h("div", { class: "view" }, card);

  let built = -1;
  let shareCanvas: HTMLCanvasElement | null = null;
  /** Share mode's redraw, while it is open: a language change redraws the image. */
  let redrawShare: (() => void) | null = null;

  // In place: the summary is redrawn in the new language, share mode keeps
  // its state (its labels follow by themselves) and only redraws the image.
  onLanguageChange(() => {
    if (built === -1) return;
    if (redrawShare) redrawShare();
    else showSummary();
  });

  /**
   * The week day by day: a bar for each day's sessions, rising one after another as
   * the card opens, the busiest one in indigo and named beside them.
   */
  function weekBars(s: WeeklySummary): HTMLElement {
    const top = Math.max(1, ...s.daySessions);
    const busiest = s.daySessions.indexOf(top);
    const bars = h("div", { class: "recap-bars" });
    s.daySessions.forEach((n, i) => {
      const day = addDays(s.weekStart, i);
      const bar = h("i");
      bar.style.height = `${n > 0 ? Math.max(12, Math.round((n / top) * 100)) : 0}%`;
      bar.style.setProperty("--i", String(i));
      bars.append(h("div", {
        class: n > 0 && i === busiest ? "recap-bar top" : "recap-bar",
        title: `${day.toLocaleDateString(language(), { weekday: "long" })} · ${n} ${plural(n, T.session, T.sessions)}`,
      }, h("span", { class: "col" }, bar), h("span", { class: "d", text: day.toLocaleDateString(language(), { weekday: "narrow" }) })));
    });
    const week = h("div", { class: "recap-week" }, bars);
    if (s.busiestDay) {
      week.append(h("div", { class: "recap-busiest" },
        h("span", { class: "l", text: T.busiestDay }),
        h("span", { class: "n", text: t(s.busiestDay) }),
      ));
    }
    return week;
  }

  function summaryBody(s: WeeklySummary): HTMLElement {
    const chips = h("div", { class: "recap-chips" },
      chip(formatCount(s.sessionCount), plural(s.sessionCount, T.session, T.sessions)),
      chip(formatCount(s.filesChanged), plural(s.filesChanged, T.file, T.files)),
    );
    if (s.linesAdded + s.linesRemoved > 0) {
      chips.append(chip(h("div", { class: "v lines" },
        h("span", { class: "add", text: `+${formatCount(s.linesAdded)}` }),
        h("span", { class: "del", text: ` −${formatCount(s.linesRemoved)}` }),
      ), T.lines));
    }
    if (s.commandsRun > 0) chips.append(chip(formatCount(s.commandsRun), T.commands));

    const facts = h("div", { class: "recap-facts" });
    if (s.topAgent) facts.append(fact(T.topAgent, s.topAgent));
    if (s.topProject) facts.append(fact(T.topProject, s.topProject));
    if (s.longestSessionMinutes > 1) facts.append(fact(T.longest, formatDuration(s.longestSessionMinutes)));
    if (s.permissionsAllowed + s.permissionsDenied > 0) {
      facts.append(fact(T.permissions, T.allowedDenied(s.permissionsAllowed, s.permissionsDenied)));
    }
    if (s.questions > 0) facts.append(fact(T.questions, formatCount(s.questions)));

    return h("div", { class: "stack recap-body" },
      h("div", { class: "recap-main" },
        h("div", { class: "recap-head" },
          h("span", { class: "recap-title", text: T.title }),
          h("span", { class: "recap-range", text: weekRangeLabel(s) }),
        ),
        h("div", { class: "recap-hero" },
          h("span", { class: "v", text: formatDuration(s.totalMinutes) }),
          h("span", { class: "l", text: T.coding }),
        ),
        weekBars(s),
        h("div", { class: "actions" },
          ...(Recap.sky && Recap.sky.timeStars + Recap.sky.doneStars > 0 ? [btn(tl("Back"), "secondary", showSummary)] : []),
          btn(T.ok, "secondary", () => actions.collapse()),
        ),
      ),
      h("div", { class: "recap-side" }, chips, facts),
    );
  }

  /** How long the constellations take to twinkle in. */
  const TWINKLE_MS = 1400;

  /** The week's sky, small, its stars coming in one after another, then still. */
  function skyCanvas(sky: WeekSky): HTMLCanvasElement {
    const W = 200;
    const H = 150;
    const canvas = h("canvas", { class: "recap-sky" }) as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    const total = sky.stars.length;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    const frame = (now: number) => {
      const k = reduced ? 1 : Math.min(1, (now - started) / TWINKLE_MS);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawConstellations(ctx, sky, W, H, Math.ceil(total * (1 - Math.pow(1 - k, 2))), 2.4);
      if (k < 1 && canvas.isConnected) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return canvas;
  }

  /** Counting working time too: asked once, on this card (settings countWork). */
  function askCountWork(): HTMLElement | null {
    if (State.settings.countWork !== null) return null;
    const answer = (on: boolean) => {
      State.settings.countWork = on;
      void Bridge.saveSettings(State.settings);
      showSummary();
    };
    return h("div", { class: "recap-ask", title: t("Only how long you work in coding, design and writing programs, kept 14 days; never their names.") },
      h("span", { text: t("Count your working time too, for a fuller sky?") }),
      h("button", { class: "link-btn", text: tl("Yes"), onclick: () => answer(true) }),
      h("button", { class: "link-btn dim", text: tl("No thanks"), onclick: () => answer(false) }),
    );
  }

  function skyBody(sky: WeekSky): HTMLElement {
    const words = skyWords(sky);
    const compare = trendWords(Recap.compare);
    const numbers = h("div", { class: "recap-numbers" },
      h("span", {}, h("b", { text: String(sky.timeStars + sky.doneStars) }), h("i", { text: t("stars") })),
      h("span", {}, h("b", { text: formatDuration(sky.minutes) }), h("i", { text: t("at work") })),
      h("span", {}, h("b", { text: String(sky.doneStars) }), h("i", { text: t("things done") })),
    );
    const buttons = h("div", { class: "actions" },
      btn(t("Share"), "primary", () => showShare(sky)),
      ...(Recap.summary ? [btn(t("Agents"), "secondary", () => showAgents())] : []),
      btn(T.ok, "secondary", () => actions.collapse()),
    );
    return h("div", { class: "stack recap-skybody" },
      skyCanvas(sky),
      h("div", { class: "recap-skytext" },
        h("div", { class: "recap-kicker", text: `${t("Your week")} · ${weekRangeLabel(sky)}` }),
        h("div", { class: "recap-name", text: words.title }),
        h("div", { class: "recap-line", text: words.line }),
        words.day ? h("div", { class: "recap-day", text: words.day }) : null,
        numbers,
        compare ? h("div", { class: "recap-trend", text: compare }) : null,
        askCountWork(),
        buttons,
      ),
    );
  }

  function emptyBody(): HTMLElement {
    return h("div", { class: "stack recap-stack" },
      h("div", { class: "title", text: T.noActivity }),
      h("div", { class: "sub", text: T.noActivitySub }),
      h("div", { class: "actions" }, btn(T.ok, "secondary", () => actions.collapse())),
    );
  }

  function showSummary() {
    redrawShare = null;
    clear(card);
    const sky = Recap.sky;
    if (sky && sky.timeStars + sky.doneStars > 0) card.append(skyBody(sky));
    else card.append(Recap.summary ? summaryBody(Recap.summary) : emptyBody());
  }

  /** The agents' week (the card as it was before the sky), with the way back. */
  function showAgents() {
    redrawShare = null;
    clear(card);
    if (Recap.summary) card.append(summaryBody(Recap.summary));
  }

  function showShare(sky: WeekSky) {
    const thumb = h("canvas", { class: "recap-thumb" });
    const status = h("div", { class: "recap-status" });

    const draw = () => {
      shareCanvas = renderShareImage(sky, trendWords(Recap.compare));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      thumb.width = Math.round(64 * dpr);
      thumb.height = Math.round(114 * dpr);
      const ctx = thumb.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(shareCanvas, 0, 0, thumb.width, thumb.height);
      }
    };

    const say = (text: string, extra?: HTMLElement) => {
      clear(status);
      status.append(h("span", { text }));
      if (extra) status.append(extra);
    };

    const save = btn(tl("Save image"), "primary", async () => {
      if (!shareCanvas) return;
      save.disabled = true;
      say(T.saving);
      try {
        const path = await Bridge.recapSavePng(toPngDataUrl(shareCanvas), dayKey(sky.weekStart));
        const name = path.split(/[\\/]/).pop() ?? path;
        say(T.savedAs(name), h("button", {
          class: "link-btn recap-link",
          text: tl("Show in folder"),
          onclick: () => void Bridge.recapRevealSaved(),
        }));
      } catch (err) {
        say(String(err).replace(/^Error:\s*/, ""));
      } finally {
        save.disabled = false;
      }
    });

    const copy = btn(tl("Copy"), "secondary", async () => {
      if (!shareCanvas) return;
      say(await copyImage(shareCanvas) ? T.copied : T.copyUnavailable);
    });

    clear(card);
    card.append(h("div", { class: "stack recap-share" },
      thumb,
      h("div", { class: "recap-share-side" },
        h("div", { class: "recap-title", text: tl("Share your week") }),
        h("div", { class: "recap-note", text: t("No project, program or time of day is in it.") }),
        h("div", { class: "actions" }, save, copy, btn(tl("Back"), "secondary", showSummary)),
        status,
      ),
    ));
    draw();
    redrawShare = draw;
  }

  return {
    el,
    sync() {
      // Rebuilt only when the recap was (re)loaded, never on every state change:
      // that would reset share mode under the user's cursor.
      if (built === Recap.version) return;
      built = Recap.version;
      shareCanvas = null;
      showSummary();
    },
  };
}

/**
 * Puts the PNG on the clipboard through the web Clipboard API — no new
 * dependency. It needs the document focused, and the island never takes focus
 * on its own, so it is lent focus for the duration. WebKitGTK builds without
 * image clipboard support say no, and the caller offers Save instead.
 */
async function copyImage(canvas: HTMLCanvasElement): Promise<boolean> {
  const Item = (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!Item || !navigator.clipboard?.write) return false;
  await Bridge.focusWindow(true);
  try {
    const blob = await toPngBlob(canvas);
    if (!blob) return false;
    await navigator.clipboard.write([new Item({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  } finally {
    void Bridge.focusWindow(false);
  }
}
