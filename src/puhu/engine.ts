// Puhu's engine in Canvas 2D: constants, tweens, easings, particles.

import { Ease, lerp, type EaseFn } from "../core/anim";
import { MusicPulse } from "../core/beat";
import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";
import { PUHU_COLORS, PUHU_EYE_P, PUHU_EYE_SCALE, PUHU_EYE_SP, PUHU_RX, PUHU_RY, puhuColor, puhuPoint } from "./puhu";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EyeShape =
  | "pill" | "wide" | "dot" | "line" | "flat" | "happy" | "closed"
  | "spiral" | "heart" | "star" | "tired" | "wink" | "cup";

export type BadgeKind = "dots" | "bang" | "question" | "dot" | "arrow";

export interface Badge {
  kind: BadgeKind;
  color: RGB;
}

export type RGB = readonly [number, number, number]; // components 0…1

export type TweenKey = readonly [target: number, durationMs: number, ease: EaseFn];

interface Tween {
  prop: PropKey;
  keys: TweenKey[];
  index: number;
  from: number;
  startMs: number;
  onComplete?: () => void;
}

type PropKey =
  | "yaw" | "pitch" | "roll" | "tilt" | "open" | "sx" | "sy"
  | "oy" | "ox" | "tint" | "hands" | "blush" | "es" | "badgeS"
  | "fluff" | "swivel";

interface BotStateCfg {
  color: RGB;
  tint: number;
  eye: EyeShape;
  badge: Badge | null;
  bounces: boolean;
  scans: boolean;
  breathes: boolean;
  zz: boolean;
  sweat: boolean;
  look: readonly [number, number] | null;
  tilt: number;
}

interface Particle {
  type: "heart" | "star" | "spark" | "sweat" | "z" | "feather";
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; rot: number; size: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EYE_W = 0.25;
const EYE_H = 0.27;
// Eye spacing and height and the body colour are Puhu's (puhu.ts).
const INK = "rgb(26,20,18)"; // #1A1412
const PHONES = "rgb(112,119,134)";
const PHONES_PAD = "rgb(150,157,171)";
const MINI_INK = "rgb(16,19,26)"; // #10131A

const C = {
  idle: [0.902, 0.914, 0.933] as RGB,
  working: [0.231, 0.62, 1] as RGB,
  thinking: [0.545, 0.361, 0.965] as RGB,
  searching: [0.388, 0.396, 0.949] as RGB,
  approval: [0.961, 0.647, 0.141] as RGB,
  question: [0.133, 0.827, 0.933] as RGB,
  error: [0.957, 0.314, 0.369] as RGB,
  finished: [0.204, 0.831, 0.6] as RGB,
  ratelimit: [0.984, 0.573, 0.235] as RGB,
  sleeping: [0.58, 0.635, 0.722] as RGB,
  dizzy: [0.957, 0.447, 0.714] as RGB,
};

const base = {
  bounces: false, scans: false, breathes: false, zz: false, sweat: false,
  look: null, tilt: 0,
};

export const BOT_STATES: Record<BotStateName, BotStateCfg> = {
  idle: { ...base, color: C.idle, tint: 0, eye: "pill", badge: null },
  working: { ...base, color: C.working, tint: 0.72, eye: "pill", badge: { kind: "dots", color: C.working } },
  thinking: { ...base, color: C.thinking, tint: 0.72, eye: "pill", badge: { kind: "dots", color: C.thinking }, look: [0.55, 0.55] },
  searching: { ...base, color: C.searching, tint: 0.72, eye: "pill", badge: { kind: "dots", color: C.searching }, scans: true },
  approval: { ...base, color: C.approval, tint: 0.78, eye: "wide", badge: { kind: "bang", color: C.approval }, bounces: true },
  question: { ...base, color: C.question, tint: 0.75, eye: "pill", badge: { kind: "question", color: C.question }, tilt: 0.17 },
  error: { ...base, color: C.error, tint: 0.78, eye: "flat", badge: { kind: "dot", color: C.error } },
  finished: { ...base, color: C.finished, tint: 0.35, eye: "happy", badge: { kind: "dot", color: C.finished } },
  ratelimit: { ...base, color: C.ratelimit, tint: 0.72, eye: "tired", badge: { kind: "dot", color: C.ratelimit }, sweat: true },
  sleeping: { ...base, color: C.sleeping, tint: 0.32, eye: "closed", badge: null, breathes: true, zz: true },
  dizzy: { ...base, color: C.dizzy, tint: 0.7, eye: "spiral", badge: null },
};

/** State → sound, as in BotStateCfg.sound. */
export const STATE_SOUND: Partial<Record<BotStateName, string>> = {
  working: "work", thinking: "think", searching: "search", approval: "approval",
  question: "question", error: "error", finished: "finish", ratelimit: "rate",
  sleeping: "sleep", dizzy: "dizzy",
};

const EMOTE_EYE: Record<BotEmoteName, EyeShape> = {
  love: "heart", surprised: "dot", proud: "star", wink: "wink",
  yawn: "tired", happy: "happy", annoyed: "line",
};

// ── Small helpers ─────────────────────────────────────────────────────────────

const now = () => performance.now() / 1000;

export function hexToRGB(hex: string): RGB {
  const h = hex.replace("#", "");
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t),
];

function roundRectPath(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

function heartPath(x: CanvasRenderingContext2D, s: number) {
  x.beginPath();
  x.moveTo(0, s * 0.38);
  x.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.5, -s * 0.95, 0, -s * 0.38);
  x.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.15, 0, s * 0.38);
  x.closePath();
}

function starPath(x: CanvasRenderingContext2D, ro: number, ri: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
}

const FONT = `system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif`;

// ── Dance ────────────────────────────────────────────────────────────────────

/** The dance fades in over 0.3 s and out over 0.5 s. */
export function stepDanceLevel(level: number, dancing: boolean, dt: number): number {
  const target = dancing ? 1 : 0;
  if (level < target) return Math.min(target, level + dt / 0.3);
  if (level > target) return Math.max(target, level - dt / 0.5);
  return level;
}

/**
 * The bounce at `seconds`, for a body of radius R and a dance `level` (0…1): a
 * sideways sway, a hop, a tilt, and a squash on landing. Hearing the music
 * (core/beat.ts), it lands on the music's own beat, hops as high as the music is
 * loud and as the beat is clear, and sways less in a quiet passage: a soft part or
 * an unclear rhythm is only a sway. Without the loopback, 112 BPM.
 * `hop` scales the hop alone (the island keeps him low, the desktop lets him jump).
 */
export function danceTransform(seconds: number, level: number, R: number, hop = 1) {
  const ms = seconds * 1000;
  const hearing = MusicPulse.hearing(ms);
  const beat = hearing ? MusicPulse.beat(ms) : (seconds * 112) / 60;
  const loud = hearing ? MusicPulse.loud(ms) : 1;
  const sure = hearing ? MusicPulse.sure(ms) : 1;
  const lift = (hearing ? sure * (0.15 + 0.85 * loud) : 1) * hop;
  const swing = hearing ? (0.35 + 0.65 * loud) * (0.4 + 0.6 * sure) : 1;
  const arc = Math.abs(Math.sin(Math.PI * beat));
  const land = Math.pow(1 - arc, 6) * lift;
  return {
    dx: 0.08 * R * Math.sin(Math.PI * beat) * swing * level,
    dy: -0.2 * R * arc * lift * level,
    rotate: 0.1 * Math.sin(Math.PI * beat) * swing * level,
    sx: 1 + 0.045 * land * level,
    sy: 1 - 0.06 * land * level,
  };
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class BotEngine {
  isMini = false;
  /** Solid body colour for mini bots / integration pills (null = Puhu's own colour). */
  bodyColor: RGB | null = null;
  /**
   * A new version waits (whats-new/whats-new.ts): while Puhu is idle or asleep
   * he wears the up-arrow badge. The island turns his body blue alongside.
   */
  private updateHint: RGB | null = null;

  // Animated state
  yaw = 0; pitch = 0; roll = 0; tilt = 0; open = 1;
  sx = 1; sy = 1; oy = 0; ox = 0;
  tint = 0; hands = 0; blush = 0; es = 1; badgeS = 0;

  // Spring lag of the soft parts (pompoms, hat tips, scarf end), −1…1.
  physDx = 0;
  physDy = 0;
  private physVx = 0;
  private physVy = 0;
  private prevYaw = 0;
  private prevOy = 0;

  /** Puhu's tufts: how far up (1 at rest), on a spring so they overshoot a little. */
  tuftUp = 1;
  private tuftVel = 0;
  /** His feathers puffed up (0…1), his head turned (radians; π looks behind him). */
  fluff = 0;
  swivel = 0;
  /** His wings beating until then, so many times a second; one raised (−1, 1) or none. */
  private flapUntil = 0;
  private flapRate = 8;
  private wingUp = 0;
  /**
   * What he wears for what is going on (the island decides, setAccessories):
   * headphones while music plays, a focus band in the Pomodoro phase's colour,
   * reading glasses while an agent works. Each comes and goes on a spring
   * (0 off, 1 on, a little past 1 as it lands).
   */
  private wear = { phones: 0, band: 0, glasses: 0 };
  private wearVel = { phones: 0, band: 0, glasses: 0 };
  private wearOn = { phones: false, band: false, glasses: false };
  private bandCol: RGB = [1, 0.478, 0.349];
  private bandColT: RGB = [1, 0.478, 0.349];
  /** No badge over his head: the closed island has no room above him. */
  hideBadge = false;

  // Targets
  tgYaw = 0; tgPitch = 0; tgTilt = 0; tgSy = 1; tgSx = 1; tgEs = 1;

  /** Extra canvas height above the body so hearts can fly out without clipping. */
  particleOverhang = 0;

  /** Dancing to music; `dancingLevel` follows it, 0→1 in 0.3 s, 1→0 in 0.5 s. */
  isDancing = false;
  dancingLevel = 0;
  /** How high he hops when he dances (danceTransform's `hop`). */
  danceHop = 1;
  /**
   * Walking (guard mode's patrol; the island moves him): how fast, 0 standing to 1 at
   * his pace, and which way. He looks where he goes and waddles, each step rocking him
   * onto one foot and lifting him a little.
   */
  stride = 0;
  strideDir = 1;
  private stridePhase = 0;
  /** How much his tufts swing behind his moves (0 holds them still: the closed island). */
  softLag = 1;
  /** Sipping from a battery-shaped juice box (sip()): since when, until when (s). */
  private sipFrom = 0;
  private sipTo = 0;
  /**
   * Acts the island's indicators ask for, each until then (s): an antenna out looking for
   * the signal (found: when it lit up), wings over his ears, a wing to his beak, his tufts up.
   */
  private antennaFrom = 0;
  private antennaUntil = 0;
  private antennaFound = 0;
  private earsFrom = 0;
  private earsUntil = 0;
  private shhFrom = 0;
  private shhUntil = 0;
  private perkUntil = 0;

  col: RGB = C.idle;
  colT: RGB = C.idle;

  state: BotStateName = "idle";
  cfg: BotStateCfg = BOT_STATES.idle;

  eyeOverride: EyeShape | null = null;
  eyeOverrideUntil = 0;
  permanentEye: EyeShape | null = null;
  permanentEmote: BotEmoteName | null = null;
  miniNextBehavior = 0;

  badge: Badge | null = null;
  private badgeKey = "none";
  private badgeToken = 0;

  private tweens = new Map<PropKey, Tween>();
  private locks = new Set<PropKey>();
  private particles: Particle[] = [];

  lookX = 0;
  lookY = 0;

  lastTime = now();
  private t0 = now() - Math.random() * 5;
  private nextBlink = now() + 1.5 + Math.random() * 2;
  waveUntil = 0;
  waveStart = 0;
  private greetToken = 0;
  private lastAmbient = 0;
  private slapTimes: number[] = [];
  private miniLookTarget = { x: 0, y: 0 };
  private miniLookNextTime = 0;

  /** Fired when three slaps land inside 1.7 s (→ dizzy + confused view). */
  onDizzy: (() => void) | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  setState(next: BotStateName, force = false) {
    if (this.state === next && !force) return;
    const prev = this.state;
    this.state = next;
    this.cfg = BOT_STATES[next];
    this.colT = this.cfg.color;
    if (!this.locks.has("tint")) this.tint = this.cfg.tint;
    if (!this.locks.has("tilt")) this.tgTilt = this.cfg.tilt;
    this.setBadge(this.stateBadge());

    switch (next) {
      case "finished":
        this.hopFlight();
        setTimeout(() => this.emit("spark", 5), 450);
        break;
      case "error":
        this.ruffle();
        break;
      case "approval":
        this.anim("oy", [[-0.2, 150, Ease.out], [0, 300, Ease.back]]);
        this.raiseWing();
        break;
      case "dizzy":
        this.spinHead(2);
        break;
      case "question":
        this.blink();
        // An owl's curious tilt, past the state's lean and back to it.
        this.anim("tilt", [[0.32, 220, Ease.out], [0.17, 420, Ease.back]]);
        break;
      case "ratelimit":
        this.emit("sweat", 1);
        break;
      default:
        if (prev !== "idle" || next !== "idle") this.blink();
    }
  }

  /** The update badge (blue arrow) while one waits, else nothing. Asked every frame; cheap. */
  setUpdateHint(color: RGB | null) {
    const was = this.updateHint;
    const same = color === was || (color != null && was != null && color.every((c, i) => c === was[i]));
    if (same) return;
    this.updateHint = color;
    this.setBadge(this.stateBadge());
  }

  /** Whether the update hint shows now: only over an idle or sleeping Puhu. */
  get showsUpdateHint(): boolean {
    return this.updateHint != null && (this.state === "idle" || this.state === "sleeping");
  }

  /** Headphones, the focus band (its colour, or null for none), glasses. Asked every frame; cheap. */
  setAccessories(phones: boolean, band: RGB | null, glasses: boolean) {
    this.wearOn.phones = phones;
    this.wearOn.band = band != null;
    if (band) this.bandColT = band;
    this.wearOn.glasses = glasses;
  }

  private get wearMoving(): boolean {
    return (["phones", "band", "glasses"] as const).some(
      (k) => Math.abs(this.wearVel[k]) > 0.002 || Math.abs(+this.wearOn[k] - this.wear[k]) > 0.002,
    ) || this.bandCol.some((c, i) => Math.abs(c - this.bandColT[i]) > 0.003);
  }

  private stateBadge(): Badge | null {
    if (this.showsUpdateHint && this.updateHint) return { kind: "arrow", color: this.updateHint };
    return this.cfg.badge;
  }

  setBadge(b: Badge | null) {
    const key = b ? `${b.kind}-${b.color.join(",")}` : "none";
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const tok = ++this.badgeToken;
    this.anim("badgeS", [[0, 90, Ease.inOut]]);
    setTimeout(() => {
      if (tok !== this.badgeToken) return;
      this.badge = b;
      if (b) this.anim("badgeS", [[1, 280, Ease.back]]);
    }, 100);
  }

  blink() {
    if (this.locks.has("open")) return;
    this.anim("open", [[0.06, 70, Ease.inOut], [1, 130, Ease.out]]);
  }

  /** An owl's slow blink. */
  slowBlink() {
    if (this.locks.has("open")) return;
    this.anim("open", [[0.05, 230, Ease.inOut], [0.05, 120, Ease.lin], [1, 280, Ease.out]]);
  }

  /** The owl's head-bob: the body slides side to side, level, to see better. */
  peer() {
    const s = Math.random() < 0.5 ? 1 : -1;
    this.anim("ox", [[0.12 * s, 200, Ease.inOut], [-0.1 * s, 300, Ease.inOut], [0.05 * s, 240, Ease.inOut], [0, 220, Ease.out]]);
    this.anim("oy", [[-0.05, 200, Ease.out], [0, 240, Ease.inOut], [-0.03, 240, Ease.out], [0, 220, Ease.inOut]]);
  }

  /** Looks behind him, as only an owl can: the eyes go round the head and come back. */
  lookBehind() {
    const s = Math.random() < 0.5 ? 1 : -1;
    this.anim("swivel", [[s * Math.PI, 480, Ease.inOut], [s * Math.PI, 260, Ease.lin], [0, 500, Ease.inOut]]);
  }

  /** The head turned all the way round, `turns` times, the body reeling: dizzy. */
  spinHead(turns: number) {
    this.anim("swivel", [[Math.PI * 2 * turns, 1300, Ease.inOut]], () => { this.swivel = 0; });
    this.anim("tilt", [[0.2, 260, Ease.out], [-0.18, 340, Ease.inOut], [0.12, 320, Ease.inOut], [0, 380, Ease.inOut]]);
  }

  /** Feathers puffed up, then shaken out; a feather or two falls. */
  ruffle() {
    this.anim("fluff", [[1, 130, Ease.out], [1, 380, Ease.lin], [0, 320, Ease.inOut]]);
    this.anim("ox", [
      [0, 120, Ease.lin], [0.06, 60, Ease.out], [-0.06, 70, Ease.inOut], [0.05, 70, Ease.inOut],
      [-0.04, 70, Ease.inOut], [0.025, 70, Ease.inOut], [0, 80, Ease.out],
    ]);
    this.physVx += 0.8;
    setTimeout(() => this.emit("feather", 2 + Math.round(Math.random())), 200);
  }

  /** "Hoo-hoo": the body draws in and puffs out once per hoot (greet.wav's two). */
  hoot(times = 2) {
    const ys: TweenKey[] = [];
    const xs: TweenKey[] = [];
    for (let i = 0; i < times; i++) {
      ys.push([1.06, 80, Ease.out], [0.92, 110, Ease.out], [1, 80, Ease.inOut]);
      xs.push([0.96, 80, Ease.out], [1.08, 110, Ease.out], [1, 80, Ease.inOut]);
    }
    this.anim("sy", ys);
    this.anim("sx", xs);
  }

  /** Wings out and beating for `ms`. */
  flutter(ms = 900, rate = 8) {
    this.flapUntil = now() + ms / 1000;
    this.flapRate = rate;
    this.anim("hands", [[1, 120, Ease.out], [1, Math.max(0, ms - 340), Ease.lin], [0, 220, Ease.inOut]]);
  }

  /** Done: a hop on beating wings, a little float, a soft landing. */
  hopFlight() {
    this.flutter(1050, 8);
    this.anim("oy", [
      [0.06, 90, Ease.out], [-0.34, 280, Ease.out], [-0.28, 360, Ease.inOut],
      [0, 260, Ease.easeIn], [0.04, 80, Ease.out], [0, 160, Ease.back],
    ]);
    setTimeout(() => this.squash(), 1060);
  }

  /**
   * Plugged in: a juice box shaped like a battery comes up in front of him and he drinks
   * through a straw, three sips, his body squeezing with each, eyes shut with pleasure;
   * the juice goes down as the battery beside him fills, a spark, and the box goes.
   */
  sip(ms = 2200) {
    const t = now();
    this.sipFrom = t;
    this.sipTo = t + ms / 1000;
    this.eyeOverride = "happy";
    this.eyeOverrideUntil = this.sipTo - 0.25;
    const sy: TweenKey[] = [[1, 420, Ease.lin]];
    const sx: TweenKey[] = [[1, 420, Ease.lin]];
    for (let i = 0; i < 3; i++) {
      sy.push([0.95, 130, Ease.out], [1.03, 170, Ease.inOut], [1, 150, Ease.out]);
      sx.push([1.06, 130, Ease.out], [0.98, 170, Ease.inOut], [1, 150, Ease.out]);
    }
    this.anim("sy", sy);
    this.anim("sx", sx);
    setTimeout(() => Sound.play("gulp"), 440);
    setTimeout(() => this.emit("spark", 3), ms - 520);
  }

  /** No internet: an antenna comes out of his head and sways, his eyes searching. */
  searchSignal(ms = 3000) {
    const t = now();
    this.antennaFrom = t;
    this.antennaUntil = t + ms / 1000;
    this.antennaFound = 0;
  }

  /** Back online: the antenna's tip lights up green, a little hop, and it folds away. */
  foundSignal() {
    const t = now();
    if (t >= this.antennaUntil) this.antennaFrom = t;
    this.antennaFound = t;
    this.antennaUntil = t + 1.3;
    this.triggerEmote("happy");
    this.anim("oy", [[-0.14, 140, Ease.out], [0, 320, Ease.back]]);
    setTimeout(() => this.emit("spark", 2), 150);
  }

  /** Far too loud: both wings over his ears, eyes squeezed shut, shrinking a little. */
  coverEars(ms = 1600) {
    this.earsFrom = now();
    this.earsUntil = this.earsFrom + ms / 1000;
    this.eyeOverride = "line";
    this.eyeOverrideUntil = this.earsUntil - 0.1;
    this.anim("sy", [[0.93, 120, Ease.out], [0.93, ms - 320, Ease.lin], [1, 200, Ease.inOut]]);
    this.anim("sx", [[1.04, 120, Ease.out], [1.04, ms - 320, Ease.lin], [1, 200, Ease.inOut]]);
  }

  /** Muted: a wing to his beak, eyes shut, "shh". */
  shh(ms = 1600) {
    this.shhFrom = now();
    this.shhUntil = this.shhFrom + ms / 1000;
    this.eyeOverride = "closed";
    this.eyeOverrideUntil = this.shhUntil - 0.15;
    this.anim("tilt", [[-0.08, 200, Ease.out], [-0.08, ms - 450, Ease.lin], [0, 250, Ease.inOut]]);
  }

  /** On camera: feathers puffed and smoothed down, standing up straight, then a wink. */
  preen() {
    this.anim("fluff", [[0.9, 150, Ease.out], [0.9, 220, Ease.lin], [0, 380, Ease.inOut]]);
    this.anim("sy", [[1, 420, Ease.lin], [1.07, 220, Ease.back], [1.07, 600, Ease.lin], [1, 300, Ease.inOut]]);
    setTimeout(() => {
      this.triggerEmote("wink", 1.0);
      this.emit("star", 2);
    }, 700);
  }

  /** A microphone on: his tufts go up and he cocks his head, listening. */
  perk(ms = 1800) {
    this.perkUntil = now() + ms / 1000;
    this.anim("tilt", [[0.2, 220, Ease.out], [0.2, ms - 520, Ease.lin], [0, 300, Ease.inOut]]);
  }

  /** A breath in, cheeks round and eyes shut, then out in a puff: the dust off the list. */
  blow() {
    this.eyeOverride = "closed";
    this.eyeOverrideUntil = now() + 0.75;
    this.anim("sx", [[1.09, 260, Ease.out], [1.09, 140, Ease.lin], [0.95, 110, Ease.out], [1, 300, Ease.back]]);
    this.anim("sy", [[1.04, 260, Ease.out], [1.04, 140, Ease.lin], [0.97, 110, Ease.out], [1, 300, Ease.back]]);
    this.anim("blush", [[0.55, 260, Ease.out], [0.55, 140, Ease.lin], [0, 320, Ease.inOut]]);
    this.anim("yaw", [[0.35, 260, Ease.out], [0.45, 250, Ease.lin], [0, 400, Ease.inOut]]);
  }

  /** One wing up, like a raised hand: "over here". */
  raiseWing() {
    this.wingUp = Math.random() < 0.5 ? 1 : -1;
    this.anim("hands", [[1, 220, Ease.back], [1, 900, Ease.lin], [0, 260, Ease.inOut]], () => { this.wingUp = 0; });
  }

  /**
   * At rest, now and then (the island calls it every few seconds): a slow blink, a
   * head-bob, a look behind, a shake of the feathers or a curious tilt.
   */
  fidget() {
    if (this.isMini || this.state !== "idle" || this.isDancing || this.tweens.size > 0) return;
    const r = Math.random();
    if (r < 0.32) this.slowBlink();
    else if (r < 0.56) this.peer();
    else if (r < 0.72) this.lookBehind();
    else if (r < 0.86) this.ruffle();
    else this.anim("tilt", [[0.24, 260, Ease.out], [0.24, 520, Ease.lin], [0, 340, Ease.inOut]]);
  }

  squash() {
    this.physVy += 0.6;
    this.anim("sy", [[0.78, 70, Ease.out], [1.1, 130, Ease.out], [1, 170, Ease.inOut]]);
    this.anim("sx", [[1.16, 70, Ease.out], [0.95, 130, Ease.out], [1, 170, Ease.inOut]]);
  }

  slap() {
    this.interruptGreet();
    if (this.state === "dizzy") return;
    const t = now();
    this.slapTimes = this.slapTimes.filter((s) => t - s < 1.7);
    this.slapTimes.push(t);
    Sound.play("slap");
    this.squash();
    this.anim("fluff", [[0.7, 70, Ease.out], [0, 380, Ease.inOut]]);
    this.physVy -= 1.2;
    this.physVx += Math.random() < 0.5 ? 0.7 : -0.7;
    if (this.slapTimes.length >= 3) {
      this.slapTimes = [];
      this.onDizzy?.();
    } else {
      this.eyeOverride = "line";
      this.eyeOverrideUntil = t + 0.8;
      setTimeout(() => Sound.play("annoyed"), 60);
    }
  }

  doRoll(durationMs: number, turns: number) {
    this.roll = 0;
    this.anim("roll", [[Math.PI * 2 * turns, durationMs, Ease.inOut]], () => { this.roll = 0; });
  }

  /** Peek wave — the hello. */
  greet() {
    const t = now();
    const tok = ++this.greetToken;
    this.waveStart = t + 0.45;
    this.waveUntil = t + 1.55;
    this.physVx += 0.2;

    this.eyeOverride = "happy";
    this.eyeOverrideUntil = t + 2.0;
    this.anim("oy", [[-0.06, 220, Ease.out], [0.0, 220, Ease.back]]);

    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.anim("hands", [[1, 280, Ease.out]]);
      this.hoot(2);
      Sound.play("greet");
    }, 250);

    setTimeout(() => { if (this.greetToken === tok) this.blink(); }, 550);
    setTimeout(() => { if (this.greetToken === tok) this.blink(); }, 1500);
    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.waveUntil = 0;
      this.anim("hands", [[0, 200, Ease.inOut]]);
    }, 1550);
    setTimeout(() => {
      if (this.greetToken !== tok) return;
      this.eyeOverride = "happy";
      this.eyeOverrideUntil = now() + 0.3;
    }, 1750);
  }

  interruptGreet() {
    if (this.hands <= 0.01 && now() >= this.waveUntil) return;
    this.greetToken++;
    this.waveUntil = 0;
    this.waveStart = 0;
    this.anim("hands", [[0, 150, Ease.inOut]]);
  }

  setPermanentEmote(emote: BotEmoteName | null) {
    this.permanentEmote = emote;
    if (emote === "wink") {
      this.miniNextBehavior = now() + 0.8 + Math.random() * 1.7;
      return;
    }
    this.permanentEye = emote ? EMOTE_EYE[emote] : null;
    if (this.permanentEye) {
      this.eyeOverride = this.permanentEye;
      this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    } else if (this.eyeOverrideUntil === Number.POSITIVE_INFINITY) {
      this.eyeOverride = null;
      this.eyeOverrideUntil = 0;
    }
    this.miniNextBehavior = now() + 0.8 + Math.random() * 1.7;
  }

  triggerEmote(emote: BotEmoteName, duration = 1.8) {
    const t = now();
    this.eyeOverride = EMOTE_EYE[emote];
    this.eyeOverrideUntil = t + duration;

    switch (emote) {
      case "love":
        this.anim("blush", [
          [1, 300, Ease.out], [1, (duration - 0.6) * 1000, Ease.lin], [0, 300, Ease.inOut],
        ]);
        this.emit("heart", 4);
        this.anim("oy", [[-0.1, 160, Ease.out], [0, 300, Ease.back]]);
        this.flutter(520, 9);
        break;
      case "surprised":
        this.anim("oy", [[-0.3, 140, Ease.out], [0, 380, Ease.back]]);
        this.anim("es", [[1.25, 120, Ease.out], [1, 500, Ease.inOut]]);
        this.anim("fluff", [[0.8, 90, Ease.out], [0, 520, Ease.inOut]]);
        break;
      case "proud":
        this.emit("star", 5);
        // The chest puffed out, held, let go.
        this.anim("sy", [[1.07, 240, Ease.back], [1.07, (duration - 0.55) * 1000, Ease.lin], [1, 300, Ease.inOut]]);
        this.anim("sx", [[1.06, 240, Ease.back], [1.06, (duration - 0.55) * 1000, Ease.lin], [1, 300, Ease.inOut]]);
        this.anim("blush", [
          [0.7, 250, Ease.out], [0.7, (duration - 0.5) * 1000, Ease.lin], [0, 300, Ease.inOut],
        ]);
        break;
      case "wink":
        this.anim("tilt", [
          [0.12, 160, Ease.out], [0.12, (duration - 0.4) * 1000, Ease.lin], [0, 240, Ease.inOut],
        ]);
        break;
      case "yawn":
        this.anim("sy", [[1.12, 500, Ease.inOut], [1, 500, Ease.inOut]]);
        this.anim("sx", [[0.94, 500, Ease.inOut], [1, 500, Ease.inOut]]);
        setTimeout(() => { this.eyeOverride = "closed"; this.emit("z", 2); }, 700);
        break;
      case "happy":
        this.anim("blush", [[0.6, 200, Ease.out], [0, 600, Ease.inOut]]);
        this.peer();
        break;
      case "annoyed":
        this.eyeOverride = "line";
        this.eyeOverrideUntil = t + 0.8;
        setTimeout(() => Sound.play("annoyed"), 60);
        break;
    }
  }

  emit(type: Particle["type"], count: number) {
    for (let i = 0; i < count; i++) {
      const isZ = type === "z";
      this.particles.push({
        type,
        x: type === "feather" ? (Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.3) : (Math.random() - 0.5) * 0.9 + (isZ ? 0.55 : 0),
        y: -0.7 - Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 0.35 + (isZ ? 0.18 : 0),
        vy: -(0.45 + Math.random() * 0.35),
        age: -i * 0.14,
        life: 1.3 + Math.random() * 0.5,
        rot: Math.random() * Math.PI * 2,
        size: 0.15 + Math.random() * 0.08,
      });
    }
  }


  /** True while anything is still moving — lets the island stop its RAF loop. */
  get busy(): boolean {
    return (
      this.tweens.size > 0 ||
      this.particles.length > 0 ||
      this.cfg.bounces || this.cfg.scans || this.cfg.breathes || this.cfg.zz || this.cfg.sweat ||
      this.isMini ||
      this.isDancing || this.dancingLevel > 0.001 || this.stride > 0.001 || now() < Math.max(this.sipTo, this.antennaUntil, this.earsUntil, this.shhUntil, this.perkUntil) ||
      Math.abs(this.tgYaw - this.yaw) > 0.002 ||
      Math.abs(this.tgPitch - this.pitch) > 0.002 ||
      Math.abs(this.tgTilt - this.tilt) > 0.002 ||
      Math.abs(this.tgSy - this.sy) > 0.002 ||
      Math.abs(this.tgSx - this.sx) > 0.002 ||
      Math.abs(this.tgEs - this.es) > 0.002 ||
      Math.abs(this.col[0] - this.colT[0]) > 0.003 ||
      Math.abs(this.col[1] - this.colT[1]) > 0.003 ||
      Math.abs(this.col[2] - this.colT[2]) > 0.003 ||
      this.wearMoving
    );
  }

  // ── Tweens ──────────────────────────────────────────────────────────────────

  anim(prop: PropKey, keys: TweenKey[], onComplete?: () => void) {
    this.tweens.set(prop, {
      prop, keys, index: 0, from: this[prop], startMs: performance.now(), onComplete,
    });
    this.locks.add(prop);
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  update(dt: number) {
    const n = now();
    const nowMs = performance.now();

    for (const tw of [...this.tweens.values()]) {
      const k = tw.keys[tw.index];
      const p = Math.min(1, Math.max(0, (nowMs - tw.startMs) / k[1]));
      this[tw.prop] = tw.from + (k[0] - tw.from) * k[2](p);
      if (p >= 1) {
        tw.from = k[0];
        tw.index += 1;
        tw.startMs = nowMs;
        if (tw.index >= tw.keys.length) {
          this.tweens.delete(tw.prop);
          this.locks.delete(tw.prop);
          tw.onComplete?.();
        }
      }
    }

    const t = n - this.t0;
    let ty = this.lookX * 0.62;
    let tp = this.lookY * 0.5;

    if (this.cfg.look) {
      ty = ty * 0.35 + this.cfg.look[0] * 0.55;
      tp = tp * 0.3 + this.cfg.look[1] * 0.5;
    }
    if (this.cfg.scans) {
      ty = Math.sin(t * 2.6) * 0.6;
      tp = -0.06;
    }
    if (this.state === "sleeping") { ty = 0; tp = -0.14; }
    if (this.state === "dizzy") { ty = Math.sin(t * 9) * 0.25; }

    // Mini bots never follow the mouse — they wander.
    if (this.isMini && !this.cfg.look && !this.cfg.scans && this.state !== "sleeping" && this.state !== "dizzy") {
      if (n > this.miniLookNextTime) {
        this.miniLookTarget = {
          x: -0.88 + Math.random() * 1.76,
          y: -0.55 + Math.random() * 1.0,
        };
        this.miniLookNextTime = n + 0.5 + Math.random() * 1.5;
      }
      ty = this.miniLookTarget.x * 0.62;
      tp = this.miniLookTarget.y * 0.5;
    }
    // The antenna out, his eyes go round looking for the signal, up a little.
    if (n < this.antennaUntil && !this.antennaFound) {
      ty = Math.sin(t * 2.4) * 0.55;
      tp = 0.18;
    }
    // Walking, he looks where he goes; three steps a second.
    if (this.stride > 0.001) {
      this.stridePhase += dt * Math.PI * 3;
      ty = lerp(ty, this.strideDir * 0.6, Math.min(1, this.stride * 1.5));
    }

    this.tgYaw = ty;
    this.tgPitch = tp;
    this.tgTilt = this.cfg.tilt;

    if (n > this.waveStart && n < this.waveUntil) {
      const wt = n - this.waveStart;
      this.tgTilt = -0.06 + Math.sin(2 * Math.PI * 1.2 * wt) * 0.07;
    }

    const bounce = this.cfg.bounces ? -Math.abs(Math.sin(t * 5.2)) * 0.07 : 0;
    const kGen = 1 - Math.pow(0.0008, dt);
    if (!this.locks.has("oy")) this.oy += (bounce - this.oy) * kGen;

    if (this.cfg.breathes) {
      const amp = this.isMini ? 0.07 : 0.035;
      this.tgSy = 1 + Math.sin(t * 1.8) * amp;
      this.tgSx = 1 - Math.sin(t * 1.8) * amp * 0.57;
    } else if (this.isMini) {
      this.tgSy = 1 + Math.sin(t * 2.2) * 0.04;
      this.tgSx = 1 - Math.sin(t * 2.2) * 0.02;
    } else {
      this.tgSy = 1;
      this.tgSx = 1;
    }

    if (this.isMini && n > this.miniNextBehavior) this.doMiniBehaviorLoop();

    const kLook = 1 - Math.pow(0.0025, dt);
    if (!this.locks.has("yaw")) this.yaw += (this.tgYaw - this.yaw) * kLook;
    if (!this.locks.has("pitch")) this.pitch += (this.tgPitch - this.pitch) * kLook;
    if (!this.locks.has("tilt")) this.tilt += (this.tgTilt - this.tilt) * kGen;
    if (!this.locks.has("sy")) this.sy += (this.tgSy - this.sy) * kGen;
    if (!this.locks.has("sx")) this.sx += (this.tgSx - this.sx) * kGen;
    if (!this.locks.has("es")) this.es += (this.tgEs - this.es) * kGen;

    this.col = mix3(this.col, this.colT, 1 - Math.pow(0.002, dt));

    if (n > this.nextBlink) {
      if (this.state !== "sleeping" && this.state !== "dizzy") {
        this.blink();
        if (Math.random() < 0.22) setTimeout(() => this.blink(), 230);
      }
      this.nextBlink = n + 2.2 + Math.random() * 3.2;
    }

    if (this.eyeOverride && n > this.eyeOverrideUntil) {
      this.eyeOverride = this.permanentEye;
      if (this.permanentEye) this.eyeOverrideUntil = Number.POSITIVE_INFINITY;
    }

    if (n - this.lastAmbient > 1.3) {
      this.lastAmbient = n;
      if (this.cfg.zz) this.emit("z", 1);
      if (!this.isMini && this.cfg.sweat && Math.random() < 0.5) this.emit("sweat", 1);
    }

    for (const p of this.particles) p.age += dt;
    this.particles = this.particles.filter((p) => p.age < p.life);

    this.dancingLevel = stepDanceLevel(this.dancingLevel, this.isDancing, dt);

    // Soft-part spring: lags behind head turns, hops and rolls (stiffness 60, damping 9).
    if (dt > 0) {
      const yawVel = (this.yaw - this.prevYaw) / dt;
      const oyVel = (this.oy - this.prevOy) / dt;
      // Dancing, the soft parts (Puhu's tufts) trail the sway too.
      const sway = this.dancingLevel > 0.001 ? danceTransform(n, this.dancingLevel, 1, this.danceHop).rotate * 4 : 0;
      // ...and his steps.
      const waddle = Math.sin(this.stridePhase) * this.stride * 0.7;
      const tDx = Math.max(-1, Math.min(1, -yawVel * 0.35 - this.tilt * 2 - sway - waddle));
      const tDy = Math.max(-1, Math.min(1, oyVel * 0.5));
      this.physVx += (60 * (tDx - this.physDx) - 9 * this.physVx) * dt;
      this.physVy += (60 * (tDy - this.physDy) - 9 * this.physVy) * dt;
      this.physDx += this.physVx * dt;
      this.physDy += this.physVy * dt;
    }
    // Tufts: down asleep, up when glad or dancing, a little low when cross.
    const mood = this.eyeOverride ?? this.permanentEye;
    const tuftTarget = n < this.perkUntil ? 1.55
      : this.state === "sleeping" ? 0.3
      : this.state === "error" || mood === "flat" ? 0.7
      : this.dancingLevel > 0.3 || mood === "happy" || mood === "heart" || this.state === "finished" ? 1.25
      : 1;
    this.tuftVel += (90 * (tuftTarget - this.tuftUp) - 8 * this.tuftVel) * dt;
    this.tuftUp += this.tuftVel * dt;
    // What he wears lands with a little bounce and lifts off without one.
    const ds = Math.min(dt, 1 / 30);
    for (const k of ["phones", "band", "glasses"] as const) {
      this.wearVel[k] += (95 * (+this.wearOn[k] - this.wear[k]) - 9.5 * this.wearVel[k]) * ds;
      this.wear[k] = Math.max(0, this.wear[k] + this.wearVel[k] * ds);
    }
    this.bandCol = this.wear.band < 0.01 ? this.bandColT : mix3(this.bandCol, this.bandColT, 1 - Math.pow(0.02, dt));
    this.prevYaw = this.yaw;
    this.prevOy = this.oy;

    this.lastTime = n;
  }

  private doMiniBehaviorLoop() {
    const n = now();
    switch (this.permanentEmote) {
      case "happy":
        if (this.locks.has("oy")) { this.miniNextBehavior = n + 0.4; return; }
        this.anim("oy", [[-0.3, 120, Ease.out], [0.03, 200, Ease.inOut], [0, 160, Ease.back]]);
        this.anim("sy", [[0.82, 80, Ease.out], [1.18, 130, Ease.out], [0.88, 160, Ease.inOut], [1, 200, Ease.back]]);
        this.anim("sx", [[1.15, 80, Ease.out], [0.88, 130, Ease.out], [1.06, 160, Ease.inOut], [1, 200, Ease.back]]);
        this.miniNextBehavior = n + 2.2 + Math.random() * 1.2;
        break;
      case "annoyed":
        if (this.locks.has("yaw")) { this.miniNextBehavior = n + 0.5; return; }
        this.anim("yaw", [
          [-0.65, 50, Ease.out], [0.65, 90, Ease.inOut], [-0.5, 80, Ease.inOut],
          [0.4, 75, Ease.inOut], [-0.2, 70, Ease.inOut], [0, 140, Ease.out],
        ]);
        this.miniNextBehavior = n + 3.0 + Math.random() * 2.5;
        break;
      case "wink":
        this.eyeOverride = "wink";
        this.eyeOverrideUntil = n + 0.55;
        this.anim("tilt", [[0.13, 100, Ease.out], [0.13, 320, Ease.lin], [0, 200, Ease.inOut]]);
        this.miniNextBehavior = n + 2.2 + Math.random() * 2.0;
        break;
      case "love":
        this.emit("heart", 2);
        this.anim("tilt", [[-0.1, 180, Ease.out], [0.1, 340, Ease.inOut], [0, 220, Ease.inOut]]);
        this.miniNextBehavior = n + 2.6 + Math.random() * 1.5;
        break;
      default:
        this.miniNextBehavior = n + 3.0 + Math.random() * 2.0;
    }
  }

  // ── Dancing ─────────────────────────────────────────────────────────────────

  setDancing(dancing: boolean) {
    if (this.isDancing !== dancing) this.isDancing = dancing;
  }

  /**
   * Applies the dance bounce and sway around the bottom of the body. Call it on
   * a saved context, before draw(), with the same size.
   */
  applyDance(x: CanvasRenderingContext2D, W: number, H: number) {
    if (this.dancingLevel <= 0.001) return;
    const R = W * 0.3;
    const px = W / 2 + this.ox * R;
    const py = H / 2 + this.particleOverhang / 2 + this.oy * R + R * 0.06 + R * 0.88;
    const d = danceTransform(now(), this.dancingLevel, R, this.danceHop);
    x.translate(px + d.dx, py + d.dy);
    x.rotate(d.rotate);
    x.scale(d.sx, d.sy);
    x.translate(-px, -py);
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  /**
   * Draws hands, body, blush, eyes, mouth, badge and particles into a canvas of
   * `w`×`h` CSS pixels (the caller has already applied the DPR transform).
   */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    const R = W * 0.3;
    const rx = R * PUHU_RX;
    const ry = R * PUHU_RY;
    const cx = W / 2 + this.ox * R;
    const cy = H / 2 + this.particleOverhang / 2 + this.oy * R + R * 0.06;

    x.save();
    if (this.stride > 0.001) {
      // A step: rocked onto one foot, about where it stands, and lifted a little.
      const rock = Math.sin(this.stridePhase) * this.stride;
      x.translate(cx, cy + ry);
      x.rotate(rock * 0.16);
      x.translate(-cx, -cy - ry - Math.abs(rock) * R * 0.12);
    }
    x.translate(cx, cy);
    if (this.tilt !== 0) x.rotate(this.tilt);
    x.scale(this.sx, this.sy);

    this.drawWings(x, R, rx, ry);
    const turn = this.yaw + Math.sin(this.swivel) * 1.4;
    const wearing = !this.isMini;
    if (wearing) this.drawPhones(x, R, turn, false);

    const body = this.bodyPath(rx, ry, R);
    this.drawBody(x, body);

    // Puhu keeps his colour in every state: no state tint, and cheeks only for love.
    const blushVal = this.blush;
    if (blushVal > 0.01) {
      x.save();
      x.clip(body);
      const yOffset = Math.sin(this.yaw) * rx * 0.8;
      x.fillStyle = `rgba(255,120,150,${0.5 * blushVal})`;
      for (const sd of [-1, 1]) {
        x.beginPath();
        x.ellipse(sd * rx * 0.55 + yOffset, ry * 0.2, R * 0.17, R * 0.1, 0, 0, Math.PI * 2);
        x.fill();
      }
      x.restore();
    }

    this.drawEyes(x, body, R, rx, ry);
    if (wearing) {
      this.drawBand(x, body, R, rx, turn);
      this.drawGlasses(x, R, rx, ry);
      this.drawPhones(x, R, turn, true);
    }
    this.drawSip(x, R, ry);
    this.drawActs(x, R, rx, ry);

    x.restore();

    if (this.badge && !this.hideBadge && this.badgeS > 0.01) {
      this.drawBadge(x, this.badge, R, cx, cy);
    }
    this.drawParticles(x, R, cx, cy);
  }

  private bodyPath(_rx: number, _ry: number, R: number): Path2D {
    const n = 96;
    const p = new Path2D();
    const ruffle = now() * 18;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const { x: bx, y: by } = puhuPoint(a, R, this.tuftUp, this.physDx * this.softLag, this.yaw + Math.sin(this.swivel) * 1.4);
      // Puffed up: a little larger, the outline ruffled into soft feathers.
      const puff = this.fluff > 0.001 ? 1 + this.fluff * (0.06 + 0.018 * Math.sin(a * 10 + ruffle)) : 1;
      const px = bx * puff;
      const py = by * puff;
      if (i === 0) p.moveTo(px, py);
      else p.lineTo(px, py);
    }
    p.closePath();
    return p;
  }

  private drawBody(x: CanvasRenderingContext2D, body: Path2D) {
    // Mini bots: a flat solid fill, no gradient, reflection or highlight.
    x.fillStyle = this.bodyColor ? rgba(this.bodyColor, 1) : rgba(PUHU_COLORS[puhuColor()].body);
    x.fill(body);
  }

  private drawEyes(x: CanvasRenderingContext2D, body: Path2D, R: number, rx: number, ry: number) {
    let shape: EyeShape = this.eyeOverride ?? this.cfg.eye;
    // Dancing: happy eyes in the calm states.
    if (this.isDancing && this.dancingLevel > 0.15 && !this.isMini && (this.state === "idle" || this.state === "finished")) {
      shape = "happy";
    }

    x.save();
    x.clip(body);
    const ink = this.isMini ? MINI_INK : this.bodyColor ? INK : PUHU_COLORS[puhuColor()].ink;
    x.fillStyle = ink;
    x.strokeStyle = ink;

    for (const sd of [-1, 1]) {
      const eyeYaw = sd * PUHU_EYE_SP + this.yaw + this.swivel;
      let eyePitch = PUHU_EYE_P + this.pitch + this.roll;
      eyePitch = (((eyePitch + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const cp = Math.cos(eyePitch);
      if (Math.cos(eyeYaw) * cp <= 0.04) continue;

      const ex = Math.sin(eyeYaw) * cp * rx;
      const ey = -Math.sin(eyePitch) * ry;
      const fx = Math.max(0.18, Math.cos(eyeYaw));
      const fy = Math.max(0.18, cp);
      const eyeMult = this.isMini ? 1.75 : PUHU_EYE_SCALE;
      const ew = R * EYE_W * this.es * eyeMult;
      const eh = R * EYE_H * this.es * eyeMult;

      x.save();
      x.translate(ex, ey);
      x.scale(fx, fy);
      this.drawEyeShape(x, shape, ew, eh, sd, ink);
      x.restore();
    }
    x.restore();
  }

  private drawEyeShape(
    x: CanvasRenderingContext2D, shape: EyeShape,
    w: number, h: number, sd: number, ink: string,
  ) {
    const t = now();
    switch (shape) {
      case "wide":
        this.drawEyeShape(x, "pill", w * 1.16, h * 1.12, sd, ink);
        break;
      case "pill": {
        const hh = Math.max(h * this.open, w * 0.3);
        roundRectPath(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2));
        x.fill();
        break;
      }
      case "dot":
        x.beginPath();
        x.arc(0, 0, w * 0.45, 0, Math.PI * 2);
        x.fill();
        break;
      case "line":
        x.rotate(-sd * 0.2);
        roundRectPath(x, -w * 0.78, -w * 0.21, w * 1.56, w * 0.42, w * 0.21);
        x.fill();
        break;
      case "flat":
        roundRectPath(x, -w * 0.72, -w * 0.2, w * 1.44, w * 0.4, w * 0.2);
        x.fill();
        break;
      case "happy":
        x.lineWidth = w * 0.5;
        x.lineCap = "round";
        x.beginPath();
        x.arc(0, h * 0.18, w * 0.82, Math.PI * 1.12, Math.PI * 1.88);
        x.stroke();
        break;
      case "closed":
        x.lineWidth = w * 0.36;
        x.lineCap = "round";
        x.beginPath();
        x.arc(0, -h * 0.08, w * 0.78, Math.PI * 0.15, Math.PI * 0.85);
        x.stroke();
        break;
      case "spiral": {
        x.lineWidth = w * 0.22;
        x.lineCap = "round";
        x.beginPath();
        for (let a = 0; a < 4.4 * Math.PI; a += 0.2) {
          const r = w * 0.06 + a * w * 0.058;
          const aa = a + t * 9 * sd;
          const px = Math.cos(aa) * r;
          const py = Math.sin(aa) * r;
          if (a === 0) x.moveTo(px, py);
          else x.lineTo(px, py);
        }
        x.stroke();
        break;
      }
      case "heart":
        x.fillStyle = "#FF4D6D";
        heartPath(x, w * 1.2);
        x.fill();
        x.fillStyle = ink;
        break;
      case "star":
        x.fillStyle = "#F7B32B";
        x.rotate(t * 1.5 * sd);
        starPath(x, w * 1.05, w * 0.46);
        x.fill();
        x.fillStyle = ink;
        break;
      case "tired":
        roundRectPath(x, -w / 2, -h * 0.02, w, h * 0.38, w / 2);
        x.fill();
        roundRectPath(x, -w * 0.62, -h * 0.1, w * 1.24, w * 0.22, w * 0.11);
        x.fill();
        break;
      case "wink":
        if (sd < 0) {
          const hh = Math.max(h * this.open, w * 0.3);
          roundRectPath(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2));
          x.fill();
        } else {
          x.lineWidth = w * 0.5;
          x.lineCap = "round";
          x.beginPath();
          x.arc(0, h * 0.18, w * 0.82, Math.PI * 1.12, Math.PI * 1.88);
          x.stroke();
        }
        break;
      case "cup": {
        // Flat top, rounded bottom corners (U shape) — used while the box is open
        const hh = Math.max(h * this.open, w * 0.3);
        const cr = Math.min(w / 2, hh / 2);
        x.beginPath();
        x.moveTo(-w / 2, -hh / 2);
        x.lineTo(w / 2, -hh / 2);
        x.lineTo(w / 2, hh / 2 - cr);
        x.quadraticCurveTo(w / 2, hh / 2, w / 2 - cr, hh / 2);
        x.lineTo(-w / 2 + cr, hh / 2);
        x.quadraticCurveTo(-w / 2, hh / 2, -w / 2, hh / 2 - cr);
        x.closePath();
        x.fill();
        break;
      }
    }
  }

  /** Hands sit behind the body — drawn before it, in world coordinates. */
  /**
   * Puhu's wings, behind him: folded away at rest (`hands` 0), out to beat, wave
   * hello (the right one) or rise like a hand. A shade darker than his body, so a
   * wing reads where it meets him.
   */
  private drawWings(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    if (this.hands <= 0.01 || this.isMini) return;
    if (R <= 14) return; // nothing to see at compact sizes
    const t = now();
    const flapping = t < this.flapUntil;
    const waving = this.waveStart > 0 && t >= this.waveStart && t < this.waveUntil;
    x.fillStyle = rgba(mix3(this.bodyColor ?? PUHU_COLORS[puhuColor()].body, [0, 0, 0], 0.1));
    for (const sd of [-1, 1]) {
      // From straight down, outwards.
      let ang = 0.5;
      if (flapping) ang = 1.05 + 0.75 * Math.sin(2 * Math.PI * this.flapRate * t + (sd > 0 ? 0 : 0.3));
      else if (waving && sd > 0) ang = 2.3 + Math.sin(2 * Math.PI * 4.5 * (t - this.waveStart)) * 0.35;
      else if (this.wingUp === sd) ang = 2.4 + Math.sin(t * 9) * 0.12;
      const len = R * 0.6 * this.hands;
      x.save();
      x.translate(sd * rx * 0.72, ry * 0.1);
      x.rotate(-sd * ang * Math.min(1, this.hands * 1.5));
      x.beginPath();
      x.ellipse(sd * len * 0.06, len * 0.52, R * 0.2, len * 0.52, 0, 0, Math.PI * 2);
      x.fill();
      x.restore();
    }
  }

  /**
   * How far a piece he wears still is from its place (1 off, 0 on, a little below
   * 0 while it lands past it and springs back), and how opaque it is.
   */
  private wearing(k: "phones" | "band" | "glasses"): { off: number; alpha: number } {
    const p = this.wear[k];
    return { off: 1 - p, alpha: Math.min(1, p * 2.5) };
  }

  /**
   * Headphones: the band arches over his head behind it (`front` false), so only
   * what rises above him shows and the tufts stay in front; the cups sit on the
   * sides of his head (`front` true). Both drop in from above.
   */
  private drawPhones(x: CanvasRenderingContext2D, R: number, turn: number, front: boolean) {
    if (this.wear.phones < 0.01) return;
    const { off, alpha } = this.wearing("phones");
    x.save();
    x.globalAlpha = alpha;
    x.translate(Math.sin(turn) * R * 0.1, -off * R * 0.6);
    // Graphite: it shows on the black island and on him alike, Kar or Gece.
    const ink = PHONES;
    if (!front) {
      x.strokeStyle = ink;
      x.lineWidth = Math.max(R * 0.1, 1.2);
      x.lineCap = "round";
      x.beginPath();
      x.ellipse(0, -R * 0.12, R * 0.97, R * 0.92, 0, Math.PI * 1.05, Math.PI * 1.95);
      x.stroke();
    } else {
      for (const sd of [-1, 1]) {
        x.fillStyle = ink;
        x.beginPath();
        x.ellipse(sd * R * 0.9, -R * 0.1, R * 0.16, R * 0.26, 0, 0, Math.PI * 2);
        x.fill();
        if (R > 14) {
          // The cushion, a shade lighter.
          x.strokeStyle = PHONES_PAD;
          x.lineWidth = R * 0.035;
          x.beginPath();
          x.ellipse(sd * R * 0.9, -R * 0.1, R * 0.09, R * 0.18, 0, 0, Math.PI * 2);
          x.stroke();
        }
      }
    }
    x.restore();
  }

  /**
   * The focus band (a hachimaki) round his forehead in the Pomodoro phase's
   * colour, knotted on one side; its two ends trail his moves. It is tied on:
   * the band wraps across from the knot, then the ends flick out.
   */
  private drawBand(x: CanvasRenderingContext2D, body: Path2D, R: number, rx: number, turn: number) {
    if (this.wear.band < 0.01) return;
    const { off, alpha } = this.wearing("band");
    const wrap = Math.min(1, 1 - off);
    const col = rgba(this.bandCol);
    const y0 = -R * 0.4;
    const h = R * 0.16;
    const bow = R * 0.06;
    x.save();
    x.globalAlpha = alpha;
    x.fillStyle = col;
    x.save();
    x.clip(body);
    x.beginPath();
    x.rect(-R * 1.2, -R * 2, R * 2.4 * wrap, R * 4);
    x.clip();
    x.beginPath();
    x.moveTo(-R * 1.2, y0 - h / 2 + bow);
    x.quadraticCurveTo(0, y0 - h / 2 - bow, R * 1.2, y0 - h / 2 + bow);
    x.lineTo(R * 1.2, y0 + h / 2 + bow);
    x.quadraticCurveTo(0, y0 + h / 2 - bow, -R * 1.2, y0 + h / 2 + bow);
    x.closePath();
    x.fill();
    x.restore();
    // The knot on his right (our left), the ends trailing out from it.
    const kx = -rx * 0.97 + Math.sin(turn) * R * 0.12;
    const ky = y0 + bow * 0.8;
    const t = now();
    for (const [i, full, a0] of [[0, R * 0.46, 0.3], [1, R * 0.36, 0.8]] as const) {
      const len = full * Math.max(0, 1 - off * 1.6);
      if (len < R * 0.02) continue;
      // Mirrored, so a larger angle swings the end down and to the right: where the lag pushes it.
      const a = a0 + this.physDx * 0.5 + this.physDy * 0.6 + Math.sin(t * 4.2 + i * 1.7) * 0.05;
      const wv = Math.sin(t * 5.1 + i) * h * 0.18;
      x.save();
      x.translate(kx, ky);
      x.scale(-1, 1);
      x.rotate(a);
      x.beginPath();
      x.moveTo(0, -h * 0.42);
      x.quadraticCurveTo(len * 0.5, -h * 0.5 + wv, len, -h * 0.12 - wv);
      x.lineTo(len * 0.9, h * 0.32 - wv);
      x.quadraticCurveTo(len * 0.5, h * 0.42 + wv, 0, h * 0.42);
      x.closePath();
      x.fill();
      x.restore();
    }
    x.beginPath();
    x.arc(kx, ky, h * 0.6 * Math.min(1, wrap * 2), 0, Math.PI * 2);
    x.fill();
    x.restore();
  }

  /**
   * The juice box of sip(): a little battery (its cap on top, a bolt on the juice) in
   * front of him, low on one side, its straw bent up into him just under his eyes. It
   * pops up in place (nothing of it outside him: the folded island is barely taller),
   * the juice drains over the three sips, and it shrinks away.
   */
  private drawSip(x: CanvasRenderingContext2D, R: number, ry: number) {
    const t = now();
    if (t >= this.sipTo || this.isMini) return;
    const p = (t - this.sipFrom) / (this.sipTo - this.sipFrom);
    const pop = Ease.back(Math.min(1, p / 0.16));
    const fall = Math.max(0, (p - 0.84) / 0.16);
    const scale = Math.max(0, pop * (1 - fall * 0.7));
    const alpha = Math.min(1, p / 0.06) * (1 - fall);
    const juice = 1 - 0.7 * Math.min(1, Math.max(0, (p - 0.19) / 0.6));
    const w = R * 0.58;
    const h = R * 0.76;
    const bx = R * 0.34;
    const by = ry * 0.6;
    x.save();
    x.globalAlpha = alpha;
    // The straw first, behind the box: up from its cap, bent, into him under his eyes.
    x.strokeStyle = "rgba(255,255,255,0.92)";
    x.lineWidth = Math.max(R * 0.08, 1);
    x.lineCap = "round";
    x.lineJoin = "round";
    x.beginPath();
    x.moveTo(bx + w * 0.18, by - h / 2);
    x.lineTo(bx + w * 0.18, by - h / 2 - R * 0.2);
    x.lineTo(R * 0.06, ry * 0.1);
    x.stroke();
    // The box: a battery, rim and cap in graphite, the juice in the charger's green.
    x.translate(bx, by);
    x.scale(scale, scale);
    x.translate(-bx, -by);
    x.fillStyle = PHONES;
    roundRectPath(x, bx - w * 0.2, by - h / 2 - R * 0.07, w * 0.4, R * 0.09, R * 0.03);
    x.fill();
    roundRectPath(x, bx - w / 2, by - h / 2, w, h, R * 0.08);
    x.fill();
    const inset = Math.max(R * 0.05, 0.6);
    const ih = (h - inset * 2) * juice;
    x.fillStyle = "#6ccb5f";
    roundRectPath(x, bx - w / 2 + inset, by + h / 2 - inset - ih, w - inset * 2, ih, R * 0.05);
    x.fill();
    if (R > 12) {
      x.fillStyle = "rgba(255,255,255,0.9)";
      x.beginPath();
      x.moveTo(bx + w * 0.06, by - h * 0.26);
      x.lineTo(bx - w * 0.16, by + h * 0.04);
      x.lineTo(bx + w * 0.02, by + h * 0.04);
      x.lineTo(bx - w * 0.06, by + h * 0.28);
      x.lineTo(bx + w * 0.16, by - h * 0.04);
      x.lineTo(bx - w * 0.02, by - h * 0.04);
      x.closePath();
      x.fill();
    }
    x.restore();
  }

  /**
   * The acts' props, in front of him: the antenna (a graphite rod out of the top of his
   * head, its tip blinking amber as it sways, green once found), wings over his ears, a
   * wing to his beak. Each pops in and out on its own short scale.
   */
  private drawActs(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    if (this.isMini) return;
    const t = now();
    const wing = rgba(mix3(this.bodyColor ?? PUHU_COLORS[puhuColor()].body, [0, 0, 0], 0.22));
    const pop = (until: number, from: number) =>
      Ease.back(Math.min(1, (t - from) / 0.22)) * Math.min(1, Math.max(0, (until - t) / 0.2));
    if (t < this.antennaUntil) {
      const grow = pop(this.antennaUntil, this.antennaFrom);
      const found = this.antennaFound > 0;
      // Leaning out to one side: the folded island is barely taller than he is.
      const sway = found ? 0 : Math.sin(t * 5) * 0.3;
      const len = R * 0.52 * grow;
      x.save();
      x.translate(R * 0.3, -ry * 0.72);
      x.rotate(0.6 + sway);
      x.strokeStyle = PHONES;
      x.lineWidth = Math.max(R * 0.07, 1);
      x.lineCap = "round";
      x.beginPath();
      x.moveTo(0, 0);
      x.lineTo(0, -len);
      x.stroke();
      const glow = found ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(t * 6));
      x.fillStyle = found ? `rgba(108,203,95,${glow})` : `rgba(255,179,64,${glow})`;
      x.beginPath();
      x.arc(0, -len, Math.max(R * 0.12, 1.4) * grow, 0, Math.PI * 2);
      x.fill();
      x.restore();
    }
    if (t < this.earsUntil) {
      const s = pop(this.earsUntil, this.earsFrom);
      const shake = Math.sin(t * 38) * R * 0.012;
      x.fillStyle = wing;
      for (const sd of [-1, 1]) {
        x.save();
        x.translate(sd * rx * 0.8 + shake, -ry * 0.55);
        x.rotate(sd * 0.45);
        x.scale(s, s);
        x.beginPath();
        x.ellipse(0, 0, R * 0.17, R * 0.3, 0, 0, Math.PI * 2);
        x.fill();
        x.restore();
      }
    }
    if (t < this.shhUntil) {
      const s = pop(this.shhUntil, this.shhFrom);
      x.save();
      x.fillStyle = wing;
      x.translate(-rx * 0.05, ry * 0.28);
      x.rotate(-0.22);
      x.scale(s, s);
      x.beginPath();
      x.ellipse(0, 0, R * 0.1, R * 0.3, 0, 0, Math.PI * 2);
      x.fill();
      x.restore();
    }
  }

  /** Round reading glasses over his eyes, turning with them. */
  private drawGlasses(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    if (this.wear.glasses < 0.01) return;
    const { off, alpha } = this.wearing("glasses");
    const ink = PUHU_COLORS[puhuColor()].ink;
    const r = R * 0.25 * (1 - off * 0.4);
    const lenses: { ex: number; ey: number; fx: number; sd: number }[] = [];
    for (const sd of [-1, 1]) {
      const eyeYaw = sd * PUHU_EYE_SP + this.yaw + this.swivel;
      let eyePitch = PUHU_EYE_P + this.pitch + this.roll;
      eyePitch = (((eyePitch + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const cp = Math.cos(eyePitch);
      if (Math.cos(eyeYaw) * cp <= 0.04) continue;
      lenses.push({ ex: Math.sin(eyeYaw) * cp * rx, ey: -Math.sin(eyePitch) * ry, fx: Math.max(0.25, Math.cos(eyeYaw)), sd });
    }
    x.save();
    x.globalAlpha = alpha;
    x.strokeStyle = ink;
    x.lineWidth = Math.max(R * 0.055, 0.8);
    x.lineCap = "round";
    for (const l of lenses) {
      x.beginPath();
      x.ellipse(l.ex, l.ey, r * l.fx, r, 0, 0, Math.PI * 2);
      x.fillStyle = "rgba(150,200,255,0.22)";
      x.fill();
      x.stroke();
      // The arm, back to the ear on the lens's own side; turned far that way,
      // the lens reaches the edge of his head and the arm goes behind it.
      const from = l.ex + l.sd * r * l.fx;
      const to = l.sd * rx * 0.9;
      if ((to - from) * l.sd > R * 0.04) {
        x.beginPath();
        x.moveTo(from, l.ey - r * 0.25);
        x.lineTo(to, l.ey - r * 0.45);
        x.stroke();
      }
    }
    if (lenses.length === 2) {
      const [a, b] = lenses;
      x.beginPath();
      x.moveTo(a.ex + r * a.fx, a.ey - r * 0.15);
      x.quadraticCurveTo((a.ex + b.ex) / 2, (a.ey + b.ey) / 2 - r * 0.6, b.ex - r * b.fx, b.ey - r * 0.15);
      x.stroke();
    }
    if (R > 14) {
      // A glint on each lens.
      x.strokeStyle = "rgba(255,255,255,0.7)";
      x.lineWidth = R * 0.04;
      for (const l of lenses) {
        x.beginPath();
        x.ellipse(l.ex, l.ey, r * l.fx * 0.68, r * 0.68, 0, Math.PI * 1.15, Math.PI * 1.45);
        x.stroke();
      }
    }
    x.restore();
  }

  private drawBadge(x: CanvasRenderingContext2D, badge: Badge, R: number, cx: number, cy: number) {
    const bs = this.badgeS * (this.isMini ? 1.25 : 1);
    // Above his head, between the tufts, over
    // the headphones' band when he wears them; it follows his tilt and his look.
    const turn = this.yaw + Math.sin(this.swivel) * 1.4;
    const lx = R * 0.86 * Math.sin(turn * 0.18);
    const ly = -R * (1.12 + 0.22 * Math.min(1, this.wear.phones)) * this.sy;
    const bx = cx + lx * Math.cos(this.tilt) - ly * Math.sin(this.tilt);
    const by = cy + lx * Math.sin(this.tilt) + ly * Math.cos(this.tilt);
    const t = now();

    x.save();
    x.translate(bx, by);
    x.scale(bs, bs);
    const col = rgba(badge.color);

    if (badge.kind === "dots") {
      if (this.isMini) {
        const phase = (t * 2.4) % 1;
        const dotR = R * 0.22 * (1 + 0.25 * Math.sin(phase * Math.PI * 2));
        x.fillStyle = "#000";
        x.beginPath();
        x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = col;
        x.beginPath();
        x.arc(0, 0, dotR, 0, Math.PI * 2);
        x.fill();
      } else {
        const pw = R * 0.72;
        const ph = R * 0.36;
        roundRectPath(x, -pw / 2, -ph / 2, pw, ph, ph / 2);
        x.fillStyle = col;
        x.fill();
        for (let i = 0; i < 3; i++) {
          const phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1;
          const dotR = R * 0.055 * (1 + 0.4 * Math.max(0, Math.sin(phase * Math.PI * 2)));
          x.fillStyle = "#fff";
          x.beginPath();
          x.arc((i - 1) * R * 0.18, 0, dotR, 0, Math.PI * 2);
          x.fill();
        }
      }
    } else if (badge.kind === "arrow") {
      // The "!" badge's ring and disc, with a white up-arrow: a new version is out.
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
      x.fill();
      if (!this.isMini) {
        const a = R * 0.12;
        x.strokeStyle = "#fff";
        x.lineWidth = R * 0.055;
        x.lineCap = "round";
        x.lineJoin = "round";
        x.beginPath();
        x.moveTo(0, a);
        x.lineTo(0, -a);
        x.moveTo(-a * 0.8, -a * 0.2);
        x.lineTo(0, -a);
        x.lineTo(a * 0.8, -a * 0.2);
        x.stroke();
      }
    } else if (badge.kind === "bang" || badge.kind === "question") {
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.23, 0, Math.PI * 2);
      x.fill();
      if (!this.isMini) {
        x.fillStyle = "#fff";
        x.font = `900 ${R * 0.32}px ${FONT}`;
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText(badge.kind === "bang" ? "!" : "?", 0, R * 0.02);
      }
    } else {
      x.fillStyle = "#000";
      x.beginPath();
      x.arc(0, 0, R * 0.2, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      x.arc(0, 0, R * 0.135, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  private drawParticles(x: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      if (p.age <= 0) continue;
      const k = p.age / p.life;
      const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const feather = p.type === "feather";
      const px = cx + (p.x + (feather ? Math.sin(p.age * 4 + p.rot) * 0.18 : p.vx * p.age)) * R * 1.3;
      const py = cy + (feather ? 0.2 + 0.42 * p.age : p.y + p.vy * p.age) * R * 1.3;
      const sz = R * p.size * (1 + k * 0.4);

      x.save();
      x.translate(px, py);
      x.globalAlpha = Math.min(1, Math.max(0, a));
      switch (p.type) {
        case "heart":
          x.rotate(Math.sin(p.age * 6) * 0.3);
          x.fillStyle = "#FF4D6D";
          heartPath(x, sz);
          x.fill();
          break;
        case "star":
          x.rotate(p.rot + p.age * 2);
          x.fillStyle = "#F7B32B";
          starPath(x, sz, sz * 0.45);
          x.fill();
          break;
        case "spark":
          x.rotate(p.rot);
          x.fillStyle = "#fff";
          starPath(x, sz * 0.8, sz * 0.18);
          x.fill();
          break;
        case "sweat":
          x.fillStyle = "#7CC7FF";
          x.beginPath();
          x.moveTo(0, -sz);
          x.quadraticCurveTo(sz * 0.8, sz * 0.2, 0, sz * 0.6);
          x.quadraticCurveTo(-sz * 0.8, sz * 0.2, 0, -sz);
          x.fill();
          break;
        case "feather":
          x.rotate(Math.sin(p.age * 4 + p.rot) * 0.7);
          x.fillStyle = rgba(this.bodyColor ?? PUHU_COLORS[puhuColor()].body);
          x.beginPath();
          x.ellipse(0, 0, sz * 0.3, sz * 0.85, 0, 0, Math.PI * 2);
          x.fill();
          break;
        case "z":
          x.fillStyle = "rgb(209,219,235)";
          x.font = `700 ${sz * 1.9}px ${FONT}`;
          x.textAlign = "center";
          x.textBaseline = "middle";
          x.fillText("z", 0, 0);
          break;
      }
      x.restore();
    }
  }
}

