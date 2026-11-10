// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";
import { registerShortcutHandlers } from "./island/shortcuts";
import { registerVoiceHandlers } from "./island/voice";
import { applySpotify, registerSpotifyHandlers } from "./island/spotify";
import { refresh as refreshProgress, registerProgress } from "./island/progress";
import { Pomodoro } from "./core/pomodoro";
import { FocusIntro } from "./island/focus-intro";
import { startSurprises } from "./island/surprises";
import { registerWhatsAppHandlers } from "./island/whatsapp";
import { NOWPLAYING_ID, NowPlaying, SPOTIFY_ID } from "./core/spotify";
import { MusicPulse } from "./core/beat";
import { Recap } from "./recap/recap";
import { Updates } from "./island/update";
import { WhatsNew } from "./whats-new/controller";
import { onLanguageChange, resolveLanguage, setLanguage, systemLanguages } from "./i18n/i18n";

/** Shows the language Settings asks for ("" = the system's, when Puhu has it). */
function applyLanguage() {
  setLanguage(resolveLanguage(State.settings.language, systemLanguages()));
}

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  // Before the island exists: its canvases size their bitmaps from the pixel
  // ratio once, so the zoom correction has to land first. If zoom was adjusted,
  // wait until the ratio updates (or up to 500ms) so nothing is sized against
  // the stale value.
  const dprBefore = window.devicePixelRatio || 1;
  const zoomChanged = await Bridge.fitZoom(dprBefore);
  if (zoomChanged) {
    for (let i = 0; i < 20 && window.devicePixelRatio === dprBefore; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  const island = new Island(root);
  // The dev previews (dev/*.html) drive the island from the console.
  if (import.meta.env.DEV) Object.assign(window, { __island: island, __state: State });

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
  }
  // A language change redraws the island in place: the texts given as tl(…)
  // relabel themselves (views/dom.ts) and the views redraw the rest on this
  // sync. Nothing is rebuilt, so tasks, steps and the chat stay as they are.
  onLanguageChange(() => State.notify());
  applyLanguage();
  // Rust shows the tray and its errors in the same language as the webview.
  void Bridge.setSystemLanguages(systemLanguages());
  island.applySettings();
  State.loadIntegrationTasks();
  if (boot && !boot.cursorPoll) island.followPageCursor();
  await island.desktop.init();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));
  await onEvent<boolean>("pointer-inside", (inside) => island.setPointerInside(inside));
  await onEvent<null>("closed-hover", () => island.wakeFromClosed());
  await onEvent<null>("outside-click", () => island.clickedOutside());
  await onEvent<{ level: number; muted: boolean }>("system-volume", (v) => island.showVolume(v));
  await onEvent<{ charging: boolean; level: number }>("power", (p) => island.showPower(p));
  await onEvent<{ name: string; headphones: boolean }>("audio-output", (o) => island.showOutput(o));
  await onEvent<{ mic: string[]; camera: string[] }>("privacy", (p) => island.showPrivacy(p));
  await onEvent<boolean>("caps-lock", (on) => island.showCaps(on));
  await onEvent<boolean>("network", (online) => island.showNetwork(online));
  await onEvent<{ name: string }>("download", (d) => island.showDownload(d.name));
  await onEvent<{ text: string }>("copied", (c) => island.showCopied(c.text));
  await onEvent<{ thumb: string; width: number; height: number; name: string }>("screenshot", (s) => island.showShot(s));

  /** Pause has to reach Rust too, or the pollers keep calling out. */
  const setPaused = (on: boolean) => {
    if (State.paused === on) return;
    State.paused = on;
    void Bridge.setPaused(on);
  };

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        setPaused(false);
        island.alert("settings");
        break;
      case "open":
        setPaused(false);
        island.alert(State.defaultView());
        break;
      case "recap":
        setPaused(false);
        void Recap.open(island);
        break;
      case "wardrobe":
        setPaused(false);
        island.alert("wardrobe");
        break;
      // "Update Puhu to X…", only in the menu while a new version is out.
      case "update":
        setPaused(false);
        Updates.show();
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
    }
  });

  const checkZoom = async () => {
    const dpr = window.devicePixelRatio || 1;
    await Bridge.fitZoom(dpr);
  };

  await onEvent<null>("screen-changed", async () => {
    await checkZoom();
    void Bridge.reposition();
    island.ensureRunning();
  });

  // A query only matches the ratio it was made for: once it changes, watch the
  // new one, or the next monitor's scale goes unnoticed and the zoom stays wrong.
  // One frame redraws Puhu at the new ratio, even while the loop is idle.
  const watchRatio = () => {
    window
      .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener?.("change", () => {
        watchRatio();
        void checkZoom();
        island.ensureRunning();
      }, { once: true });
  };
  watchRatio();

  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")) {
      e.preventDefault();
    }
  });

  // Settings → Reload sounds: read the sounds folder again, and let them hear it.
  await onEvent<null>("sounds-changed", () => {
    void Sound.reload().then(() => Sound.play("pop"));
  });

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    const previousMain = State.mainPillId;
    State.settings = { ...State.settings, ...s };
    applyLanguage();
    island.applySettings();
    State.loadIntegrationTasks();
    // A new main tool comes to the front.
    if (State.mainPillId !== previousMain) State.setFocus(State.mainPillId);
    void refreshConfigured();
    // Focus play on or off, or the reminder moved: the flame and the ember follow.
    refreshProgress();
  });

  registerHookHandlers(island);
  registerIntegrationHandlers(island);
  registerShortcutHandlers(island, () => setPaused(false));
  registerVoiceHandlers();
  registerSpotifyHandlers(island);
  registerProgress(island);
  // A round that was running before a reload or a restart carries on, now that its end is heard.
  Pomodoro.restore();
  // Puhu dances to the music's own beat: the loopback is open only while music plays.
  State.subscribe(() => MusicPulse.follow(State.spotifyPlaying && !State.inGame));
  // Game mode (game.rs): a game fills the screen, or did when Puhu started.
  await onEvent<{ on: boolean; quiet?: boolean }>("game-mode", (g) => island.setGame(g.on, g.quiet));
  await onEvent<{ on: boolean }>("away", (a) => island.setAway(a.on));
  // The screen back on (power.rs): maybe the day's first look at today's list.
  await onEvent<null>("display-on", () => {
    island.morning();
    island.evening();
    // Asleep, the reminders' timer stood still: set it again from the clock.
    island.syncReminders();
  });
  // Someone is back after an alarm went quiet (away.rs alarm_wait_back): it rings once more.
  await onEvent<null>("back", () => island.alarmBack());
  void Bridge.gameStatus().then((g) => {
    if (g?.on) island.setGame(true);
  });
  registerWhatsAppHandlers(island);
  // New versions: Rust offers the card, the island opens it when nothing else waits.
  await Updates.register(island);
  // Rust may have read Spotify before this page listened: ask once.
  if (State.settings.activeIntegrations.includes(SPOTIFY_ID)) {
    void Bridge.spotifyRefresh().then((s) => s && applySpotify(island, s));
  }
  if (State.settings.activeIntegrations.includes(NOWPLAYING_ID)) {
    void Bridge.nowPlayingRefresh().then((s) => s && applySpotify(island, s, NowPlaying));
  }

  // Monday recap: app start (greeting over), an agent starting work, waking up.
  const checkRecap = () => void Recap.check(island);
  // What's new, once after an update: when the greeting is over, or a few
  // seconds in when there is no greeting (the card waits for a quiet island).
  const whatsNew = () => void WhatsNew.launch(island);
  // Focus play's first question, until answered: just before what's new, which waits for it.
  const focusIntro = () => FocusIntro.launch(island);
  // Puhu's surprises tied to time (island/surprises.ts), once, after the greeting or without one.
  let surprisesStarted = false;
  const surprises = () => {
    if (surprisesStarted) return;
    surprisesStarted = true;
    startSurprises(island);
  };
  island.onGreetingDone = () => {
    checkRecap();
    focusIntro();
    whatsNew();
    surprises();
    window.setTimeout(() => island.morning(), 1500);
  };
  window.setTimeout(surprises, 9000);
  window.setTimeout(focusIntro, 6000);
  window.setTimeout(whatsNew, 8000);
  window.setTimeout(() => island.morning(), 10000);
  island.onWake = () => {
    checkRecap();
    island.evening();
    // A computer that slept held the day's turn and the reminder back.
    refreshProgress();
  };
  await onEvent<null>("recap-check", checkRecap);

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
