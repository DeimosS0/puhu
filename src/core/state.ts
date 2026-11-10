// App state (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../puhu/engine";
import {
  DEFAULT_MAIN_PILL, HOST_OS, availablePills, orderPills, pillDefinition, sanitizeDeclared,
  toggleDeclared, type HostOs, type PillDefinition,
} from "./pills";
import type { CodexPlanUsage, PlanUsage } from "./plan";
import type { ProviderId } from "./providers";
import type { FileDiff } from "./diff";
import type { Bindings } from "./shortcuts";
import { pillColor } from "./pill-colors";
import { NOWPLAYING_ID, NowPlaying, Spotify, musicPlaying } from "./spotify";
import type { WeatherPlace } from "./weather";
import type { Converted, UsbDrive } from "./bridge";
import type { Timer } from "./timer";
import type { TodayTask } from "./today";

/** A PDF or a smaller picture being made from a drop (island/convert.ts, views/convert.ts). */
/** A Send to phone session as its card shows it (island/phone.ts, views/phone.ts). */
export interface PhoneSession {
  mode: "send" | "receive";
  /** ask: is this Public network the user's? then the QR code until a phone opens it. */
  stage: "ask" | "starting" | "waiting" | "connected" | "done" | "ended" | "error";
  /** The link the QR code carries, its key after the #. */
  url: string;
  qrSize: number;
  qrBits: string;
  /** "iPhone · Safari", once a phone opened the link. */
  device: string;
  /** Sending: each file's name, size and how much of it went. */
  files: { name: string; size: number; done: number }[];
  /** Received so far, by name. */
  received: string[];
  /** The bytes of the file coming in now, and its size. */
  incoming: { done: number; total: number } | null;
  /** Why it stopped, said plainly. */
  note: string;
  /** When the session runs out (ms). */
  until: number;
}

export interface Converting {
  kind: "pdf" | "small" | "jpg";
  /** The pages that fly in while it works: one a picture, none known yet for a document. */
  pages: number;
  done: Converted | null;
  error: string | null;
}

export type AgentSource = "claudeCode" | "n8n" | "agent";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  /**
   * Position of the newest step in the whole session. `steps` is capped, so
   * `stepIndex` stops moving once it is full; this keeps counting.
   */
  stepSeq?: number;
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
  /** Claude Code's session, so "Open terminal" can find the window it runs in. */
  sessionId?: string | null;
  /** Claude's final message after Stop, one line; cleared when a new turn starts. */
  finalLine?: string | null;
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  /** The pill the request belongs to: VS Code's or Cursor's (Claude Code), or an agent's (Codex…). */
  pillId: string;
  tool: string;
  command: string;
  /** Set when Claude Code is asking a question rather than for a permission. */
  questions?: AskedQuestion[];
}

/** One question of an AskUserQuestion call. */
export interface AskedQuestion {
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

/** A fresh, idle task for a catalog pill, in the colour the user gave it if any. */
function taskFor(def: PillDefinition, colors: unknown, name = def.name): AgentTask {
  return {
    id: def.id, name, color: pillColor(def.id, def.color, colors), state: "idle", stepIndex: 0, steps: [],
    source: def.source, isIntegration: true,
  };
}

/** What an integration poller last reported. */
export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  /** Seconds the compact island stays before it goes to its smallest. */
  compactCloseInterval: number;
  /** Hovering the island opens it all the way (off: hovering only peeks). */
  openOnHover: boolean;
  /** Open the island for a moment when any pill finishes or hits an error. */
  alertsFromAllPills: boolean;
  /** Date and time in the middle of the compact island. */
  showClock: boolean;
  /** What the closed island shows at the top of the screen (see core/closed.ts). */
  closedIsland: string;
  /** Music in the closed island: its waves, and a moment open on each new song's cover. */
  closedMusic: boolean;
  /** What was copied, shown in the island for a moment. */
  copiedPeek: boolean;
  /** The copied text itself in that peek, not only what it is. */
  copiedText: boolean;
  /** Puhu's windows kept out of screen sharing, recordings and screenshots. */
  hideFromCapture: boolean;
  /** Focus play (streaks, levels, badges): null until asked at first launch. */
  focusGame: boolean | null;
  /** Count working time for the weekly sky (activity.rs): null until asked on the card. */
  countWork: boolean | null;
  /** Minutes before a Today thing's time that Puhu says it is coming; 0: only at its time; below 0: never. */
  todayRemind: number;
  /** From this time ("HH:MM", empty: never), the evening ember while a streak waits. */
  focusReminder: string;
  /** Game mode (game.rs): Puhu steps aside while a game fills the screen. */
  gameMode: boolean;
  /** The apps seen filling the screen, by program. Rust owns it: Bridge.gameAppSet changes it. */
  gameApps?: Record<string, { name: string; on: boolean }>;
  absenceInterval: number;
  /** Declared pills next to the main one (at most 4), in the order they were added. */
  activeIntegrations: string[];
  /** The always-on workspace pill: VS Code, Cursor, Codex or Antigravity. */
  mainPill: string;
  /** "primary", "cursor", or `at:<x>,<y>` for one display (logical origin). */
  screen: string;
  autostart: boolean;
  hooksInstalled: boolean;
  /** Claude model used by the chat. */
  model: string;
  /** Show the Claude plan pill (5 h and weekly limits) in the island's header. */
  showPlanInNotch: boolean;
  /** Show the Claude plan percentage in the compact island next to the agent dots. */
  showPlanInCompactIsland: boolean;
  /** Puhu's status line relay is installed in Claude Code's settings. */
  planRelayInstalled: boolean;
  /** Show the Codex plan pill in the island's header. */
  showCodexPlanInNotch: boolean;
  /** Who the chat talks to (see core/providers.ts); picked in the chat view. */
  chatProvider: ProviderId;
  /** The model picked for each provider other than Anthropic, by provider id. */
  chatModels: Record<string, string>;
  /** Settings → Chat → Your AI subscriptions: each provider's switch (cli_relay.rs). */
  chatSubscriptions: Record<string, boolean>;
  /** Model server addresses once connected; empty means not connected. */
  ollamaUrl: string;
  lmstudioUrl: string;
  customUrl: string;
  /** Global shortcuts the user changed, by action id (see core/shortcuts.ts). */
  shortcuts: Bindings;
  /**
   * A colour of the user's own for a pill's Puhu, by pill ID ("#RRGGBB").
   * Empty means the catalog's colours; read it through core/pill-colors.ts.
   */
  pillColors: Record<string, string>;
  /**
   * Interface language: "" follows the system (when Puhu has its language,
   * else English), or one of src/i18n's ten codes ("fr", "pt-BR", "zh-Hans"…).
   */
  language: string;
  /** The town Puhu dresses for the weather of (src-tauri/src/weather.rs); null asks nothing. */
  weatherPlace: WeatherPlace | null;
  /** Puhu on the desktop. Rust owns it: whatever the page sends back is ignored. */
  desktopPuhu?: {
    onDesktop: boolean;
    spot: { x: number; y: number; space: string; perched?: boolean } | null;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  compactCloseInterval: 60,
  openOnHover: false,
  alertsFromAllPills: false,
  showClock: false,
  closedIsland: "puhu",
  closedMusic: true,
  copiedPeek: true,
  copiedText: false,
  hideFromCapture: false,
  focusGame: null,
  countWork: null,
  todayRemind: 10,
  focusReminder: "20:00",
  gameMode: true,
  absenceInterval: 180,
  activeIntegrations: [
    "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
    "integration_nowplaying",
  ],
  mainPill: DEFAULT_MAIN_PILL,
  screen: "primary",
  autostart: false,
  hooksInstalled: false,
  model: "claude-opus-5",
  showPlanInNotch: false,
  showPlanInCompactIsland: false,
  planRelayInstalled: false,
  showCodexPlanInNotch: false,
  chatProvider: "anthropic",
  chatModels: {},
  chatSubscriptions: {},
  ollamaUrl: "",
  lmstudioUrl: "",
  customUrl: "",
  shortcuts: {},
  pillColors: {},
  language: "",
  weatherPlace: null,
};

type Listener = () => void;

/** Live diffs kept per pill (oldest dropped first). */
export const MAX_DIFFS_PER_PILL = 50;
/** A pill's diffs are forgotten after an hour without a new one. */
export const DIFF_TTL_MS = 3_600_000;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left. */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  /** A game fills the screen (game.rs): the island is folded away and stays quiet. */
  inGame = false;
  /** What happened during the game, for the welcome back. */
  gameNews = { done: 0, terminal: 0 };
  /** Guard mode (away.rs): nobody at the computer while an agent works. */
  away = false;
  /** What happened meanwhile, for the welcome back. */
  awayNews = { done: 0, asked: 0 };

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  /**
   * `thumb`: a picture of the screen (Ask the screen), shown in the chat's chip.
   * `temporary`: Puhu's own copy for one question, gone when the island closes.
   */
  droppedFile: { name: string; path: string; thumb?: string; temporary?: boolean } | null = null;
  /** Every file of the last drop, where it was dropped from (what a PDF is made of). */
  droppedPaths: string[] = [];
  converting: Converting | null = null;
  /** Send to phone, or from it, while its card is up (island/phone.ts). */
  phone: PhoneSession | null = null;
  /** The USB drives plugged in (usb.rs), for views/usb.ts and the header's tab. */
  usbDrives: UsbDrive[] = [];
  /** What rings on the alarm card (island/alarm.ts): a timer that ended, or a Today thing at its time. */
  ringing: { timer?: Timer; task?: TodayTask } | null = null;
  /** Sent by the chat as soon as it is on screen ("Ask Puhu" on a copied error). */
  pendingAsk: string | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;
  /**
   * A card that waits for its answer below a permission (focus play's first
   * question): no other view takes its place, a close only folds it, and the
   * island opens on it again until it is answered.
   */
  waitingCard: IslandViewName | null = null;
  /** Requests waiting in line when another card is already up. */
  approvalQueue: ApprovalInfo[] = [];
  /** The pill that was in front when the card came up; it comes back after. */
  focusBeforeApproval: string | null = null;

  integrations: Record<string, IntegrationInfo> = {};

  /** Claude's 5 h / weekly limits, from the status line (null until the first call). */
  planUsage: PlanUsage | null = null;
  /** Codex's limits, from `codex app-server` (null until it has answered). */
  codexPlanUsage: CodexPlanUsage | null = null;
  /** A plan card is open in place of the overview's left card. */
  showingPlanDetail = false;
  /** Which one: the Codex card rather than Claude's. */
  planDetailIsCodex = false;
  /** Per-pill file diffs, in order of reception. Steps carry their ids. */
  sessionDiffs = new Map<string, FileDiff[]>();
  private sessionDiffTimers = new Map<string, number>();
  /** Never reset, so an id can never point at a newer diff than the one tapped. */
  private nextDiffId = 0;
  /** Ctrl+↑ / Ctrl+↓: the highlighted row of the card's list. */
  cardSelection: number | null = null;
  /** Rows in the list on screen, 0 when there is none. */
  cardItemCount = 0;
  /**
   * Puhu is out of the island — on the desktop, flying, or being dragged
   * there — so the island's own Puhu is hidden.
   */
  puhuOnDesktop = false;

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  /** Which pills this build offers depends on it (Claude Desktop is Windows only). */
  os: HostOs = HOST_OS;

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  /** Music plays on a declared player pill, Spotify or Now Playing: Puhu dances. */
  get spotifyPlaying(): boolean {
    const active = sanitizeDeclared(this.settings, this.os).activeIntegrations;
    return musicPlaying(Spotify.state, active) || musicPlaying(NowPlaying.state, active, NOWPLAYING_ID);
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    this.showingPlanDetail = false;
    t.pillBadge = null;
    this.notify();
  }

  /**
   * A permission card or a question comes up: its pill comes to the front, and
   * the pill that was there is remembered (HookServer.focusBeforeApproval).
   */
  beginApproval(info: ApprovalInfo) {
    this.pendingApproval = info;
    this.isPinned = true;
    if (this.focusBeforeApproval == null) this.focusBeforeApproval = this.focusId;
    this.setFocus(info.pillId);
  }

  /**
   * The card has its answer, or is withdrawn: the session carries on, and the
   * pill you were on comes back — unless you moved to another one meanwhile.
   */
  endApproval() {
    const req = this.pendingApproval;
    if (!req) return;
    this.pendingApproval = null;
    this.isPinned = false;
    this.updateTask(req.pillId, "working");
    this.setPillBadge(req.pillId, null);

    // If another request is waiting in line, promote it next
    const next = this.approvalQueue.shift();
    if (next) {
      this.beginApproval(next);
      this.updateTask(next.pillId, next.questions ? "question" : "approval");
      this.notify();
      return;
    }

    const previous = this.focusBeforeApproval;
    this.focusBeforeApproval = null;
    if (previous && this.focusId === req.pillId && this.tasks.some((t) => t.id === previous)) {
      this.focusId = previous;
    }
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const newest = t.stepSeq ?? t.steps.length - 1;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    t.stepSeq = newest + 1;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** Stores a diff for a pill and returns its id (for the ticker step). */
  appendSessionDiff(pillId: string, diff: FileDiff): number {
    const id = this.nextDiffId++;
    const list = this.sessionDiffs.get(pillId) ?? [];
    list.push({ ...diff, id });
    while (list.length > MAX_DIFFS_PER_PILL) list.shift();
    this.sessionDiffs.set(pillId, list);
    // One timer per pill, re-armed on every diff — nothing polls.
    const prev = this.sessionDiffTimers.get(pillId);
    if (prev != null) window.clearTimeout(prev);
    this.sessionDiffTimers.set(
      pillId,
      window.setTimeout(() => this.clearSessionDiffs(pillId), DIFF_TTL_MS),
    );
    return id;
  }

  findDiff(pillId: string, id: number): FileDiff | null {
    return this.sessionDiffs.get(pillId)?.find((d) => d.id === id) ?? null;
  }

  clearSessionDiffs(pillId: string) {
    const timer = this.sessionDiffTimers.get(pillId);
    if (timer != null) window.clearTimeout(timer);
    this.sessionDiffTimers.delete(pillId);
    this.sessionDiffs.delete(pillId);
  }

  /** The always-on workspace pill, once the setting has been checked. */
  get mainPillId(): string {
    return sanitizeDeclared(this.settings, this.os).mainPill;
  }

  /**
   * True for a pill that stays when its session ends: the main pill and the
   * declared ones go back to idle instead of going away.
   */
  isKept(id: string): boolean {
    const d = sanitizeDeclared(this.settings, this.os);
    return id === d.mainPill || d.activeIntegrations.includes(id);
  }

  /**
   * Loads the catalog pills: the main pill always, the declared ones, and none
   * of the others — a pill that is mid-session stays until its session ends.
   * Safe to call any number of times.
   */
  loadIntegrationTasks() {
    const d = sanitizeDeclared(this.settings, this.os);
    this.settings.mainPill = d.mainPill;
    this.settings.activeIntegrations = d.activeIntegrations;
    for (const def of availablePills(this.os)) {
      const shouldLoad = def.id === d.mainPill || d.activeIntegrations.includes(def.id);
      const idx = this.tasks.findIndex((t) => t.id === def.id);
      if (shouldLoad && idx < 0) this.tasks.push(taskFor(def, this.settings.pillColors));
      const busy = idx >= 0 && (this.tasks[idx].state !== "idle" || this.tasks[idx].steps.length > 0);
      if (!shouldLoad && idx >= 0 && !busy) this.tasks.splice(idx, 1);
    }
    // A colour picked in Settings reaches the pills that are already up.
    for (const t of this.tasks) {
      const def = pillDefinition(t.id);
      if (def) t.color = pillColor(def.id, def.color, this.settings.pillColors);
    }
    this.tasks = orderPills(this.tasks, d.mainPill);
    if (!this.focusId || !this.tasks.some((t) => t.id === this.focusId)) this.focusId = d.mainPill;
    this.notify();
  }

  /**
   * A session is over. The main and declared pills are put back as they were;
   * any other pill goes away.
   */
  removeTask(id: string) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    if (this.isKept(id)) {
      const t = this.tasks[idx];
      t.state = "idle";
      t.steps = [];
      t.stepIndex = 0;
      delete t.stepSeq;
      t.pillBadge = null;
      t.finalLine = null;
      const def = pillDefinition(id);
      if (def) t.name = def.name;
      this.clearSessionDiffs(id);
      this.notify();
      return;
    }
    this.tasks.splice(idx, 1);
    this.clearSessionDiffs(id);
    if (this.focusId === id) this.focusId = this.tasks[0]?.id ?? this.mainPillId;
    this.notify();
  }

  /**
   * Creates the pill of a tagged agent on its first event; no-op if it exists.
   * Inserted right after the main pill so it is in the visible slice(0,4). A
   * catalog agent wears its catalog colour.
   */
  upsertExternalAgent(id: string, name: string, color: string) {
    if (this.tasks.some((t) => t.id === id)) return;
    const def = pillDefinition(id);
    this.insertAfterMain({
      id, name, color: def ? pillColor(def.id, def.color, this.settings.pillColors) : color,
      state: "idle", stepIndex: 0, steps: [],
      source: "agent", isIntegration: false,
    });
  }

  /**
   * The pill a Claude Code session belongs to (VS Code or Cursor). It is made
   * for the session when it is neither the main pill nor declared.
   */
  upsertWorkspacePill(id: string, name: string, cwd: string): AgentTask | null {
    let t = this.tasks.find((x) => x.id === id);
    if (!t) {
      const def = pillDefinition(id);
      if (!def) return null;
      t = taskFor(def, this.settings.pillColors, name);
      this.insertAfterMain(t);
    }
    t.name = name;
    if (cwd) t.sessionCwd = cwd;
    return t;
  }

  private insertAfterMain(t: AgentTask) {
    const at = this.tasks.findIndex((x) => x.id === this.mainPillId) + 1;
    this.tasks.splice(at, 0, t);
    if (!this.focusId) this.focusId = t.id;
    this.notify();
  }

  /** Declares or undeclares a pill (max 4 next to the main one). */
  toggleIntegration(id: string) {
    const next = toggleDeclared(sanitizeDeclared(this.settings, this.os), id, this.os);
    if (!next) return;
    this.settings.activeIntegrations = next;
    if (!next.includes(id) && this.focusId === id) this.focusId = this.mainPillId;
    this.loadIntegrationTasks();
  }

  /**
   * What the island opens on. A card waiting for an answer comes first, so
   * reopening a folded island shows it again.
   */
  defaultView(): IslandViewName {
    if (this.pendingApproval) return this.pendingApproval.questions ? "question" : "approval";
    if (this.waitingCard) return this.waitingCard;
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();
