// The Puhu window: a sidebar with Flow (dictation, the Notetaker, the
// statistics, the dictionary, the snippets, the styles and their settings)
// and Island (every setting of the island), and the page on the right, under
// its coloured band.

import "./hub.css";
import { h, clear } from "../views/dom";
import { t, onLanguageChange } from "../i18n/i18n";
import { onEvent } from "../core/bridge";
import { FlowBridge, type FlowPrefs, type FlowStatus, type ModelsStatus, flowKeyId } from "../core/flow";
import { hero, livePuhu, setVoiceLevel, setWindowShown } from "./hero";
import { icon, keyLabel } from "./ui";
import { SETTINGS_ENTRIES, searchSettings, type SettingsSearchHit } from "./search";
import { SHELVED } from "../core/shelf";
import { Today } from "../views/today";

export type PageId =
  | "nest" | "week"
  | "dictation" | "notes" | "insights" | "dictionary" | "snippets" | "styles" | "flowsettings"
  | "general" | "pills" | "agents" | "chat" | "voice" | "integrations" | "games" | "shortcuts"
  | "mailOverview" | "mailRules" | "mailBanned" | "mailVIP";

interface PageDef {
  id: PageId;
  icon: string;
  title: () => string;
  /** The band's line; none for pages that draw their own band. */
  subtitle?: () => string;
}

/** Puhu's own: focus play's Nest (pages/nest.ts). */
export const PUHU_PAGES: PageDef[] = [
  { id: "nest", icon: "tree", title: () => t("Nest") },
  { id: "week", icon: "calendar", title: () => t("Today") },
];

export const FLOW_PAGES: PageDef[] = [
  { id: "dictation", icon: "mic", title: () => t("Dictation") },
  { id: "notes", icon: "record", title: () => t("Notetaker") },
  { id: "insights", icon: "chart", title: () => t("Statistics") },
  { id: "dictionary", icon: "book", title: () => t("Dictionary") },
  { id: "snippets", icon: "bolt", title: () => t("Snippets") },
  { id: "styles", icon: "text", title: () => t("Styles") },
  { id: "flowsettings", icon: "sliders", title: () => t("Settings") },
];

export const NOTCH_PAGES: PageDef[] = [
  { id: "general", icon: "gear", title: () => t("General"), subtitle: () => t("Puhu, his sounds and how the island behaves.") },
  { id: "pills", icon: "grid", title: () => t("Active pills"), subtitle: () => t("The pills shown in the island, their order and their colours.") },
  { id: "agents", icon: "terminal", title: () => t("Agents"), subtitle: () => t("Claude Code, Codex and the other agents Puhu follows.") },
  { id: "chat", icon: "chat", title: () => t("Chat"), subtitle: () => t("The AI of the island's chat, with your own keys.") },
  { id: "voice", icon: "wave", title: () => "OK Puhu" },
  { id: "integrations", icon: "puzzle", title: () => t("Integrations"), subtitle: () => t("Stripe, GitHub, Vercel, n8n, Notion and the rest.") },
  { id: "games", icon: "gamepad", title: () => t("Game mode"), subtitle: () => t("Puhu steps aside while you play.") },
  { id: "shortcuts", icon: "keyboard", title: () => t("Shortcuts"), subtitle: () => t("The keys that open the island and its actions.") },
];

/** Mail (classic Outlook): Windows only, Linux has no Outlook. */
export const MAIL_PAGES: PageDef[] = [
  { id: "mailOverview", icon: "tray", title: () => t("Overview") },
  { id: "mailRules", icon: "filter", title: () => t("Rules") },
  { id: "mailBanned", icon: "nosign", title: () => t("Banned words") },
  { id: "mailVIP", icon: "star", title: () => t("VIP") },
];

/** The pages of what is set aside (core/shelf.ts): out of the sidebar and of the search. */
const SHELVED_PAGES = new Set<PageId>([
  ...(SHELVED.flow ? FLOW_PAGES.map((p) => p.id) : []),
  ...(SHELVED.mail ? MAIL_PAGES.map((p) => p.id) : []),
  ...(SHELVED.voice ? (["voice"] as PageId[]) : []),
]);

const ALL = [...PUHU_PAGES, ...FLOW_PAGES, ...NOTCH_PAGES, ...MAIL_PAGES].filter((p) => !SHELVED_PAGES.has(p.id));

/** What a page gets to draw itself and reach the rest of the window. */
export interface HubContext {
  status: FlowStatus;
  navigate(page: PageId): void;
  /** Reads the status again (prefs, models) and redraws the sidebar's line. */
  refresh(): Promise<FlowStatus>;
  /** Saves new preferences and keeps them as the window's. */
  setPrefs(change: (p: FlowPrefs) => void): Promise<void>;
  /** The band of a page, its Puhus walking. */
  hero(page: PageId, title: string, subtitle: string | null, actions?: HTMLElement[], compact?: boolean): HTMLElement;
  /** Set by a page: called when the page is left. */
  onLeave?: () => void;
}

export type FlowPageRenderer = (container: HTMLElement, ctx: HubContext) => void | Promise<void>;

export interface HubOptions {
  version: string;
  flowPages: Partial<Record<PageId, FlowPageRenderer>>;
  /** Draws the island's settings for one of the Island pages into `container`. */
  renderNotch(page: PageId, container: HTMLElement): Promise<void>;
}

const DEFAULT_STATUS: FlowStatus = {
  prefs: {
    enabled: false, key: "right_ctrl", keyCombo: [], edge: "bottom", mic: "", keepDays: 30, cleanup: false,
    defaultStyle: "natural", summaryEngine: "claude", openAtLaunch: true, voice: false, voiceOutput: "system", voiceGender: "female", muteOthers: true,
  },
  models: { parakeet: { state: "missing" }, downloadMb: 700 },
  keys: "ok",
  hasClaudeKey: false,
  mics: [],
  platform: navigator.userAgent.includes("Windows") ? "windows" : "linux",
  autostarted: false,
};

export async function startHub(root: HTMLElement, opts: HubOptions) {
  document.body.classList.add("hub-window");
  // The window is created hidden and only shown and hidden afterwards: its
  // canvases animate only while it is on screen (#792).
  await onEvent<boolean>("hub-visible", setWindowShown);
  // While you dictate: the loudest of the pill's bands.
  await onEvent<number[]>("flow-bands", (bands) => setVoiceLevel(Math.max(0, ...bands)));
  const shown = await FlowBridge.hubShown();
  if (shown !== null) setWindowShown(shown);
  // Puhu's window opens on the day.
  let current: PageId = "week";
  let activeAnchor: string | null = null;
  let searchHits: SettingsSearchHit[] = [];
  let status: FlowStatus = (await FlowBridge.status()) ?? DEFAULT_STATUS;
  const items = new Map<PageId, HTMLElement>();
  const labels = new Map<PageId, HTMLElement>();
  const searchRows = new Map<string, HTMLElement>();
  const statusLine = h("div", { class: "hub-status" });
  const scroll = h("div", { class: "hub-scroll" });
  let rendering = 0;

  const ctx: HubContext = {
    get status() {
      return status;
    },
    navigate: (page) => void show(page),
    refresh: async () => {
      status = (await FlowBridge.status()) ?? status;
      drawStatus();
      return status;
    },
    setPrefs: async (change) => {
      const next = { ...status.prefs };
      change(next);
      status = { ...status, prefs: next };
      drawStatus();
      await FlowBridge.setPrefs(next);
    },
    hero: (page, title, subtitle, actions = [], compact = false) => hero(page, title, subtitle, actions, compact),
  };

  function drawStatus() {
    clear(statusLine);
    // Flow set aside, the line under the sidebar is the day's: what there is to do.
    if (SHELVED.flow) {
      const { done, total } = Today.count();
      const left = total - done;
      const color = total === 0 ? "#6b7079" : left === 0 ? "#34d399" : "#ffd166";
      const text = total === 0 ? t("Nothing for today yet") : left === 0 ? t("All done today!") : t("Today: {count} to do", { count: left });
      statusLine.append(h("i", { class: "dot", style: `background:${color}` }), h("span", { text }));
      return;
    }
    const models = status.models.parakeet.state;
    let color = "#6b7079";
    let text: string;
    if (!status.prefs.enabled) {
      text = t("Dictation is off");
    } else if (models !== "ready") {
      color = "#f7b32b";
      text = models === "downloading" ? t("Downloading the voice model…") : t("Download the voice model to dictate");
    } else if (status.keys !== "ok" && status.keys !== "wayland") {
      color = "#f7b32b";
      text = t("Use the pill's microphone to dictate");
    } else {
      color = "#34d399";
      text = t("Ready · hold {0}", { 0: keyLabel(status.keys === "wayland" ? "wayland" : flowKeyId(status.prefs), status.platform) });
    }
    statusLine.append(h("i", { class: "dot", style: `background:${color}` }), h("span", { text }));
  }

  function updateSearchRowHighlights() {
    for (const [id, rowEl] of searchRows) {
      rowEl.classList.toggle("on", id === activeAnchor);
    }
  }

  async function show(page: PageId, targetAnchor?: string) {
    const def = ALL.find((p) => p.id === page) ?? FLOW_PAGES[0];
    ctx.onLeave?.();
    ctx.onLeave = undefined;
    current = def.id;
    activeAnchor = targetAnchor ?? null;
    for (const [id, el] of items) el.classList.toggle("on", id === current);
    updateSearchRowHighlights();
    const token = ++rendering;
    const page_ = h("div", { class: "hub-page" });
    const renderer = opts.flowPages[def.id];
    if (renderer) {
      await renderer(page_, ctx);
    } else {
      page_.append(hero(def.id, def.title(), def.subtitle?.() ?? null));
      const container = h("div", { id: "settings-root" });
      page_.append(container);
      await opts.renderNotch(def.id, container);
    }
    if (token !== rendering) return;
    clear(scroll);
    scroll.append(page_);
    if (targetAnchor) {
      const el = page_.querySelector(`[data-anchor="${targetAnchor}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("hub-card-glowing");
        void el.offsetWidth;
        el.classList.add("hub-card-glowing");
      } else {
        scroll.scrollTop = 0;
      }
    } else {
      scroll.scrollTop = 0;
    }
  }

  // ── The sidebar ──
  const side = h("nav", { class: "hub-side" });
  const logo = h("canvas", {});
  // His species name, as on the specimen label of the promo film; Latin, so never translated.
  const motto = h("span", { class: "hub-motto", text: "Bubo insulae" });
  side.append(h("div", { class: "hub-brand" }, logo, h("div", { class: "hub-brand-text" }, h("span", { text: "Puhu" }), motto)));
  livePuhu(logo as HTMLCanvasElement);

  // Settings search field
  const searchInput = h("input", {
    class: "hub-search-input",
    type: "text",
    placeholder: t("Search settings"),
    spellcheck: "false",
  }) as HTMLInputElement;

  const searchClear = h("button", {
    class: "hub-search-clear",
    title: t("Close"),
    style: "display:none",
  }, icon("x"));

  const searchBox = h("div", { class: "hub-search" },
    icon("search"),
    searchInput,
    searchClear,
  );
  searchBox.querySelector("svg")?.classList.add("hub-search-icon");
  side.append(searchBox);

  const groupsContainer = h("div", { class: "hub-groups" });
  const resultsContainer = h("div", { class: "hub-search-results", style: "display:none" });
  side.append(groupsContainer, resultsContainer);

  const group = (title: string, pages: PageDef[]) => {
    const heading = h("div", { class: "hub-group", text: title });
    groupsContainer.append(heading);
    for (const p of pages) {
      const b = h("button", { class: "hub-item", onclick: () => void show(p.id) });
      const label = h("span", { text: p.title() });
      b.append(icon(p.icon), label);
      items.set(p.id, b);
      labels.set(p.id, label);
      groupsContainer.append(b);
    }
    return heading;
  };
  group("Puhu", PUHU_PAGES);
  if (!SHELVED.flow) group("Flow", FLOW_PAGES);
  const notchGroup = group(t("Island"), NOTCH_PAGES.filter((p) => !SHELVED_PAGES.has(p.id)));
  if (status.platform === "windows" && !SHELVED.mail) group("Mail", MAIL_PAGES);

  function renderSearchResults() {
    clear(resultsContainer);
    searchRows.clear();
    const query = searchInput.value.trim();
    if (!query) {
      searchClear.style.display = "none";
      resultsContainer.style.display = "none";
      groupsContainer.style.display = "";
      searchHits = [];
      return;
    }
    searchClear.style.display = "";
    groupsContainer.style.display = "none";
    resultsContainer.style.display = "";
    searchHits = searchSettings(query, (pageId) => ALL.find((p) => p.id === pageId)?.title() ?? pageId,
      SETTINGS_ENTRIES.filter((e) => !SHELVED_PAGES.has(e.page)));
    if (searchHits.length === 0) {
      resultsContainer.append(h("div", { class: "hub-search-empty", text: t("No setting found") }));
      return;
    }
    for (const hit of searchHits) {
      const pageDef = ALL.find((p) => p.id === hit.entry.page);
      const row = h("button", { class: "hub-search-row" });
      if (activeAnchor === hit.entry.id && current === hit.entry.page) {
        row.classList.add("on");
      }
      row.append(icon(pageDef?.icon ?? "sliders"));
      const textContainer = h("div", { class: "hub-search-row-text" });
      const rowTitle = h("div", { class: "hub-search-row-title", text: hit.label ?? t(hit.entry.title) });
      const rowSubtitle = h("div", {
        class: "hub-search-row-subtitle",
        text: hit.label
          ? `${pageDef?.title() ?? ""} › ${t(hit.entry.title)}`
          : (pageDef?.title() ?? ""),
      });
      textContainer.append(rowTitle, rowSubtitle);
      row.append(textContainer);
      row.addEventListener("click", () => {
        void show(hit.entry.page, hit.entry.id);
      });
      searchRows.set(hit.entry.id, row);
      resultsContainer.append(row);
    }
  }

  searchInput.addEventListener("input", renderSearchResults);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      renderSearchResults();
    } else if (e.key === "Enter") {
      if (searchHits.length > 0) {
        void show(searchHits[0].entry.page, searchHits[0].entry.id);
      }
    }
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    renderSearchResults();
    searchInput.focus();
  });

  // A thing written or done anywhere: the line under the sidebar follows.
  Today.subscribe(drawStatus);

  onLanguageChange(() => {
    searchInput.placeholder = t("Search settings");
    if (searchInput.value.trim()) renderSearchResults();
  });

  side.append(h("div", { class: "spacer" }), statusLine, h("div", { class: "hub-version", text: `Puhu ${opts.version}` }));

  clear(root);
  root.append(side, h("main", { class: "hub-panel" }, scroll));
  drawStatus();
  await show(current);

  void onEvent<string>("hub-page", (page) => {
    // The tray's Settings… opens the island's settings while Flow is set aside.
    const id = (page === "settings" ? (SHELVED.flow ? "general" : "flowsettings") : page) as PageId;
    if (ALL.some((p) => p.id === id)) void show(id);
  });
  void onEvent<FlowPrefs>("flow-prefs", (prefs) => {
    status = { ...status, prefs };
    drawStatus();
  });
  void onEvent<ModelsStatus>("speech-models", (models) => {
    status = { ...status, models };
    drawStatus();
  });
  return {
    redraw: () => {
      for (const p of ALL) {
        const label = labels.get(p.id);
        if (label) label.textContent = p.title();
      }
      notchGroup.textContent = t("Island");
      drawStatus();
      void show(current);
    },
    current: () => current,
  };
}
