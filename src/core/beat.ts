// The music's pulse from src-tauri/src/beat.rs: the tempo, where the beat falls, how
// sure that is and how loud the music is, about 20 times a second, run on in between
// so a dance can ask on any frame. The island opens the loopback only while music
// plays (`follow`); every page that draws Puhu hears the pulses.

import { Bridge, onEvent } from "./bridge";

export interface Pulse {
  bpm: number;
  /** 0 on the beat, rising to 1 just before the next. */
  phase: number;
  confidence: number;
  energy: number;
  bands: number[];
}

/** Pulses this recent mean the loopback hears the music. */
const HEARD_MS = 3000;
/** Past this the music has gone quiet (the loopback sends nothing during silence). */
const QUIET_MS = 400;
/** Until a tempo is found, the beat counts at this rate: a slow, listening sway. */
const IDLE_BPM = 80;

let count = 0;
let at = 0;
let bpm = 0;
let following = false;
let sureness = 0;
let loudness = 0;

const tempo = () => (bpm > 0 ? bpm : IDLE_BPM);

export const MusicPulse = {
  bands: [0, 0, 0, 0, 0, 0] as number[],

  /** Listening to the music: the dance follows it rather than its own tempo. */
  hearing(nowMs = performance.now()): boolean {
    return following || (at > 0 && nowMs - at < HEARD_MS);
  },

  /** Beats counted so far, continuous, one per beat. */
  beat(nowMs = performance.now()): number {
    return count + ((nowMs - at) / 60_000) * tempo();
  },

  /** How clear the beat is, 0…1, eased. */
  sure(nowMs = performance.now()): number {
    return nowMs - at > QUIET_MS ? 0 : sureness;
  },

  /** How loud the music is against its own recent peak, 0…1, eased. */
  loud(nowMs = performance.now()): number {
    return nowMs - at > QUIET_MS ? 0 : loudness;
  },

  /** The island: listen while music plays, stop when it doesn't. */
  follow(playing: boolean) {
    if (playing === following) return;
    following = playing;
    if (playing) {
      // A fresh start: the count runs on from now, nothing heard yet.
      count = 0;
      at = performance.now();
      bpm = 0;
      sureness = 0;
      loudness = 0;
    }
    void Bridge.musicListen(playing);
  },
};

void onEvent<Pulse>("music-pulse", (p) => {
  const now = performance.now();
  const running = at > 0 && now - at < HEARD_MS;
  const predicted = running ? MusicPulse.beat(now) : 0;
  if (p.bpm > 0 && running && bpm > 0) {
    // Our own count gives the whole beats, Rust the fraction: the nearest count that
    // agrees with both, reached halfway at once so the dance glides instead of jumping.
    const target = Math.round(predicted - p.phase) + p.phase;
    count = predicted + (target - predicted) * 0.5;
  } else if (p.bpm > 0) {
    // The first tempo: keep the whole beats already counted, take Rust's fraction.
    count = Math.floor(predicted) + p.phase;
  } else {
    // No tempo yet: there is no beat to line up with, the count just runs on. (Pulling
    // it towards Rust's empty phase on every pulse made Puhu shiver.)
    count = predicted;
  }
  at = now;
  bpm = p.bpm;
  // About a third of a second to follow: a hop never jumps from one pulse to the next.
  sureness += ((p.bpm > 0 ? Math.min(1, Math.max(0, (p.confidence - 0.2) / 0.4)) : 0) - sureness) * 0.15;
  loudness += (p.energy - loudness) * 0.15;
  MusicPulse.bands = p.bands;
});
