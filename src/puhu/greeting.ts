// The launch hello. Puhu flies down into the island, lands, shakes his feathers,
// looks around, hoots and waves a wing, then settles in the compact island. The
// stage (the island growing, the card, the badge, the hand-off to the compact
// island) is drawn in a 640×150 reference space.

import { closeCurve } from "../core/anim";
import { Sound } from "../core/sound";
import { COMPACT_W, NOTCH_H, NOTCH_W } from "../core/layout";
import { PUHU_EYE_P, PUHU_EYE_SP, PUHU_RX, PUHU_RY, puhuCss, puhuPath, puhuPoint } from "./puhu";

// ── Timing ────────────────────────────────────────────────────────────────────

const T = {
  badge: 2.72,
  down0: 2.85,
  down1: 3.45,
  blink2: 3.7,
  tint0: 3.85,
  tint1: 4.15,
  end: 4.6,
  autoLeave: 4.9,
  COLLAPSE: 0.34,
};

export const GREETING_END = T.end;

/** The greeting's own sound, played from the start (greeting.wav). */
const GREETING_SOUND = "greeting";

// ── Geometry (640×150) ────────────────────────────────────────────────────────

export const GREETING_W = 640;
export const GREETING_H = 150;
const C0 = { x: 320, y: 90 };
const HB = 58;
const EAR_X = 40;
const EAR_HB = 17;
const CARD = { x: 10, y: 36, w: 620, h: 104 };
const CARD_R = 20;

/** IslandRestingLayout for the compact island the greeting lands in. */
const COMPACT = {
  width: COMPACT_W,
  height: NOTCH_H,
  botDiameter: Math.min(20, Math.max(0, NOTCH_H - 6)),
  botCenterY: NOTCH_H / 2,
  miniGridScale: Math.min(1, Math.max(0, NOTCH_H - 4) / 28),
  miniGridCenterX: COMPACT_W - 40,
};

// ── Easing ────────────────────────────────────────────────────────────────────

const E = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  easeIn: (t: number) => t * t * t,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

// ── Pose ──────────────────────────────────────────────────────────────────────

type EyeType = "dot" | "happy" | "content";

export interface Pose {
  hb: number; x: number; y: number; sx: number; sy: number; tilt: number;
  eye: EyeType; open: number;
  lookX: number; lookY: number;
  /** The wings: how far out (0…1), their angle from straight down, the right one waving (seconds in, or −1). */
  wings: number; flap: number; wave: number;
  /** Feathers puffed up (0…1), the head turned (radians), the tufts (1 at rest) and their lean. */
  fluff: number; swivel: number; tuft: number; lean: number;
  badge: number; tint: number; halo: number; haloBlue: number; minis: number; fx: number;
  header: number; card: number;
  iw: number; ih: number;
}

/** 0 → 1 → 0 over [a, b]. */
const pulse = (t: number, a: number, b: number) => (t >= a && t < b ? Math.sin(Math.PI * seg(t, a, b)) : 0);

/**
 * Puhu's hello: he flies down into the island on beating wings, lands with a
 * squash, shakes his feathers out (a few of them fall), looks right and left the
 * way owls do, hoots twice, waves a wing and settles in the middle. greeting.wav
 * (scripts/make-sounds.py) follows the same times.
 */
function greetPose(t: number): Pose {
  // Island size — only the card's growth uses it.
  const gx = seg(t, 0, 0.5);
  const g = Math.sin((Math.PI * gx) / 2) + 0.04 * Math.sin(Math.PI * gx) * gx;
  const iw = lerp(NOTCH_W, GREETING_W, g);
  const ih = lerp(COMPACT.height, GREETING_H, g);

  const cx = C0.x;
  const cy = C0.y;
  // Coming closer as he flies in: a little smaller at first.
  const hb = t < 0.2 ? 0 : HB * lerp(0.7, 1, E.out(seg(t, 0.2, 0.55)));

  // Down from above the screen's edge, swaying; the landing's rebound.
  const landY = cy + 0.1 * HB;
  const reboundY = cy - 0.07 * HB;
  let y: number;
  if (t < 0.64) y = lerp(-0.6 * HB, landY, E.inOut(seg(t, 0.2, 0.64)));
  else if (t < 0.8) y = lerp(landY, reboundY, E.out(seg(t, 0.64, 0.8)));
  else if (t < 0.96) y = lerp(reboundY, cy, E.inOut(seg(t, 0.8, 0.96)));
  else y = cy;
  const flying = t >= 0.2 && t < 0.64;
  const sway = flying ? Math.sin((t - 0.2) * 2 * Math.PI * 2.2) * (1 - seg(t, 0.42, 0.64)) : 0;
  let x = cx + sway * 0.08 * HB;
  // The feather shake: quick sideways shivers, fading.
  const shaking = t >= 1.06 && t < 1.38;
  const shiver = shaking ? Math.sin((t - 1.06) * 2 * Math.PI * 11) * (1 - seg(t, 1.06, 1.38)) : 0;
  x += shiver * 0.05 * HB;
  // Each hoot lifts him a little.
  y -= 0.035 * HB * (pulse(t, 2.02, 2.2) + pulse(t, 2.2, 2.38));

  // Squash and stretch: the landing, its rebound, the hoots (in, then out), settling in.
  const land = pulse(t, 0.6, 0.76);
  const rebound = pulse(t, 0.72, 0.92);
  const hoot = pulse(t, 2.06, 2.2) + pulse(t, 2.24, 2.38);
  const inhale = pulse(t, 1.98, 2.08) + pulse(t, 2.17, 2.25);
  const nestle = pulse(t, 2.88, 3.18);
  const sx = 1 + 0.17 * land - 0.08 * rebound + 0.08 * hoot - 0.04 * inhale + 0.06 * nestle;
  const sy = 1 - 0.19 * land + 0.12 * rebound - 0.08 * hoot + 0.06 * inhale - 0.05 * nestle;

  // The wings: out and beating on the way down, folded on landing, out again to wave.
  const wings = t < 0.64
    ? E.out(seg(t, 0.2, 0.3))
    : t < 2.3 ? 1 - E.inOut(seg(t, 0.64, 0.84))
      : t < 2.8 ? E.back(seg(t, 2.36, 2.5))
        : 1 - E.inOut(seg(t, 2.8, 2.96));
  const flap = flying ? 1.05 + 0.8 * Math.sin((t - 0.2) * 2 * Math.PI * 8) : 0.5;
  const wave = t >= 2.4 && t < 2.86 ? t - 2.4 : -1;

  // Feathers puffed up for the shake.
  const fluff = t < 1.3 ? E.out(seg(t, 0.98, 1.06)) : 1 - E.inOut(seg(t, 1.3, 1.46));
  // Right, then left: the eyes slide round the head.
  let swivel = 0;
  if (t >= 1.5 && t < 1.66) swivel = 1.1 * E.inOut(seg(t, 1.5, 1.66));
  else if (t >= 1.66 && t < 1.72) swivel = 1.1;
  else if (t >= 1.72 && t < 1.9) swivel = lerp(1.1, -1.1, E.inOut(seg(t, 1.72, 1.9)));
  else if (t >= 1.9 && t < 1.95) swivel = -1.1;
  else if (t >= 1.95 && t < 2.06) swivel = lerp(-1.1, 0, E.inOut(seg(t, 1.95, 2.06)));
  const tilt = 0.06 * swivel + 0.05 * sway;
  // The tufts stream up in flight, flick with the shake, rise for the hoots.
  const tuft = 1 + 0.25 * seg(t, 0.2, 0.3) * (1 - seg(t, 0.6, 0.7)) + 0.3 * pulse(t, 1.98, 2.42) - 0.15 * land;
  const lean = shaking ? -Math.cos((t - 1.06) * 2 * Math.PI * 11) * 0.8 * (1 - seg(t, 1.06, 1.38)) : -swivel * 0.3 - sway * 0.4;

  // Eyes: glad on landing, shut for the hoots, glad again for the wave.
  let eye: EyeType = "dot";
  if (t >= 0.66 && t < 0.9) eye = "happy";
  if (t >= 2.02 && t < 2.38) eye = "content";
  if (t >= 2.38 && t < 2.86) eye = "happy";
  const blink = (tb: number) => {
    const k = seg(t, tb, tb + 0.12);
    return k > 0 && k < 1 ? 1 - Math.sin(Math.PI * k) * 0.94 : 1;
  };
  const open = Math.min(blink(1.42), blink(3.05), blink(T.blink2));

  // Look: down while landing; then, as he settles, down to where the compact island will be.
  let lookX = 0;
  let lookY = 0;
  if (flying) lookY = 0.45;
  else if (t >= T.down0 && t < T.down1) { lookX = 0.3; lookY = 0.6; }
  else if (t >= T.down1) {
    const k = E.inOut(seg(t, T.down1, T.down1 + 0.35));
    lookX = lerp(0.3, 0, k);
    lookY = lerp(0.6, 0, k);
  }

  return {
    hb, x, y, sx, sy, tilt,
    eye, open,
    lookX, lookY,
    wings, flap, wave,
    fluff, swivel, tuft, lean,
    badge: E.back(seg(t, T.badge, T.badge + 0.28)),
    tint: 0.6 * E.inOut(seg(t, T.tint0, T.tint1)),
    halo: E.out(seg(t, 0.3, 0.7)),
    haloBlue: seg(t, T.tint0, T.tint1),
    minis: 0,
    fx: 1,
    header: seg(t, 0.35, 0.6),
    card: seg(t, 0.18, 0.45),
    iw, ih,
  };
}

function smallPose(): Pose {
  return {
    hb: (EAR_HB * COMPACT.botDiameter) / 20,
    x: GREETING_W / 2 - COMPACT.width / 2 + EAR_X,
    y: COMPACT.botCenterY,
    sx: 1, sy: 1, tilt: 0,
    eye: "dot", open: 1,
    lookX: 0, lookY: 0,
    wings: 0, flap: 0.5, wave: -1,
    fluff: 0, swivel: 0, tuft: 1, lean: 0,
    badge: 1, tint: 0.6, halo: 0.6, haloBlue: 1,
    minis: 1, fx: 1,
    header: 0, card: 0,
    iw: COMPACT.width, ih: COMPACT.height,
  };
}

/** Puhu's pose `t` seconds in; `tc` is when the collapse began (∞ if not yet). */
export function greetingPose(t: number, tc = Number.POSITIVE_INFINITY): Pose {
  if (t < tc) return greetPose(Math.min(t, T.end + 10));
  const a = greetPose(tc);
  const b = smallPose();
  // Same curve and duration (340 ms) as the island shrinking around him, so it
  // never gets ahead of him and cuts his body off when the greeting is left early.
  const k = seg(t, tc, tc + T.COLLAPSE);
  const e = k >= 1 ? 1 : closeCurve(k);
  const p: Pose = { ...a };
  p.iw = lerp(a.iw, b.iw, e);
  p.ih = lerp(a.ih, b.ih, e);
  p.x = lerp(a.x, b.x, e);
  p.y = lerp(a.y, b.y, e);
  p.hb = lerp(a.hb, b.hb, e);
  p.badge = lerp(a.badge, b.badge, e);
  p.tint = lerp(a.tint, b.tint, e);
  p.halo = lerp(a.halo, b.halo, e);
  p.haloBlue = lerp(a.haloBlue, b.haloBlue, e);
  p.header = a.header * (1 - seg(t, tc, tc + 0.1));
  p.card = a.card * (1 - seg(t, tc, tc + 0.18));
  p.wings = a.wings * (1 - seg(t, tc, tc + 0.15));
  p.tilt = a.tilt * (1 - e);
  p.sx = lerp(a.sx, 1, e);
  p.sy = lerp(a.sy, 1, e);
  p.fluff = a.fluff * (1 - e);
  p.swivel = a.swivel * (1 - e);
  p.tuft = lerp(a.tuft, 1, e);
  p.lean = a.lean * (1 - e);
  const bk = seg(t, tc + 0.14, tc + 0.26);
  p.eye = "dot";
  p.open = bk > 0 && bk < 1 ? 1 - Math.sin(Math.PI * bk) * 0.94 : 1;
  p.lookX = a.lookX * (1 - e);
  p.lookY = a.lookY * (1 - e);
  p.minis = E.back(seg(t, tc + 0.24, tc + 0.42));
  p.fx = 1 - seg(t, tc, tc + 0.2);
  return p;
}

/** A wing's angle now (from straight down, outwards): the pose's, or the right one waving. */
function wingAngle(p: Pose, sd: number): number {
  if (p.wave >= 0 && sd > 0) return 2.3 + Math.sin(p.wave * 2 * Math.PI * 4.5) * 0.35 * clamp(p.wave / 0.08, 0, 1);
  return p.flap;
}

/** Puhu's outline for the pose, around his centre, for a body `R`. */
function puhuShape(R: number, p: Pose): Path2D {
  const path = new Path2D();
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const pt = puhuPoint(a, R, p.tuft, p.lean, Math.sin(p.swivel) * 1.4);
    const puff = p.fluff > 0.001 ? 1 + p.fluff * (0.06 + 0.018 * Math.sin(a * 10 + p.fluff * 6)) : 1;
    if (i === 0) path.moveTo(pt.x * puff, pt.y * puff);
    else path.lineTo(pt.x * puff, pt.y * puff);
  }
  path.closePath();
  return path;
}

/**
 * Box of Puhu's body and wings in the 640×150 space — what must stay inside the
 * island so nothing of him is cut off.
 */
export function puhuBounds(p: Pose): { left: number; right: number; top: number; bottom: number } | null {
  const hh = p.hb / 2;
  if (hh <= 0.4) return null;
  const R = hh / PUHU_RY;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  const add = (x: number, y: number) => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  const puff = 1 + 0.08 * p.fluff;
  for (let i = 0; i < 48; i++) {
    const pt = puhuPoint((i / 48) * Math.PI * 2, R, p.tuft, p.lean, Math.sin(p.swivel) * 1.4);
    add(pt.x * puff, pt.y * puff);
  }
  if (p.wings > 0.01) {
    for (const sd of [-1, 1]) {
      const ang = wingAngle(p, sd) * Math.min(1, p.wings * 1.5);
      const len = R * 0.6 * p.wings;
      const px = sd * R * PUHU_RX * 0.72;
      const py = hh * 0.1;
      // The paddle's far end, and its width either side of the arm.
      for (const along of [len, len * 0.5]) {
        add(px + sd * Math.sin(ang) * along + Math.cos(ang) * R * 0.2, py + Math.cos(ang) * along + Math.sin(ang) * R * 0.2);
        add(px + sd * Math.sin(ang) * along - Math.cos(ang) * R * 0.2, py + Math.cos(ang) * along - Math.sin(ang) * R * 0.2);
      }
    }
  }
  return {
    left: p.x + left * p.sx,
    right: p.x + right * p.sx,
    top: p.y + top * p.sy,
    bottom: p.y + bottom * p.sy,
  };
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function rr(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

/** The wings, behind him, a shade darker than his body (as the engine draws them). */
function drawWings(x: CanvasRenderingContext2D, R: number, hh: number, p: Pose) {
  if (p.wings <= 0.01) return;
  x.fillStyle = puhuCss().wing;
  for (const sd of [-1, 1]) {
    const len = R * 0.6 * p.wings;
    x.save();
    x.translate(sd * R * PUHU_RX * 0.72, hh * 0.1);
    x.rotate(-sd * wingAngle(p, sd) * Math.min(1, p.wings * 1.5));
    x.beginPath();
    x.ellipse(sd * len * 0.06, len * 0.52, R * 0.2, len * 0.52, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
}

function drawPuhu(x: CanvasRenderingContext2D, p: Pose) {
  const hh = p.hb / 2;
  if (hh <= 0.4) return;
  const R = hh / PUHU_RY;
  const hw = R * 0.92;

  // Halo: golden → blue, two passes for a soft aura
  if (p.halo > 0) {
    const bl = p.haloBlue;
    const cr = Math.round(lerp(232, 59, bl));
    const cg = Math.round(lerp(195, 158, bl));
    const cb = Math.round(lerp(154, 255, bl));
    for (const [rad, alpha] of [[hw * 2.6, 0.18], [hw * 4.2, 0.07]] as const) {
      const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha * p.halo})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      x.fillStyle = g;
      x.beginPath();
      x.arc(p.x, p.y, rad, 0, Math.PI * 2);
      x.fill();
    }
  }

  x.save();
  x.translate(p.x, p.y);
  x.rotate(p.tilt);
  x.scale(p.sx, p.sy);

  drawWings(x, R, hh, p);

  const body = puhuShape(R, p);
  const puhu = puhuCss();
  x.fillStyle = puhu.body;
  x.fill(body);

  if (p.tint > 0) {
    const g = x.createLinearGradient(0, hh, 0, -hh * 0.1);
    g.addColorStop(0, `rgba(127,180,234,${p.tint})`);
    g.addColorStop(1, "rgba(127,180,234,0)");
    x.fillStyle = g;
    x.fill(body);
  }

  // Eyes: they slide round the head as it turns, narrower towards its side.
  x.save();
  x.clip(body);
  x.fillStyle = puhu.ink;
  x.strokeStyle = puhu.ink;
  const er = R * 0.14;
  for (const sd of [-1, 1]) {
    const yaw = sd * PUHU_EYE_SP + p.swivel + p.lookX * 0.45;
    const c = Math.cos(yaw);
    if (c <= 0.04) continue;
    x.save();
    x.translate(Math.sin(yaw) * Math.cos(PUHU_EYE_P) * R * PUHU_RX, -Math.sin(PUHU_EYE_P) * hh + p.lookY * hh * 0.28);
    x.scale(Math.max(0.18, c), 1);
    x.lineCap = "round";
    if (p.eye === "happy") {
      x.lineWidth = er * 0.8;
      x.beginPath();
      x.arc(0, er * 0.6, er * 1.15, Math.PI * 1.15, Math.PI * 1.85);
      x.stroke();
    } else if (p.eye === "content") {
      x.lineWidth = er * 0.8;
      x.beginPath();
      x.arc(0, -er * 0.5, er * 1.15, Math.PI * 0.15, Math.PI * 0.85);
      x.stroke();
    } else {
      x.scale(1, Math.max(0.12, p.open));
      x.beginPath();
      x.ellipse(0, 0, er * 0.92, er, 0, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }
  x.restore();

  // Activity badge
  if (p.badge > 0.01) {
    const br = hh * 0.3;
    x.save();
    x.translate(-hw * 0.78, -hh * 0.72);
    x.scale(p.badge, p.badge);
    x.fillStyle = "#000";
    x.beginPath();
    x.arc(0, 0, br + hh * 0.07, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#3BA0F5";
    x.beginPath();
    x.arc(0, 0, br, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#0B1B3A";
    for (const i of [-1, 0, 1]) {
      x.beginPath();
      x.arc(i * br * 0.5, 0, br * 0.17, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  x.restore();
}

/** The feathers the shake lets go: they drift down, swaying, and fade. */
const FEATHERS = [
  { side: -1, dx: 0.55, phase: 0.4, t0: 1.12 },
  { side: 1, dx: 0.62, phase: 2.1, t0: 1.18 },
  { side: 1, dx: 0.36, phase: 4.0, t0: 1.25 },
];

function drawParticles(x: CanvasRenderingContext2D, t: number, p: Pose) {
  if (!(p.card > 0 || p.fx < 1)) return;
  const R = HB / 2 / PUHU_RY;
  x.fillStyle = puhuCss().body;
  for (const f of FEATHERS) {
    const age = t - f.t0;
    if (age <= 0 || age > 1.4) continue;
    const swing = Math.sin(age * 4 + f.phase);
    x.save();
    x.globalAlpha = Math.min(1, age / 0.15) * (1 - seg(age, 0.9, 1.4)) * p.fx;
    x.translate(C0.x + f.side * (f.dx * HB + age * 8) + swing * 0.12 * HB, C0.y - 0.15 * HB + age * 26);
    x.rotate(swing * 0.7);
    x.beginPath();
    x.ellipse(0, 0, R * 0.07, R * 0.2, 0, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
}

const MINI_COLORS = ["#E86A6A", "#3E86E0", "#EFAE5A", "#8C73F2"];

function drawMinis(x: CanvasRenderingContext2D, alpha: number) {
  if (alpha <= 0.01) return;
  const cx = GREETING_W / 2 - COMPACT.width / 2 + COMPACT.miniGridCenterX;
  const cy = COMPACT.botCenterY;
  const sp = 6 * COMPACT.miniGridScale;
  const offsets: [number, number][] = [[-sp, -sp], [sp, -sp], [-sp, sp], [sp, sp]];
  offsets.forEach(([dx, dy], i) => {
    x.save();
    x.translate(cx + dx, cy + dy);
    const scale = alpha * COMPACT.miniGridScale;
    x.scale(scale, scale);
    x.fillStyle = MINI_COLORS[i];
    x.fill(puhuPath(4.6));
    x.restore();
  });
}

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * Runs the greeting animation on its own canvas. `onComplete` fires once at
 * T.end (or right after the collapse when interrupted) so the FSM can move on.
 */
export class Greeting {
  private startMs = 0;
  private tc = Number.POSITIVE_INFINITY;
  private fired = false;
  private timers: number[] = [];

  onComplete: (() => void) | null = null;

  start() {
    this.startMs = performance.now();
    this.tc = Number.POSITIVE_INFINITY;
    this.fired = false;
    this.cancelTimers();
    // The score plays from the start; it outlives greetComplete a little on
    // purpose and fades when the greeting view goes away (see leave()).
    Sound.play(GREETING_SOUND);
    this.timers.push(window.setTimeout(() => this.fire(), (T.end + 0.05) * 1000));
  }

  /** Mouse entered the island during the greeting — hold it open. */
  hover() {
    if (this.tc >= T.autoLeave) this.tc = Number.POSITIVE_INFINITY;
  }

  /** Mouse left — collapse from now. */
  interrupt() {
    const t = (performance.now() - this.startMs) / 1000;
    if (!Number.isFinite(this.tc) || this.tc > t) this.tc = t;
    this.cancelTimers();
    Sound.fadeOut(GREETING_SOUND, 0.25);
  }

  /** The greeting view is gone: let what is left of its sound fade away. */
  leave() {
    this.cancelTimers();
    Sound.fadeOut(GREETING_SOUND, 0.2);
  }

  get elapsed(): number {
    return (performance.now() - this.startMs) / 1000;
  }

  get done(): boolean {
    return this.fired;
  }

  private fire() {
    if (this.fired) return;
    this.fired = true;
    this.cancelTimers();
    this.onComplete?.();
  }

  private cancelTimers() {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers = [];
  }

  draw(x: CanvasRenderingContext2D) {
    const t = this.elapsed;
    if (!this.fired && t >= T.end && this.tc >= T.autoLeave) this.fire();

    const p = greetingPose(t, this.tc);
    x.clearRect(0, 0, GREETING_W, GREETING_H);

    if (p.card > 0) {
      x.save();
      x.globalAlpha = p.card;
      rr(x, CARD.x, CARD.y, CARD.w, CARD.h, CARD_R);
      x.fillStyle = "#141518";
      x.fill();
      x.restore();

      x.save();
      rr(x, CARD.x, CARD.y, CARD.w, CARD.h, CARD_R);
      x.clip();
      drawParticles(x, t, p);
      x.restore();
    } else if (Number.isFinite(this.tc) && t >= this.tc) {
      drawParticles(x, t, p);
    }

    drawMinis(x, p.minis);
    drawPuhu(x, p);
  }
}
