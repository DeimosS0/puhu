// Puhu on the desktop, island side: runs his life cycle (the controller in
// puhu/desktop-logic.ts) against the real app, tells the desktop window what
// to show, and handles the drag out of the island. The window itself lives in
// src-tauri/src/desktop.rs and draws him in src/desktop/main.ts.

import { Bridge, emitToWindow, onEvent, type DesktopMode } from "../core/bridge";
import type { BotEmoteName } from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { desktopDances } from "../core/spotify";
import {
  DESKTOP_EVENTS, DesktopPuhuController, FLIGHT_MS, HANDOFF_MS, alertActive, type DesktopSnapshot, type Dock,
} from "../puhu/desktop-logic";

/** Label of the desktop Puhu's window (desktop.rs LABEL). */
const WINDOW = "desktop";

/** What the life cycle needs from the island. */
export interface DesktopHost {
  /** Shows the island (compact) if it is hidden. */
  reveal(): void;
  /** Right-click on the desktop Puhu: the wardrobe, or back. */
  wardrobeFromDesktop(): void;
  /** Three pokes on the desktop Puhu. */
  dizzyFromDesktop(): void;
  /** Where his Puhu sits in the island, for a flight to start or end there. */
  dock(): Dock;
  /** He passes between the island and the desktop: the island's Puhu fades instead of
   *  blinking, and lands with a bounce when he comes home. */
  handoff(landing: boolean): void;
}

export class DesktopLink {
  mode: DesktopMode = "off";
  readonly controller: DesktopPuhuController;

  /** The pointer is dragging Puhu out of the island. */
  carrying = false;

  private pushed = "";
  private pendingCarry: { x: number; y: number } | null = null;
  private carryFrame = false;
  private host: DesktopHost;

  constructor(host: DesktopHost) {
    this.host = host;
    this.controller = new DesktopPuhuController({
      flyOut: async (anywhere) => {
        await emitToWindow(WINDOW, DESKTOP_EVENTS.dock, this.host.dock());
        return (await Bridge.desktopFlyOut(anywhere)) ?? false;
      },
      flyHome: async (forget) => {
        await emitToWindow(WINDOW, DESKTOP_EVENTS.dock, this.host.dock());
        // As he reaches the island, the island's Puhu fades in where the desktop's fades out.
        const arriving = window.setTimeout(() => {
          this.host.handoff(true);
          State.puhuOnDesktop = false;
          State.notify();
        }, FLIGHT_MS - HANDOFF_MS);
        const done = (await Bridge.desktopFlyHome(forget)) ?? true;
        window.clearTimeout(arriving);
        return done;
      },
      setAway: (away) => {
        if (away !== State.puhuOnDesktop) this.host.handoff(false);
        State.puhuOnDesktop = away;
        State.notify();
      },
      emote: (emote: BotEmoteName, duration = 1.8) =>
        void emitToWindow(WINDOW, DESKTOP_EVENTS.emote, { emote, duration }),
      play: (sound) => Sound.play(sound),
      alertActive: () => alertActive(State),
      revealIsland: () => {
        if (State.mode === "hidden") this.host.reveal();
      },
      later: (fn, ms) => void window.setTimeout(fn, ms),
    });
  }

  /** False where windows can't be placed (GNOME on Wayland): he stays in the island. */
  get supported(): boolean {
    return this.mode !== "off";
  }

  async init() {
    const info = await Bridge.desktopInfo();
    if (!info || info.mode === "off") return;
    this.mode = info.mode;
    this.controller.enabled = info.onDesktop;

    await onEvent<{ from: "island" | "desktop"; home: boolean }>(DESKTOP_EVENTS.dropped, (e) =>
      this.onDropped(e.from, e.home),
    );
    await onEvent<null>(DESKTOP_EVENTS.home, () => void this.controller.flyHome());
    await onEvent<null>(DESKTOP_EVENTS.wardrobe, () => this.host.wardrobeFromDesktop());
    await onEvent<null>(DESKTOP_EVENTS.dizzy, () => this.host.dizzyFromDesktop());
    // The window's page (re)loaded: it knows nothing yet.
    await onEvent<null>(DESKTOP_EVENTS.ready, () => {
      this.pushed = "";
      this.push();
    });

    State.subscribe(() => this.sync());
    this.sync();
  }

  /** The launch greeting is over: back to his spot if that is where he lives. */
  launch() {
    if (this.supported) void this.controller.launchFlyIfNeeded();
  }

  /**
   * The desktop shortcut: out to his spot, or home. Not in the middle of a
   * drag out of the island — the drop decides that one.
   */
  flyOutOrHome() {
    if (!this.supported || this.carrying) return;
    void this.controller.flyOutOrHome();
  }

  // ── Drag out of the island ──────────────────────────────────────────────────

  /** Whether Puhu can be picked up from the island right now. */
  canPickUp(): boolean {
    return this.supported && !State.paused && !State.puhuOnDesktop && this.controller.phase === "home";
  }

  /** (x, y): the pointer, island-window coordinates. */
  pickUp(x: number, y: number) {
    this.carrying = true;
    State.puhuOnDesktop = true;
    State.notify();
    void Bridge.desktopPickUp(x, y).then((ok) => {
      if (ok) return;
      this.carrying = false;
      State.puhuOnDesktop = false;
      State.notify();
    });
  }

  /** The pointer moved during the drag. Windows carries him from Rust. */
  carry(x: number, y: number) {
    if (!this.carrying || this.mode === "poll") return;
    this.pendingCarry = { x, y };
    if (this.carryFrame) return;
    this.carryFrame = true;
    requestAnimationFrame(() => {
      this.carryFrame = false;
      const p = this.pendingCarry;
      this.pendingCarry = null;
      if (p && this.carrying) void Bridge.desktopCarry(p.x, p.y);
    });
  }

  /** The button went up. On Windows the cursor poll has seen it already. */
  carryEnd(x: number, y: number) {
    if (!this.carrying || this.mode === "poll") return;
    this.pendingCarry = null;
    void Bridge.desktopCarryEnd(x, y);
  }

  private onDropped(from: "island" | "desktop", home: boolean) {
    if (from === "island") {
      this.carrying = false;
      if (home) {
        // Dropped back on the island: he is simply there again.
        State.puhuOnDesktop = false;
        State.notify();
      } else {
        this.controller.installed();
      }
    } else if (home) {
      void this.controller.flyHome();
    }
  }

  // ── State → desktop window ──────────────────────────────────────────────────

  private sync() {
    this.controller.updateAlert(alertActive(State));
    this.controller.updateState(State.effectiveState);
    this.push();
  }

  private push() {
    const snapshot: DesktopSnapshot = {
      state: State.effectiveState,
      soundEnabled: State.settings.soundEnabled,
      soundVolume: State.settings.soundVolume,
      paused: State.paused,
      dancing: desktopDances(State.spotifyPlaying, State.effectiveState),
    };
    const key = JSON.stringify(snapshot);
    if (key === this.pushed) return;
    this.pushed = key;
    void emitToWindow(WINDOW, DESKTOP_EVENTS.state, snapshot);
  }
}
