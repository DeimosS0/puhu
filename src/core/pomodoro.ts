// A Pomodoro: a focus round, then a break, and a long break after every fourth focus;
// round after round until it is stopped. The lengths come from a preset (25/5/15 to
// begin with), chosen on its card. It runs on the clock (`endsAt`), so a sleeping
// computer or a busy page never makes it drift, and it wakes the page once a second
// only while it runs. A phase that runs to its end is reported with how long it ran
// while the computer was awake, for Puhu's progress (src/island/progress.ts). A round
// survives the page reloading or Puhu restarting: it is kept in localStorage as it
// goes, and picked up again by restore().

export type PomodoroPhase = "focus" | "break" | "long";

export const POMODORO_ID = "integration_pomodoro";

/** Minutes of focus, break and long break. */
export const POMODORO_PRESETS: readonly (readonly [number, number, number])[] = [[25, 5, 15], [50, 10, 20], [15, 3, 10]];

const MINUTE = 60_000;
const PRESET_KEY = "puhu.pomodoro.preset";
const RUN_KEY = "puhu.pomodoro.run";
/** How often a running phase is kept, ms: a restart loses at most this much of it. */
const KEEP_EVERY_MS = 10_000;
/** Ticks come every second (once a minute at worst on a throttled page): a longer gap is a sleeping computer. */
const AWAKE_GAP_MS = 90_000;

type Listener = () => void;

/** A phase that ran to its end. */
export interface PomodoroDone {
  phase: PomodoroPhase;
  start: number;
  end: number;
  minutes: number;
  /** Time it really ran, ms: pauses and a sleeping computer left out. */
  ran: number;
}

let timer: number | null = null;
const ticks = new Set<Listener>();
const phases = new Set<(phase: PomodoroPhase) => void>();
const completions = new Set<(done: PomodoroDone) => void>();
let startedAt = 0;
let lastTick = 0;
let ran = 0;
let keptAt = 0;

function savedPreset(): number {
  try {
    const n = Number(localStorage.getItem(PRESET_KEY));
    return Number.isInteger(n) && n >= 0 && n < POMODORO_PRESETS.length ? n : 0;
  } catch {
    return 0;
  }
}

export const Pomodoro = {
  phase: null as PomodoroPhase | null,
  endsAt: 0,
  /** The running phase's length, fixed when it began. */
  phaseLength: 0,
  /** What was left when it was paused; null while it runs (or is stopped). */
  pausedLeft: null as number | null,
  /** Focus rounds finished since it was started. */
  rounds: 0,
  preset: savedPreset(),

  get running(): boolean {
    return this.phase != null;
  },

  get paused(): boolean {
    return this.pausedLeft != null;
  },

  /** A phase's length with the chosen preset, ms. */
  length(phase: PomodoroPhase): number {
    const [focus, rest, long] = POMODORO_PRESETS[this.preset];
    return (phase === "focus" ? focus : phase === "break" ? rest : long) * MINUTE;
  },

  remaining(now = Date.now()): number {
    return this.pausedLeft ?? Math.max(0, this.endsAt - now);
  },

  /** How far into the current phase, 0…1. */
  progress(now = Date.now()): number {
    if (!this.phase) return 0;
    return 1 - this.remaining(now) / this.phaseLength;
  },

  /** The four dots on the card: focus rounds done towards the long break. */
  get dots(): number {
    return this.phase === "long" ? 4 : this.rounds % 4;
  },

  start() {
    this.rounds = 0;
    enter("focus");
  },

  stop() {
    this.phase = null;
    this.pausedLeft = null;
    clearTimer();
    keep();
    notify();
  },

  pause() {
    if (!this.running || this.paused) return;
    this.pausedLeft = this.remaining();
    clearTimer();
    keep();
    notify();
  },

  resume() {
    if (this.pausedLeft == null) return;
    this.endsAt = Date.now() + this.pausedLeft;
    this.pausedLeft = null;
    lastTick = Date.now();
    keep();
    tick();
  },

  /** On to the next phase now; a focus cut short earns no round. */
  skip() {
    if (!this.phase) return;
    this.pausedLeft = null;
    advance(false);
  },

  /** A preset for the rounds to come; the one that runs keeps its length. */
  setPreset(i: number) {
    if (i < 0 || i >= POMODORO_PRESETS.length || i === this.preset) return;
    this.preset = i;
    try {
      localStorage.setItem(PRESET_KEY, String(i));
    } catch {
      // Remembered for this session only.
    }
    notify();
  },

  /** Every second while it runs, and whenever it starts, pauses, stops or changes. */
  onTick(fn: Listener) {
    ticks.add(fn);
  },

  /** A new phase began on its own or by a skip (not at start). */
  onPhase(fn: (phase: PomodoroPhase) => void) {
    phases.add(fn);
  },

  /** A phase ran to its end (a skip or a stop is not one). */
  onComplete(fn: (done: PomodoroDone) => void) {
    completions.add(fn);
  },

  /**
   * The phase that was running when the page went away, once the listeners are in
   * place: it carries on, or ends at once if its time ran out meanwhile. A gap longer
   * than AWAKE_GAP_MS is not counted as run.
   */
  restore() {
    let saved: Kept | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(RUN_KEY) ?? "null") as Kept | null;
    } catch {
      return;
    }
    if (!saved || this.phase || !["focus", "break", "long"].includes(saved.phase)) return;
    this.phase = saved.phase;
    this.endsAt = saved.endsAt;
    this.phaseLength = saved.phaseLength;
    this.pausedLeft = saved.pausedLeft;
    this.rounds = saved.rounds;
    startedAt = saved.startedAt;
    ran = saved.ran;
    lastTick = saved.at;
    if (this.paused) notify();
    else tick();
  },
};

function notify() {
  for (const fn of ticks) fn();
}

/** What restore() needs of a running phase. */
interface Kept {
  phase: PomodoroPhase;
  endsAt: number;
  phaseLength: number;
  pausedLeft: number | null;
  rounds: number;
  startedAt: number;
  ran: number;
  at: number;
}

function keep() {
  keptAt = Date.now();
  try {
    if (!Pomodoro.phase) {
      localStorage.removeItem(RUN_KEY);
      return;
    }
    const { phase, endsAt, phaseLength, pausedLeft, rounds } = Pomodoro;
    const kept: Kept = { phase, endsAt, phaseLength, pausedLeft, rounds, startedAt, ran, at: keptAt };
    localStorage.setItem(RUN_KEY, JSON.stringify(kept));
  } catch {
    // Not kept: a reload ends the round, as it always did.
  }
}

function clearTimer() {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
}

function enter(phase: PomodoroPhase) {
  Pomodoro.phase = phase;
  Pomodoro.pausedLeft = null;
  Pomodoro.phaseLength = Pomodoro.length(phase);
  Pomodoro.endsAt = Date.now() + Pomodoro.phaseLength;
  startedAt = lastTick = Date.now();
  ran = 0;
  keep();
  tick();
}

function advance(earned: boolean) {
  const finished = Pomodoro.phase;
  if (earned && finished) {
    const done = { phase: finished, start: startedAt, end: Date.now(), minutes: Pomodoro.phaseLength / MINUTE, ran };
    for (const fn of completions) fn(done);
  }
  const next: PomodoroPhase = Pomodoro.phase === "focus"
    ? (earned && ++Pomodoro.rounds % 4 === 0 ? "long" : "break")
    : "focus";
  enter(next);
  for (const fn of phases) fn(next);
}

function tick() {
  clearTimer();
  if (!Pomodoro.phase || Pomodoro.paused) return;
  const now = Date.now();
  if (now - lastTick < AWAKE_GAP_MS) ran += now - lastTick;
  lastTick = now;
  if (now - keptAt >= KEEP_EVERY_MS) keep();
  if (Pomodoro.remaining() <= 0) {
    advance(true);
    return;
  }
  notify();
  // To the next whole second of what is left, so the display turns over on time.
  timer = window.setTimeout(tick, (Pomodoro.remaining() % 1000) + 5);
}

/** m:ss, rounded up: 25:00 at the start, 0:01 in the last second. */
export function formatRemaining(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
