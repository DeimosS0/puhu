// The drop choreography: its timeline and layout, and Puhu on it. He follows
// the file with his eyes, raises his wings to catch it, hugs it, then flies it along
// the progress bar and lands with it at the choose card.
//
// The engine is pure arithmetic: it owns no DOM and draws nothing. It takes the
// cursor and a drop time, and hands `frame()` back everything the canvas needs
// for one frame. All coordinates are island points (the island is 640 × 176).

/** Constants. */
export const USC = {
  W: 640,
  ISL_H: 176,
  CARD_X: 10,
  CARD_Y: 42,
  CARD_W: 620,
  CARD_H: 124,
  CARD_R: 20,
  REST_X: 140,
  REST_Y: 104,
  D_BOX: 62,
  FOLLOW_MIN: 60, // CARD_X + 50
  FOLLOW_MAX: 580, // CARD_X + CARD_W - 50
  TEXT_X: 196,
  TEXT_Y: 94,
  BAR_X0: 46,
  BAR_X1: 520,
  BAR_Y: 118,
  CHOOSE_X: 60,
  CHOOSE_Y: 101,
  CHOOSE_D: 62,
  LOCK_IN: 60,
  LOCK_OUT: 90,
  /** His size while he flies the file along the bar, and how far above it. */
  FLY_D: 24,
  FLY_LIFT: 11,
  /** The file held in his wings, against him (of its full size). */
  HELD_SCALE: 0.42,
  // Phase timestamps, in seconds on the reference timeline (drop = 1.95).
  T_DROP: 1.95,
  T_SUCK_START: 2.03,
  T_SUCK_END: 2.33,
  T_CLOSE_END: 2.42,
  T_CHEW1: 2.6,
  T_CHEW_END: 2.88,
  T_SHRINK_END: 3.23,
  T_BAR_IN: 3.0,
  T_PROG_START: 3.25,
  DT: 1 / 240,
  /** Entry offset: gives 0.40 s of following before the drop. */
  ENTRY_T_REF: 1.95 - 0.4,
} as const;

// ── Easing ──────────────────────────────────────────────────────────────────

export const eOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const eIn = (t: number) => t * t * t;
export const eInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const eBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export const seg = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Squash and stretch of the catch, from the moment the file lands in his wings. */
function squeezeY(t: number): number {
  const t0 = USC.T_SUCK_END, t1 = t0 + 0.07, t2 = t0 + 0.2, t3 = USC.T_CHEW1;
  if (t <= t0) return 1.06;
  if (t <= t1) return lerp(1.06, 0.82, eOut(seg(t, t0, t1)));
  if (t <= t2) return lerp(0.82, 1.1, eOut(seg(t, t1, t2)));
  if (t <= t3) return lerp(1.1, 1.0, eInOut(seg(t, t2, t3)));
  return 1.0;
}

function squeezeX(t: number): number {
  const t0 = USC.T_SUCK_END, t1 = t0 + 0.07, t2 = t0 + 0.2, t3 = USC.T_CHEW1;
  if (t <= t0) return 0.97;
  if (t <= t1) return lerp(0.97, 1.14, eOut(seg(t, t0, t1)));
  if (t <= t2) return lerp(1.14, 0.95, eOut(seg(t, t1, t2)));
  if (t <= t3) return lerp(0.95, 1.0, eInOut(seg(t, t2, t3)));
  return 1.0;
}

/**
 * Progress curve of the upload bar: quick to 60 %, an unhurried middle, then a
 * last push. A plain ease-out reads as a different animation entirely.
 */
export function uploadProgressCurve(u: number): number {
  if (u < 0.4) return 0.6 * eOut(u / 0.4);
  if (u < 0.85) return 0.6 + 0.32 * eInOut((u - 0.4) / 0.45);
  return 0.92 + 0.08 * eIn((u - 0.85) / 0.15);
}

export function progressAt(t: number, progStart: number, progEnd: number): number {
  return t < progStart ? 0 : uploadProgressCurve(seg(t, progStart, progEnd));
}

/** His top speed following a file across the card, in points a second. */
const MAX_FOLLOW_SPEED = 900;
/**
 * Teasing: the file's travel back and forth, in units of TEASE_PX, fading over
 * TEASE_FADE_S. Past SULK_AT (swung across the island a few times in quick
 * succession) he sulks; once it has faded below FORGIVE_AT he looks back.
 */
const TEASE_PX = 600;
const TEASE_FADE_S = 1.4;
const SULK_AT = 2.6;
const FORGIVE_AT = 0.35;

// ── Spring ──────────────────────────────────────────────────────────────────

/** The reference `spring(s, target, response, damping, dt)`, integrated by hand. */
class USSpring {
  vel = 0;
  constructor(public v: number) {}

  step(target: number, response: number, damping: number, dt: number) {
    const k = Math.pow((2 * Math.PI) / response, 2);
    const c = 2 * damping * Math.sqrt(k);
    const a = k * (target - this.v) - c * this.vel;
    this.vel += a * dt;
    this.v += this.vel * dt;
  }
}

// ── Frame ───────────────────────────────────────────────────────────────────

/** "sulk": lids half down, the look of an owl who has had enough. */
export type UploadEyeShape = "pill" | "cup" | "content" | "sulk";

/** The file: where it is, how big (of its full size), and whether he holds it. */
export interface UploadFile {
  x: number;
  y: number;
  s: number;
  held: boolean;
}

export interface UploadFrame {
  t: number;
  cursorX: number;
  cursorY: number;
  x: number;
  y: number;
  d: number;
  sx: number;
  sy: number;
  tilt: number;
  hop: number;
  /** His wings raised wide open to catch, 0 (at his sides) to 1. */
  wingsUp: number;
  /** His wings wrapped round the file in front of him, 0 to 1. */
  hug: number;
  /** Flying: where his wingbeat is (radians), or null while he is not. */
  beat: number | null;
  /** Tufts: 1 at rest, higher when he is excited. */
  tuft: number;
  eye: UploadEyeShape;
  lookX: number;
  lookY: number;
  file: UploadFile;
  /** Seconds since he caught the file (a few feathers fly), or -1. */
  caughtFor: number;
  /**
   * Sulking, 0 to 1: teased with the file swung back and forth, he turns his head away
   * and stops chasing it, until it calms down or is let go (then he catches it all the same).
   */
  sulk: number;
  zoneOver: boolean;
  zoneAlpha: number;
  textAlpha: number;
  barReveal: number;
  barAlpha: number;
  progress: number;
  flash: number;
  check: number;
  greenWash: number;
  chooseAlpha: number;
  progEnd: number;
  growStart: number;
  growEnd: number;
}

function restFrame(): UploadFrame {
  return {
    t: 0,
    cursorX: 600,
    cursorY: 280,
    x: USC.REST_X,
    y: USC.REST_Y,
    d: USC.D_BOX,
    sx: 1,
    sy: 1,
    tilt: 0,
    hop: 0,
    wingsUp: 0,
    hug: 0,
    beat: null,
    tuft: 1,
    eye: "pill",
    lookX: 0,
    lookY: 0,
    file: { x: 600, y: 294, s: 1, held: false },
    caughtFor: -1,
    sulk: 0,
    zoneOver: false,
    zoneAlpha: 1,
    textAlpha: 1,
    barReveal: 0,
    barAlpha: 0,
    progress: 0,
    flash: 0,
    check: 0,
    greenWash: 0,
    chooseAlpha: 0,
    progEnd: USC.T_PROG_START + 2.4,
    growStart: USC.T_PROG_START + 2.4 + 0.25,
    growEnd: USC.T_PROG_START + 2.4 + 0.7,
  };
}

// ── Engine ──────────────────────────────────────────────────────────────────

class UploadSequence {
  uploadDuration = 2.4;

  get progEnd() {
    return USC.T_PROG_START + this.uploadDuration;
  }
  get growStart() {
    return this.progEnd + 0.25;
  }
  get growEnd() {
    return this.progEnd + 0.7;
  }

  isActive = false;

  cursorX = 600;
  cursorY = 280;

  private entryWall = 0;
  private dropWall: number | null = null;

  private t = 0;
  private bx = new USSpring(USC.REST_X);
  /** Where he heads along the card: the file's x while it is over the card. */
  private followX: number = USC.REST_X;
  private by = new USSpring(USC.REST_Y);
  private tilt = 0;
  /** His wings rising as the file comes near, on a spring. */
  private wings = new USSpring(0);
  /** How much the file has been swung about lately (it fades), and his sulk on a spring. */
  private tease = 0;
  private sulky = false;
  private sulk = new USSpring(0);
  private locked = false;
  private lockAt = -9;
  private entered = -9;

  private prevX = 600;
  private prevY = 280;
  private prevT = 0;
  private speed = 0;

  private now(): number {
    return performance.now() / 1000;
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  /** A file entered the island. Coordinates are island points. */
  enterZone(x: number, y: number) {
    const now = this.now();
    this.cursorX = x;
    this.cursorY = y;
    this.prevX = x;
    this.prevY = y;
    this.prevT = now;
    this.speed = 0;
    // Back in before letting go: he carries on from where he is, no jump back to his place.
    if (this.isActive && this.dropWall == null) {
      this.locked = false;
      return;
    }

    this.t = USC.ENTRY_T_REF;
    this.entered = USC.ENTRY_T_REF;
    this.bx = new USSpring(USC.REST_X);
    this.by = new USSpring(USC.REST_Y);
    this.followX = USC.REST_X;
    this.tilt = 0;
    this.wings = new USSpring(0);
    this.tease = 0;
    this.sulky = false;
    this.sulk = new USSpring(0);
    this.locked = false;
    this.lockAt = -9;

    this.entryWall = now;
    this.dropWall = null;
    this.isActive = true;
  }

  updateCursor(x: number, y: number) {
    const now = this.now();
    const dt = now - this.prevT;
    if (dt > 0.001) {
      this.speed = Math.hypot(x - this.prevX, y - this.prevY) / dt;
    }
    // Every point the file travels across him teases him a little.
    if (this.dropWall == null) this.tease += Math.abs(x - this.prevX) / TEASE_PX;
    this.prevX = x;
    this.prevY = y;
    this.prevT = now;
    this.cursorX = x;
    this.cursorY = y;
  }

  /** The island stays open per the spec, so leaving the zone changes nothing. */
  exitZone() {}

  performDrop(uploadDuration: number) {
    this.uploadDuration = uploadDuration;
    // Given the file at last, he forgets the teasing and catches it.
    this.sulky = false;
    this.tease = 0;
    this.dropWall = this.now();
    // Restart the canonical post-drop timeline however long the user hovered.
    // Spring state (position and velocity) is deliberately preserved.
    this.t = USC.T_DROP;
  }

  deactivate() {
    this.isActive = false;
    this.dropWall = null;
  }

  // ── Reference time from the wall clock ────────────────────────────────────

  private tRef(): number {
    if (!this.isActive) return 0;
    const now = this.now();
    if (this.dropWall != null) return USC.T_DROP + Math.max(0, now - this.dropWall);
    // No cap: the springs keep stepping as long as the user hovers. computeFrame
    // clamps every phase-sensitive output back to the pre-drop state.
    return USC.ENTRY_T_REF + Math.max(0, now - this.entryWall);
  }

  /** True once the file has been dropped (the post-drop timeline is running). */
  get dropped(): boolean {
    return this.dropWall != null;
  }

  /** Seconds since the drop, or null while still dragging. */
  sinceDrop(): number | null {
    return this.dropWall == null ? null : this.now() - this.dropWall;
  }

  // ── Public entry point ────────────────────────────────────────────────────

  frame(): UploadFrame {
    if (!this.isActive) return restFrame();
    const t = this.tRef();
    this.simulateTo(t);
    return this.computeFrame(t);
  }

  // ── Simulation ────────────────────────────────────────────────────────────

  private simulateTo(target: number) {
    // A long stall (a background tab, a dragged window) must not spin here.
    if (target - this.t > 2) this.t = target - 2;
    while (this.t < target - 1e-10) {
      const dt = Math.min(USC.DT, target - this.t);
      this.stepOnce(dt);
      this.t += dt;
    }
  }

  private stepOnce(dt: number) {
    const isDragging = this.dropWall == null;

    // Horizontal follow and lock, only while dragging inside the zone.
    if (isDragging && this.entered >= 0) {
      const dist = Math.hypot(this.cursorX - this.bx.v, this.cursorY + 14 - this.by.v);
      if (!this.locked && dist < USC.LOCK_IN && this.speed < 180) {
        this.locked = true;
        this.lockAt = this.t;
      }
      if (this.locked && dist > USC.LOCK_OUT) this.locked = false;
      // Swung about too much, he sulks; calm again, he lets it go.
      this.tease *= Math.exp(-dt / TEASE_FADE_S);
      if (!this.sulky && this.tease > SULK_AT) this.sulky = true;
      if (this.sulky && this.tease < FORGIVE_AT) this.sulky = false;
      if (this.sulky) this.locked = false;
      // He follows the file over the card only (and not while he sulks): the pointer
      // running off past its edge leaves him where he is instead of sending him across.
      const over = this.cursorX >= USC.CARD_X && this.cursorX <= USC.CARD_X + USC.CARD_W && this.cursorY <= USC.ISL_H + 20;
      if (over && !this.sulky) this.followX = Math.max(USC.FOLLOW_MIN, Math.min(USC.FOLLOW_MAX, this.cursorX));
      const response = this.locked ? 0.26 : 0.42;
      const damping = this.locked ? 0.82 : 0.78;
      this.bx.step(this.followX, response, damping, dt);
      this.by.step(USC.REST_Y, response, damping, dt);
      // A quick swipe makes him hurry, not jump: never faster than this across the card.
      this.bx.vel = Math.max(-MAX_FOLLOW_SPEED, Math.min(MAX_FOLLOW_SPEED, this.bx.vel));
    }

    // Tilt follows how fast he is sliding.
    const tiltTarget = isDragging ? Math.max(-0.18, Math.min(0.18, this.bx.vel * 0.0015)) : 0;
    this.tilt = lerp(this.tilt, tiltTarget, 1 - Math.pow(0.0005, dt));

    // Wings: half up as a file comes in, wide open once it is right above him or let go,
    // folded while he sulks.
    if (isDragging || this.t < USC.T_SUCK_END) {
      const target = this.entered >= 0 && !this.sulky ? (this.locked || !isDragging ? 1 : 0.45) : 0;
      this.wings.step(target, 0.22, 0.55, dt);
    }
    this.sulk.step(this.sulky && isDragging ? 1 : 0, 0.35, 0.7, dt);
  }

  // ── Frame computation ─────────────────────────────────────────────────────

  private computeFrame(t: number): UploadFrame {
    const f = restFrame();
    f.t = t;
    f.cursorX = this.cursorX;
    f.cursorY = this.cursorY;
    const progEnd = this.progEnd;
    const growStart = this.growStart;
    const growEnd = this.growEnd;
    f.progEnd = progEnd;
    f.growStart = growStart;
    f.growEnd = growEnd;

    const isDragging = this.dropWall == null;
    // Clamp the phase clock to just before the drop while still dragging, so a
    // long hover never trips the post-drop visuals.
    const pt = isDragging ? Math.min(t, USC.T_DROP - USC.DT) : t;

    // Where he is, and how big: at rest beside the drop text, then small and flying
    // the file along the bar, then back at the choose card.
    let x = this.bx.v;
    let y = this.by.v;
    let d: number = USC.D_BOX;
    const flyY = USC.BAR_Y - USC.FLY_LIFT;
    if (pt >= USC.T_CHEW_END && pt < USC.T_PROG_START) {
      const k = eInOut(seg(pt, USC.T_CHEW_END, USC.T_SHRINK_END));
      x = lerp(this.bx.v, USC.BAR_X0, k);
      y = lerp(this.by.v, flyY, k);
      d = lerp(USC.D_BOX, USC.FLY_D, k);
    }
    if (pt >= USC.T_PROG_START) {
      const p = progressAt(pt, USC.T_PROG_START, progEnd);
      x = lerp(USC.BAR_X0, USC.BAR_X1, p);
      // A soft rise and fall with his wingbeats.
      y = flyY + 1.5 * Math.sin(pt * 2 * Math.PI * 3.5);
      d = USC.FLY_D;
    }
    if (pt >= progEnd) {
      x = USC.BAR_X1;
      y = flyY - 8 * Math.sin(Math.PI * seg(pt, progEnd, progEnd + 0.2));
    }
    if (pt >= growStart) {
      const k = eInOut(seg(pt, growStart, growEnd));
      x = lerp(USC.BAR_X1, USC.CHOOSE_X, k);
      y = lerp(flyY, USC.CHOOSE_Y, k);
      d = lerp(USC.FLY_D, USC.CHOOSE_D, eBack(seg(pt, growStart, growEnd)));
    }
    f.x = x;
    f.y = y;
    f.d = d;

    // Squash and stretch: a crouch as the file is let go, reaching up for it, the
    // catch, stretched on take-off, a little bounce as he lands at the card.
    let sx = 1;
    let sy = 1;
    if (pt >= USC.T_DROP && pt < USC.T_SUCK_START) {
      const k = eOut(seg(pt, USC.T_DROP, USC.T_SUCK_START));
      sy = lerp(1, 0.92, k);
      sx = lerp(1, 1.06, k);
    }
    if (pt >= USC.T_SUCK_START && pt < USC.T_SUCK_END) {
      const k = eInOut(seg(pt, USC.T_SUCK_START, USC.T_SUCK_END));
      sy = lerp(0.92, 1.06, k);
      sx = lerp(1.06, 0.97, k);
    }
    if (pt >= USC.T_SUCK_END && pt < USC.T_CHEW1) {
      sy = squeezeY(pt);
      sx = squeezeX(pt);
    }
    if (pt >= USC.T_CHEW_END && pt < USC.T_SHRINK_END) {
      const k = seg(pt, USC.T_CHEW_END, USC.T_SHRINK_END);
      sy = 1 + 0.12 * Math.sin(Math.PI * k);
      sx = 1 - 0.06 * Math.sin(Math.PI * k);
    }
    if (pt >= growStart && pt < growEnd) {
      sy = 1 + 0.06 * Math.sin(Math.PI * seg(pt, growStart, growEnd));
    }
    f.sx = sx;
    f.sy = sy;

    // Holding it, he sways from side to side; flying, he leans into the way he goes.
    let lean = 0;
    if (pt >= USC.T_PROG_START && pt < progEnd) {
      const v =
        (progressAt(pt + 0.01, USC.T_PROG_START, progEnd) -
          progressAt(pt, USC.T_PROG_START, progEnd)) / 0.01;
      lean = Math.max(0, Math.min(1, v * 0.18));
    }
    const hugging = pt >= USC.T_CLOSE_END && pt < USC.T_CHEW_END;
    const sway = hugging ? 0.09 * Math.sin((2 * Math.PI * (pt - USC.T_CLOSE_END)) / 0.46) : 0;
    f.tilt = this.tilt + sway + 0.14 * lean;
    f.hop =
      this.lockAt > 0 && isDragging
        ? -5 * Math.sin(Math.PI * seg(pt, this.lockAt, this.lockAt + 0.15))
        : 0;

    // Wings: up to catch, wrapped round the file once caught, beating while he flies,
    // round it again as he lands.
    const caught = !isDragging && pt >= USC.T_SUCK_END;
    const hugIn = eOut(seg(pt, USC.T_SUCK_END, USC.T_CLOSE_END + 0.06));
    const hugOut = seg(pt, USC.T_SHRINK_END - 0.15, USC.T_SHRINK_END);
    const hugBack = eOut(seg(pt, growStart + 0.1, growEnd));
    f.hug = caught ? Math.max(hugIn * (1 - hugOut), 0.7 * hugBack) : 0;
    f.wingsUp = caught ? 0 : Math.max(0, this.wings.v);
    const flying = caught && pt >= USC.T_SHRINK_END - 0.15 && pt < progEnd + 0.25;
    f.beat = flying ? 2 * Math.PI * 7 * pt : null;
    f.tuft = caught ? (pt < USC.T_CHEW_END || pt >= growEnd ? 1.25 : 1.1) : 1 + 0.3 * f.wingsUp;

    // Eyes.
    let eye: UploadEyeShape = "pill";
    if (this.locked && pt < USC.T_SUCK_END) eye = "cup";
    if (pt >= USC.T_SUCK_END && pt < USC.T_CHEW_END + 0.1) eye = "content";
    if (pt >= progEnd && pt < growEnd + 0.3) eye = "content";
    f.eye = eye;

    const lkx = pt < USC.T_SUCK_END ? this.cursorX - x : pt < USC.T_PROG_START ? 0 : 40;
    const lky = pt < USC.T_SUCK_END ? this.cursorY + 10 - y : 0;
    f.lookX = Math.max(-1, Math.min(1, lkx / 200));
    f.lookY = Math.max(-1, Math.min(1, lky / 150));

    // Sulking: head turned from the file, tufts down, lids half closed.
    const sulk = isDragging ? Math.max(0, Math.min(1, this.sulk.v)) : 0;
    f.sulk = sulk;
    if (sulk > 0.01) {
      const away = this.cursorX >= x ? -1 : 1;
      f.lookX = lerp(f.lookX, 0.8 * away, sulk);
      f.lookY = lerp(f.lookY, 0.15, sulk);
      f.tuft = lerp(f.tuft, 0.7, sulk);
      f.tilt += 0.08 * away * sulk;
      if (sulk > 0.5) f.eye = "sulk";
    }

    // The file: under the pointer, then falling into his open wings (drifting across
    // first, dropping faster), against him while he holds it, hanging under him as he
    // flies, and against him again at the card.
    const R = d / 2 / 1.04;
    const chestY = y + f.hop + R * 0.22 * sy;
    if (!caught) {
      const k = seg(pt, USC.T_DROP, USC.T_SUCK_END);
      const fromX = this.cursorX;
      const fromY = this.cursorY + 14;
      f.file = isDragging
        ? { x: fromX, y: fromY, s: 1, held: false }
        : { x: lerp(fromX, x, eOut(k)), y: lerp(fromY, chestY, eIn(k)), s: lerp(1, USC.HELD_SCALE, eInOut(k)), held: false };
    } else if (flying && pt >= USC.T_SHRINK_END - 0.15 && pt < growStart) {
      f.file = { x, y: y + R * 1.05, s: 0.3, held: true };
    } else {
      f.file = { x, y: chestY, s: USC.HELD_SCALE * (d / USC.D_BOX), held: true };
    }
    f.caughtFor = caught ? pt - USC.T_SUCK_END : -1;

    // Content alphas.
    f.zoneOver = this.entered >= 0 && pt < USC.T_CHEW_END;
    f.zoneAlpha = 1 - seg(pt, USC.T_CHEW_END, USC.T_CHEW_END + 0.2);
    // The text gives way as he comes over it, gradually rather than all at once.
    f.textAlpha = f.zoneAlpha * (isDragging ? 1 - 0.75 * seg(x, USC.TEXT_X - 90, USC.TEXT_X - 30) : 1);
    f.barReveal =
      eOut(seg(pt, USC.T_BAR_IN, USC.T_BAR_IN + 0.25)) * (1 - seg(pt, growStart, growStart + 0.2));
    f.barAlpha =
      seg(pt, USC.T_BAR_IN + 0.05, USC.T_BAR_IN + 0.25) * (1 - seg(pt, growStart, growStart + 0.2));
    f.progress = progressAt(pt, USC.T_PROG_START, progEnd);
    f.flash = pt >= progEnd ? Math.sin(Math.PI * seg(pt, progEnd, progEnd + 0.3)) : 0;
    f.check = pt >= progEnd ? eBack(seg(pt, progEnd, progEnd + 0.25)) : 0;

    const hoverGreen = f.zoneOver ? 0.22 : 0;
    let uploadGreen = 0;
    if (pt >= USC.T_PROG_START) {
      const baseGreen = f.progress * 0.5;
      const flashExtra = pt >= progEnd ? 0.2 * Math.sin(Math.PI * seg(pt, progEnd, progEnd + 0.4)) : 0;
      const fadeOut = 1 - seg(pt, growEnd, growEnd + 0.6);
      uploadGreen = (baseGreen + flashExtra) * fadeOut;
    }
    f.greenWash = Math.max(hoverGreen, uploadGreen);
    f.chooseAlpha = seg(pt, growStart + 0.15, growEnd);

    return f;
  }
}

export const UploadSeq = new UploadSequence();
