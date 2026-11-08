// The island under the hand: the wheel turns the volume, a sideways swipe (or Shift
// and the wheel) changes the song, the middle button plays and pauses. Nothing runs
// between gestures: each is a few DOM events.

import { Bridge } from "../core/bridge";
import { sanitizeDeclared } from "../core/pills";
import { PLAYERS, takes, type Player } from "../core/spotify";
import { State } from "../core/state";
import { togglePlay } from "../views/spotify";

/** A mouse's wheel notch, in pixels; a touchpad's small deltas add up to one. */
const NOTCH = 100;
/** A sideways swipe ends once nothing came for this long: one song per swipe. */
const SWIPE_GAP_MS = 320;
/** What the gestures need from the island. */
export interface GestureHost {
  readonly islandEl: HTMLElement;
  /** Puhu looks after the song he was sent to (1 the next, -1 the one before). */
  lookTo(side: number): void;
  /** Played or paused from the middle button: a moment on it. */
  playedPaused(player: Player, playing: boolean): void;
}

/** The player the gestures act on: the one playing, else the one with a song loaded. */
function player(): Player | null {
  const active = sanitizeDeclared(State.settings, State.os).activeIntegrations;
  const loaded = PLAYERS.filter((p) => p.state.track != null && active.includes(p.pillId));
  return loaded.find((p) => p.state.playing) ?? loaded[0] ?? null;
}

export class Gestures {
  private volumeAcc = 0;
  private sideAcc = 0;
  private sideAt = 0;
  private sideDone = false;

  constructor(private readonly host: GestureHost) {
    const el = host.islandEl;
    el.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 1) return;
      // No autoscroll cursor: the middle button is play and pause here.
      e.preventDefault();
      this.playPause();
    });
  }

  private onWheel(e: WheelEvent) {
    // The open island's views scroll; in a game the island is not there.
    if (State.mode === "expanded" || State.inGame) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    // Shift turns the wheel sideways, as everywhere on Windows.
    const dx = (e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX) * px;
    const dy = (e.shiftKey ? 0 : e.deltaY) * px;
    if (Math.abs(dx) > Math.abs(dy)) this.sideways(dx, e.timeStamp);
    else if (dy !== 0) this.volume(dy);
  }

  /** Up is louder: a notch is a step of 2 %. */
  private volume(dy: number) {
    let steps: number;
    if (Math.abs(dy) >= NOTCH / 2) {
      this.volumeAcc = 0;
      steps = -Math.sign(dy);
    } else {
      this.volumeAcc += dy;
      steps = -Math.trunc(this.volumeAcc / NOTCH);
      this.volumeAcc += steps * NOTCH;
    }
    if (steps !== 0) void Bridge.systemVolumeStep(steps);
  }

  /** Towards the left (a swipe's fingers, the wheel tilted right, Shift and down): the next song. */
  private sideways(dx: number, at: number) {
    if (at - this.sideAt > SWIPE_GAP_MS) {
      this.sideAcc = 0;
      this.sideDone = false;
    }
    this.sideAt = at;
    if (this.sideDone) return;
    this.sideAcc += dx;
    if (Math.abs(dx) < NOTCH / 2 && Math.abs(this.sideAcc) < NOTCH) return;
    this.sideDone = true;
    const p = player();
    if (!p || !takes(p.state, "canSkip")) return;
    const side = this.sideAcc > 0 ? 1 : -1;
    void (p.kind === "spotify" ? Bridge.spotifyControl : Bridge.nowPlayingControl)(side > 0 ? "next" : "previous");
    this.host.lookTo(side);
  }

  private playPause() {
    const p = player();
    if (!p) return;
    togglePlay(p);
    this.host.playedPaused(p, p.state.playing);
  }
}
