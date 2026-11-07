// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";
import type { RecapHistory, RecapPrefs } from "../recap/summary";
import type { SpotifyState } from "./spotify";
import type { UpdateStatus } from "./update";
import type { Weather, WeatherPlace } from "./weather";
import type { WaIslandView, WaSettingsView, WaTestResult } from "./whatsapp";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[puhu] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
  /** False where the OS has no global cursor (Wayland): see Island.followPageCursor. */
  cursorPoll: boolean;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),
  /** The system's languages as the webview sees them, for Rust's own texts (i18n.rs). */
  setSystemLanguages: (languages: string[]) => call<void>("set_system_languages", { languages }),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  /** Folds the window to `width`×`height` (the closed island) or grows it back to the panel. */
  setCollapsed: (collapsed: boolean, width?: number, height?: number) =>
    call<void>("set_collapsed", { collapsed, width: width ?? null, height: height ?? null }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),
  fitZoom: (dpr: number) => call<boolean>("fit_zoom", { dpr }),

  /** Displays the island can be pinned to: `key` is what `settings.screen` stores. */
  listMonitors: () => call<{ key: string; label: string }[]>("list_monitors"),

  openUrl: (url: string) => call<void>("open_url", { url }),
  /** Opens a GitLab link only when it belongs to the configured instance. */
  openGitLabUrl: (url: string) => call<void>("open_gitlab_url", { url }),
  /** Opens the configured Gitea instance without exposing its URL to the page. */
  openGitea: () => call<void>("open_gitea"),
  /** Opens a Gitea link only if it belongs to the configured instance. */
  openGiteaUrl: (url: string) => call<void>("open_gitea_url", { url }),

  /** Which of these sounds have a file of the user's own in the sounds folder. */
  customSounds: (names: readonly string[]) => call<string[]>("custom_sounds", { names }),
  /** The user's file for one sound, as raw bytes. */
  customSound: (name: string) => call<ArrayBuffer>("custom_sound", { name }),
  revealSoundsFolder: () => call<void>("reveal_sounds_folder"),
  /** Tells the island to read the sounds folder again ("sounds-changed"). */
  reloadSounds: () => call<void>("reload_sounds"),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),

  /**
   * "Open terminal": the window the session runs in when Rust found it
   * (Windows; Linux on X11 and KDE Plasma), else the folder in VS Code.
   */
  openSession: (sessionId: string | null, path: string | null) =>
    call<boolean>("open_session", { sessionId, path }),

  /** The Claude desktop app, for the Claude Desktop pill (Windows only). */
  openClaudeDesktop: () => call<boolean>("open_claude_desktop"),

  /** The diff card's ↗: an existing file, in VS Code; never launched by its type. */
  openFileInVSCode: (path: string) => call<boolean>("open_file_in_vscode", { path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: (page?: string) => call<void>("open_settings_window", page ? { page } : undefined),

  /** Writes to %LOCALAPPDATA%\Puhu\puhu.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Pill ID → whether that agent's hooks reach Puhu (read-only). */
  agentHooksStatus: () => call<Record<string, boolean>>("agent_hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  // ── Other agents (Gemini CLI, Codex, Cursor…) ─────────────────────────────
  agentHooksList: () => call<AgentHookStatus[]>("agent_hooks_list"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  agentHooksPreview: (agent: string, install: boolean) =>
    callOrThrow<AgentHookPlan>("agent_hooks_preview", { agent, install }),
  /**
   * Writes the agent's config — only ever after an explicit click, and only when
   * it still matches the preview the user looked at. Returns the backups taken.
   */
  agentHooksApply: (agent: string, install: boolean, fingerprint: string) =>
    callOrThrow<string>("agent_hooks_apply", { agent, install, fingerprint }),
  // ── Plan usage: the status line relay, installed apart from the hooks ──────
  /** Diff of the status line change. `install: false` previews taking the relay out. */
  statusLinePreview: (install: boolean) => callOrThrow<HookPreview>("status_line_preview", { install }),
  /** Same rules as hooksApply: an explicit click, and only for the diff that was shown. */
  statusLineApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("status_line_apply", { install, fingerprint }),
  /**
   * Asks the Codex CLI (`codex app-server`) for its plan limits, as Codex's
   * /status does. The raw `account/rateLimits/read` result, or null when Codex
   * is missing, not signed in or slow (15 s).
   */
  codexPlanUsage: () => call<unknown>("codex_plan_usage"),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** Answers a question Claude Code asked: question text → chosen label. */
  approvalAnswer: (requestId: string, answers: Record<string, string | string[]>) =>
    call<void>("approval_answer", { requestId, answers }),

  /** "Nobody can act on this" — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null, mail = false) =>
    callOrThrow<{ text: string }>("chat_send", { query, context, mail }),
  chatReset: () => call<void>("chat_reset"),
  /**
   * The models a provider offers, for the picker in the chat view. Rust asks
   * the provider only when it has a key (or a server address).
   */
  chatModels: (provider: string) => callOrThrow<ModelInfo[]>("chat_models", { provider }),
  claudeApiModels: () => callOrThrow<ModelInfo[]>("claude_api_models"),
  /** Settings → Local models → Connect: does the server answer, and with which models? */
  /** The custom server's key, bound to the address it is entered for. */
  localSetKey: (url: string, key: string) => call<void>("local_set_key", { url, key }),

  localConnect: (provider: "ollama" | "lmstudio" | "custom", url: string) =>
    callOrThrow<LocalServer>("local_connect", { provider, url }),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  forgetDropped: (path: string) => call<void>("forget_dropped", { path }),
  /** Ask the screen: the screen under the pointer, in the inbox (screen_ask.rs). */
  askScreen: () => callOrThrow<{ name: string; path: string; thumb: string; game: boolean }>("ask_screen"),
  /** "Ask Puhu" on a copied error: the clipboard's text, in the inbox (copied.rs). */
  askCopied: () => callOrThrow<DroppedFile>("ask_copied"),
  /** The island closed after asking about the screen in a game: game mode decides again. */
  gameResume: () => call<void>("game_resume"),
  presenting: () => call<boolean>("presenting"),
  /** Game mode (game.rs): on now, and for which app. */
  gameStatus: () => call<{ on: boolean; name: string }>("game_status"),
  /** An app of the games list turned on or off, or taken off it (null). */
  gameAppSet: (id: string, on: boolean | null) => call<void>("game_app_set", { id, on }),
  /** The game mode switch was saved: game.rs decides again. */
  gameRefresh: () => call<void>("game_refresh"),
  progressAdd: (event: object) => callOrThrow<void>("progress_add", { event }),
  progressRead: () => call<{ events: unknown[]; edited: boolean }>("progress_read"),
  /** Tells the other windows the progress log changed (a purchase in the Nest). */
  progressChanged: () => (IS_TAURI ? emit("progress-changed") : Promise.resolve()),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  /** Whether Claude can answer: the API key, or else the user's own Claude Code. */
  claudeReady: () => call<boolean>("claude_ready"),
  /** Settings → Chat → Your AI subscriptions: each switch and whether its tool is installed. */
  subscriptionStatus: () => call<SubscriptionStatus[]>("subscription_status"),
  /** Moves a switch; returns the rows as they are now. */
  subscriptionSet: (provider: string, on: boolean) =>
    call<SubscriptionStatus[]>("subscription_set", { provider, on }),
  /** Whether a provider can answer with this key: Claude Code stands in for a missing Anthropic one. */
  keyReady: (key: string) =>
    key === "anthropic-api-key" ? call<boolean>("claude_ready") : call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** The GitHub card is on screen: refetch that part if it is stale. */
  githubRefresh: (section: "pulse" | "activity") => call<void>("github_refresh", { section }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),

  // ── Global shortcuts ──────────────────────────────────────────────────────
  /** How each global shortcut went when Rust last registered them. */
  shortcutsStatus: () => call<ShortcutsReport>("shortcuts_status"),
  /** Lets go of every global shortcut while Settings records a new one. */
  shortcutsSuspend: (suspended: boolean) => call<void>("shortcuts_suspend", { suspended }),

  // ── Weekly recap ──────────────────────────────────────────────────────────
  /** Turns and decisions from `since` (Unix seconds) on, plus the recap prefs. */
  recapHistory: (since: number) => call<RecapHistory>("recap_history", { since: Math.floor(since) }),
  recapPrefs: () => call<RecapPrefs>("recap_prefs"),
  recapSetEnabled: (enabled: boolean) => call<void>("recap_set_enabled", { enabled }),
  recapSetHideProjects: (hide: boolean) => call<void>("recap_set_hide_projects", { hide }),
  /** `week` is the Monday (YYYY-MM-DD) the recap opened on its own for. */
  recapMarkShown: (week: string) => call<void>("recap_mark_shown", { week }),
  recapClear: () => call<void>("recap_clear"),
  /** Writes the PNG (a data URL) into Pictures or Downloads; returns its path. */
  recapSavePng: (data: string, week: string) => callOrThrow<string>("recap_save_png", { data, week }),
  /** Opens the folder of the image saved last. */
  recapRevealSaved: () => call<void>("recap_reveal_saved"),

  // ── Puhu on the desktop (src-tauri/src/desktop.rs) ────────────────────────
  desktopInfo: () => call<DesktopInfo>("desktop_puhu_info"),
  /** Dragged out of the island: (x, y) is the pointer in island-window coordinates. */
  desktopPickUp: (x: number, y: number) => call<boolean>("desktop_puhu_pick_up", { x, y }),
  /** Linux: the pointer moved during that drag (Windows carries him from Rust). */
  desktopCarry: (x: number, y: number) => call<void>("desktop_puhu_carry", { x, y }),
  desktopCarryEnd: (x: number, y: number) => call<void>("desktop_puhu_carry_end", { x, y }),
  /** A drag started on the desktop Puhu; resolves to his top-left corner. */
  desktopDragBegin: () => call<[number, number] | null>("desktop_puhu_drag_begin"),
  /** X11: top-left corner, physical pixels. */
  desktopDragMove: (x: number, y: number) => call<void>("desktop_puhu_drag_move", { x, y }),
  desktopDragEnd: (x: number, y: number) => call<void>("desktop_puhu_drag_end", { x, y }),
  /** From the island to his spot. False: no spot on any connected display.
   *  `anywhere`: the first-visit corner then, rather than staying home. */
  desktopFlyOut: (anywhere = false) => call<boolean>("desktop_puhu_fly_out", { anywhere }),
  /** To the island, then hidden. `forget`: he lives in the island again. */
  desktopFlyHome: (forget: boolean) => call<boolean>("desktop_puhu_fly_home", { forget }),
  /** Asleep, the cursor poll stops. */
  desktopSetAsleep: (asleep: boolean) => call<void>("desktop_puhu_set_asleep", { asleep }),
  /** Perched on the taskbar: a few steps along its edge, `dx` logical px over `ms`. False: he did not go. */
  desktopWalk: (dx: number, ms: number) => call<boolean>("desktop_puhu_walk", { dx, ms: Math.round(ms) }),

  // ── The weather (src-tauri/src/weather.rs) ─────────────────────────────────
  /** The first town by that name (Open-Meteo), named in `lang`; null when none. */
  weatherSearch: (name: string, lang: string) => call<WeatherPlace | null>("weather_search", { name, lang }),
  /** The last reading, for a page that (re)loads; its news come as the `weather` event. */
  weatherNow: () => call<Weather | null>("weather_now"),

  // ── Spotify (src-tauri/src/spotify.rs) ────────────────────────────────────
  /** Reads the player again (the card came on screen) and reports it. */
  spotifyRefresh: () => call<SpotifyState | null>("spotify_refresh"),
  /** True when Spotify took it. `value`: seconds for seek, 0/1 for shuffle and repeat, 0…100 for volume. */
  spotifyControl: (action: SpotifyAction, value?: number) =>
    call<boolean>("spotify_control", { action, value: value ?? null }),
  /** Brings Spotify forward or starts it; without it, its download page. */
  spotifyOpen: () => call<boolean>("spotify_open"),
  /** Whether there is a Spotify to launch (Settings). */
  spotifyInstalled: () => call<boolean>("spotify_installed"),

  // ── Now Playing: any app's media session (src-tauri/src/spotify.rs, Windows) ──
  nowPlayingRefresh: () => call<SpotifyState | null>("nowplaying_refresh"),
  /** Spotify's actions but `volume`, which Now Playing has none of. */
  nowPlayingControl: (action: SpotifyAction, value?: number) =>
    call<boolean>("nowplaying_control", { action, value: value ?? null }),
  /** Brings the app that plays forward. */
  nowPlayingOpen: () => call<boolean>("nowplaying_open"),
  /** Opens one of the images the screenshot preview kept (src-tauri/src/screenshot.rs). */
  openScreenshot: (name: string) => call<void>("open_screenshot", { name }),
  /** The viewer's larger copy of one, as a data URL. */
  screenshotView: (name: string) => call<string | null>("screenshot_view", { name }),
  /** Saves one as a PNG where Windows keeps its screenshots; true once it is written. */
  saveScreenshot: (name: string, label: string) => call<boolean>("save_screenshot", { name, label }),
  /** Opens the folder of the one saved last. */
  revealSavedScreenshot: () => call<void>("reveal_saved_screenshot"),
  revealLastDownload: () => call<void>("reveal_last_download"),
  /** While the island is open, Rust reports a click anywhere else (`outside-click`). */
  watchOutside: (on: boolean) => call<void>("watch_outside", { on }),
  /** The music's pulse (src-tauri/src/beat.rs): the loopback open while music plays. */
  musicListen: (on: boolean) => call<void>("music_listen", { on }),

  // ── WhatsApp (src-tauri/src/whatsapp) ─────────────────────────────────────
  /** The island's copy, asked once at start (then the "whatsapp" event). Island only. */
  whatsappIsland: () => call<WaIslandView>("whatsapp_island"),
  /** A conversation opened in the card: its latest messages, the receipt if Settings says so. */
  whatsappOpen: (chat: string) => call<void>("whatsapp_open", { chat }),
  whatsappClose: (chat: string) => call<void>("whatsapp_close", { chat }),
  /** Enter or the send button only. True once the gateway took it. */
  whatsappSend: (chat: string, text: string) => call<boolean>("whatsapp_send", { chat, text }),
  /** A chat id, or (Settings) a phone number. */
  whatsappIgnore: (chat: string) => call<void>("whatsapp_ignore", { chat }),
  whatsappUnignore: (chat: string) => call<void>("whatsapp_unignore", { chat }),
  /** Settings only, from here down. */
  whatsappSettings: () => call<WaSettingsView>("whatsapp_settings"),
  whatsappSetOptions: (enabled: boolean, muteGroups: boolean, markReadOnOpen: boolean) =>
    callOrThrow<void>("whatsapp_set_options", { enabled, muteGroups, markReadOnOpen }),
  /** `credential`: null keeps the stored one, "" removes it. */
  whatsappSaveGateway: (g: {
    gateway: "gowa" | "openwa"; url: string; credential: string | null; port: number; autoStart: boolean; gowaPath: string;
  }) => callOrThrow<void>("whatsapp_save_gateway", g),
  whatsappTest: () => call<WaTestResult>("whatsapp_test"),
  /** "Install WhatsApp" / "Update": GOWA from its GitHub releases, on this click only. */
  whatsappInstall: () => call<void>("whatsapp_install"),

  // ── New versions (src-tauri/src/update.rs) ────────────────────────────────
  updateStatus: () => call<UpdateStatus>("update_status"),
  /** The island's question or Settings' toggle: may Puhu look at GitHub on its own? */
  updateSetConsent: (allowed: boolean) => call<void>("update_set_consent", { allowed }),
  /** "Check now": one look at GitHub, the toggle on or off. */
  updateCheck: () => call<UpdateStatus>("update_check"),
  /** The island opened the card Rust offered ("ask" or "announce"). */
  updateShown: (kind: "ask" | "announce") => call<void>("update_shown", { kind }),
  /** Settings → Install X: opens the island's update card. */
  updateShow: () => call<void>("update_show"),
  updateLater: () => call<void>("update_later"),
  /** Blue Puhu in the tray while a new version waits (tray.rs). */
  trayUpdateHint: (on: boolean) => call<void>("tray_update_hint", { on }),
  updateDismiss: () => call<void>("update_dismiss"),
  /** "Update now" (Windows): download, check the SHA-256, run the installer, quit. */
  updateInstall: () => call<void>("update_install"),
  /** The release's page on github.com. */
  updateOpenPage: () => call<void>("update_open_page"),
};

export type SpotifyAction = "playPause" | "next" | "previous" | "seek" | "shuffle" | "repeat" | "volume";

export type ShortcutStatus =
  | "active" | "off" | "inUse" | "duplicate" | "invalid"
  | "typesCharacter" | "unsupported" | "notPorted"
  /** Wayland: handed to the desktop's portal, no answer yet / left out by it. */
  | "pending" | "refused";

export interface ShortcutsReport {
  /** `trigger`: on Wayland, the keys the desktop says run it, in its words. */
  actions: { id: string; status: ShortcutStatus; typed?: string; trigger?: string }[];
  /** "wayland" or "no-display" when no key grab can be made. */
  blocked: string | null;
  /** `<executable> --shortcut`: append an action id for a desktop shortcut. */
  command: string;
  /** Wayland: the shortcuts went to the desktop's GlobalShortcuts portal. */
  portal?: "pending" | "active" | null;
}

/** How the desktop Puhu's window works here (platform::DesktopMode). */
export type DesktopMode = "poll" | "window" | "layer" | "off";

export interface DesktopInfo {
  mode: DesktopMode;
  /** He was on the desktop when the app last quit. */
  onDesktop: boolean;
}

/** An event for one window only (island ⇄ desktop Puhu). Never throws. */
export async function emitToWindow(label: string, event: string, payload?: unknown) {
  if (!IS_TAURI) return;
  try {
    await emitTo(label, event, payload);
  } catch (err) {
    console.error(`[puhu] emit ${event} failed`, err);
  }
}

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface ModelInfo {
  id: string;
  label: string;
}

/** One row of Settings → Chat → Your AI subscriptions (cli_relay.rs `Status`). */
export interface SubscriptionStatus {
  provider: string;
  /** The terminal tool that answers, or would once installed. */
  tool: string;
  installed: boolean;
  on: boolean;
  /** What to type once in a terminal to sign in. */
  signIn: string;
  installUrl: string;
  subscriptionOnly: boolean;
}

export interface LocalServer {
  /** The address as it is stored. */
  url: string;
  models: string[];
  /** The address is this machine. */
  loopback: boolean;
}

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  /** Puhu's status line relay (plan usage) is the status line in settings.json. */
  planRelayInstalled: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

/** One agent other than Claude Code, as agents.rs reports it. */
export interface AgentHookStatus {
  /** The `--agent` name; its pill is `agent_<id>`. */
  id: string;
  name: string;
  installed: boolean;
  /** The file (or files, one per line) Puhu writes. */
  path: string;
  hookReady: boolean;
  /** The island can allow or deny this agent's permission requests. */
  approvals: boolean;
  /** What to do once it is written. */
  note: string;
}

export interface AgentHookPlan {
  diff: string;
  /** Where each existing file is copied first, one per line; "" when none. */
  backup: string;
  path: string;
  fingerprint: string;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Puhu");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

interface WebView2Bridge {
  postMessageWithAdditionalObjects(message: unknown, objects: ArrayLike<unknown>): void;
}

/**
 * Files dragged onto the island. Only reaches us when the window takes the mouse.
 *
 * On Windows WebView2 takes the drop itself, as in Edge — Tauri's drop handling
 * never sees drags from the classic Explorer folder view (see
 * src-tauri/src/webview_drop.rs). Enter/over/leave come straight from the page;
 * the drop hands the File objects to Rust, which answers with their real paths
 * as a `file-drag` event. Elsewhere (Linux) Tauri's own drag events still do it.
 */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  const webview = (window as unknown as { chrome?: { webview?: WebView2Bridge } }).chrome?.webview;
  if (!webview) {
    return getCurrentWebview().onDragDropEvent((event) => {
      handler(event.payload as DragDropPayload);
    });
  }
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
  // dragenter/dragleave fire for every element crossed; only the outermost pair counts.
  let depth = 0;

  const onEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) handler({ type: "enter" });
  };
  const onOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    // Without this WebView2 refuses the drop — or navigates to the file.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    handler({ type: "over" });
  };
  const onLeave = (e: DragEvent) => {
    if (!hasFiles(e) || depth === 0) return;
    if (--depth === 0) handler({ type: "leave" });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth = 0;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) {
      handler({ type: "drop", paths: [] });
      return;
    }
    webview.postMessageWithAdditionalObjects("puhu-file-drop", files);
  };

  window.addEventListener("dragenter", onEnter);
  window.addEventListener("dragover", onOver);
  window.addEventListener("dragleave", onLeave);
  window.addEventListener("drop", onDrop);
  const unlisten = await listen<DragDropPayload>("file-drag", (e) => handler(e.payload));
  return () => {
    window.removeEventListener("dragenter", onEnter);
    window.removeEventListener("dragover", onOver);
    window.removeEventListener("dragleave", onLeave);
    window.removeEventListener("drop", onDrop);
    unlisten();
  };
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
