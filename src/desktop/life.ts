// The desktop Puhu's life between the agents' work: a gesture now and then, a few steps
// along the taskbar when he perches on it, and the cursor's touch (a fast pass startles
// him, a slow stroke over him is petting). Only while he is awake: asleep, nothing here
// runs, and every gesture is a short burst the frame loop draws and then rests from.

import { Bridge } from "../core/bridge";
import type { BotEngine } from "../puhu/engine";
import { isOverBody, type Point } from "../puhu/desktop-logic";

/** Seconds between two gestures at rest. */
const GESTURE_S: [number, number] = [8, 18];
/** And between two walks along the taskbar. */
const WALK_S: [number, number] = [22, 45];
/** How far a walk goes (logical px), and how fast (px a second). */
const WALK_PX: [number, number] = [40, 100];
const WALK_SPEED = 55;
/** A pass this fast (px per ms) this close to him startles him, once in a while. */
const STARTLE_SPEED = 2.5;
const STARTLE_NEAR = 150;
const STARTLE_REST_MS = 6000;
/** Petting: this much slow stroking over his body (px), within this long. */
const PET_PX = 110;
const PET_WITHIN_MS = 2500;
const PET_SPEED = 1.5;

function between([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

export class DesktopLife {
  /** He stands on the taskbar's edge (desktop.rs `desktop-perched`). */
  perched = false;

  private nextGesture = 0;
  private nextWalk = 0;
  /** Which way the next walk goes: back the other way after one that could not go on. */
  private walkDir = Math.random() < 0.5 ? -1 : 1;
  private walk: { at: number; ms: number; dir: number } | null = null;

  private lastPoint: { p: Point; at: number } | null = null;
  private lastStartle = -Infinity;
  private stroke = { len: 0, since: 0 };
  private lastPet = -Infinity;

  private readonly engine: BotEngine;
  /** Window coordinates of the middle of his body. */
  private readonly centre: Point;

  constructor(engine: BotEngine, centre: Point) {
    this.engine = engine;
    this.centre = centre;
  }

  /** Walking along the taskbar right now. */
  get walking(): boolean {
    return this.walk != null;
  }

  /**
   * Each awake frame. `free`: nothing else has him (no flight, no drag, no agent at work,
   * no dance): only then does a gesture or a walk start.
   */
  tick(now: number, free: boolean) {
    const w = this.walk;
    if (w) {
      const p = (now - w.at) / w.ms;
      if (p < 1) {
        // A waddle that starts and ends standing.
        this.engine.stride = Math.min(1, Math.sin(Math.PI * p) * 1.8);
        this.engine.strideDir = w.dir;
        return;
      }
      this.stopWalking();
      this.engine.peer();
    }
    if (!this.nextGesture) this.nextGesture = now + between(GESTURE_S) * 1000;
    if (!this.nextWalk) this.nextWalk = now + between(WALK_S) * 1000;
    if (!free || this.engine.state !== "idle") return;
    if (this.perched && now >= this.nextWalk) {
      this.nextWalk = now + between(WALK_S) * 1000;
      this.nextGesture = Math.max(this.nextGesture, now + 4000);
      this.startWalk(now);
      return;
    }
    if (now < this.nextGesture) return;
    this.nextGesture = now + between(GESTURE_S) * 1000;
    const r = Math.random();
    if (r < 0.55) this.engine.fidget();
    else if (r < 0.78) this.engine.stretch();
    else this.engine.ruffle();
  }

  /** The pointer moved, window coordinates: startled by a fast pass, petted by a slow stroke. */
  pointer(p: Point, now: number) {
    const last = this.lastPoint;
    this.lastPoint = { p, at: now };
    if (!last || now - last.at > 200) return;
    const step = Math.hypot(p.x - last.p.x, p.y - last.p.y);
    // The poll reports every 16 ms at most: a shorter gap is the same move arriving late.
    const speed = step / Math.max(16, now - last.at);
    const over = isOverBody(p);

    const near = Math.hypot(p.x - this.centre.x, p.y - this.centre.y) < STARTLE_NEAR;
    if (!over && near && speed > STARTLE_SPEED && now - this.lastStartle > STARTLE_REST_MS) {
      this.lastStartle = now;
      this.engine.triggerEmote("surprised", 0.6);
      this.engine.squash();
    }

    if (!over || speed > PET_SPEED) {
      this.stroke = { len: 0, since: 0 };
      return;
    }
    if (!this.stroke.since || now - this.stroke.since > PET_WITHIN_MS) this.stroke = { len: 0, since: now };
    this.stroke.len += step;
    if (this.stroke.len >= PET_PX && now - this.lastPet > PET_WITHIN_MS) {
      this.lastPet = now;
      this.stroke = { len: 0, since: 0 };
      this.engine.petted(p.x < this.centre.x ? -1 : 1);
    }
  }

  /** A drag, a flight or sleep took over: no walk goes on under it. */
  stopWalking() {
    this.walk = null;
    this.engine.stride = 0;
  }

  private startWalk(now: number) {
    const dir = this.walkDir;
    const dx = between(WALK_PX) * dir;
    const ms = (Math.abs(dx) / WALK_SPEED) * 1000;
    this.walk = { at: now, ms, dir };
    void Bridge.desktopWalk(dx, ms).then((went) => {
      // At the end of the taskbar, or something took him: he turns round for the next one.
      if (went) return;
      this.walkDir = -dir;
      if (this.walk?.at === now) this.stopWalking();
    });
  }
}
