// The desktop Puhu's own window (desktop.html): draws him, and turns clicks and
// drags on him into pokes, flights home, the wardrobe and a new spot.
//
// What he shows comes from the island (DESKTOP_EVENTS.state), where he is from
// Rust. The page draws only while the window is on screen, at 30 fps awake
// (60 while he moves) and 15 asleep — with no cursor polling at
// all while he sleeps.

import { Bridge, emitToWindow, onEvent, type DesktopMode } from "../core/bridge";
import type { BotEmoteName } from "../core/layout";
import { Sound } from "../core/sound";
import { Pace } from "../core/pace";
import { BotEngine, type Activity } from "../puhu/engine";
import { PUHU_COLORS, puhuColor } from "../puhu/puhu";
import { DesktopLife } from "./life";
import { dress, type Weather } from "../core/weather";
import {
  DESKTOP_EVENTS, DOUBLE_CLICK_MS, DRAG_THRESHOLD, FLIGHT_MS, PANEL_SIZE, agentActive, gaze,
  isOverBody, layerDragTopLeft, lookOrigin, pointerDistance, shouldSleep, windowDragTopLeft,
  type DesktopSnapshot, type Dock, type Point,
} from "../puhu/desktop-logic";

const ISLAND = "island";

/**
 * Width Puhu is drawn at. The engine's body radius is 0.3 × width, so this
 * gives the 28.8 px body the hit test uses, and leaves room around him for
 * hats, hands and hearts inside the 120 px window.
 */
const DRAW_W = PANEL_SIZE * 0.8;
const SIDE = (PANEL_SIZE - DRAW_W) / 2;
/** His body's width and its middle in the window, as the engine draws him (engine.draw). */
const BODY_W = DRAW_W * 0.6;
const BODY_CY = PANEL_SIZE / 2 + DRAW_W * 0.3 * 0.06;
/** The bottom of his body, and where his toes rest when he perches (desktop.rs PERCH_FEET). */
const BODY_BOTTOM = BODY_CY + DRAW_W * 0.3 * 0.88;
const PERCH_FEET = 90;
/** Nodding off before he sleeps (engine.doze). */
const DOZE_MS = 2400;
/** Frame pacing: 30 fps awake, 60 while he moves for real (his eyes on a moving
 *  cursor, a drag, a flight, a dance); asleep, 15, enough for his z's to drift (at 4
 *  they jumped). All a steady number of refreshes apart. */
const AWAKE_FRAME_MS = 1000 / 30;
const LIVELY_FRAME_MS = 1000 / 60;
const ASLEEP_FRAME_MS = 1000 / 15;

/** 0 → 1, eased in and out; clamped outside. */
function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

class DesktopPuhu {
  private engine = new BotEngine();
  private life = new DesktopLife(this.engine, { x: PANEL_SIZE / 2, y: BODY_CY });
  /** What the user is busy with (activity.rs): the prop he takes up. */
  private activity: Activity | null = null;
  /** The weather he dresses for, as the island hears it (core/weather.ts). */
  private weather: Weather | null = null;
  /** Nodding off until then; asleep for real after it. */
  private dozeUntil = 0;
  private nextFlap = 0;
  private canvas: HTMLCanvasElement;
  private mode: DesktopMode = "off";

  private snap: DesktopSnapshot = {
    state: "idle", soundEnabled: true, soundVolume: 0.12, paused: false, dancing: false,
  };

  private visible = false;
  private asleep = false;
  /** Whether the island has told us anything yet. */
  private informed = false;
  private lastAgentActive = performance.now();
  /** Pointer in window coordinates, and when the page last heard of it. */
  private cursor: Point | null = null;
  private lastPointer = -Infinity;

  /** Cancels the frame asked for, while one is. */
  private pending: (() => void) | null = null;
  private pace = new Pace();
  private lastDraw = 0;
  /** Where he sits in the island, from the island before each flight. */
  private dock: Dock | null = null;
  private flight: { kind: "out" | "home"; at: number } | null = null;

  /** Canvas offset inside the window: non-zero only in a layer-shell drag. */
  private offset: Point = { x: 0, y: 0 };
  private press: { client: Point; screen: Point } | null = null;
  private dragging = false;
  /** Window's top-left corner when the drag began (mode's space). */
  private dragOrigin: Point | null = null;
  private dragTopLeft: Point | null = null;
  private moveFrame = false;
  private pokeTimer: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const dpr = this.dpr();
    canvas.width = Math.round(PANEL_SIZE * dpr);
    canvas.height = Math.round(PANEL_SIZE * dpr);
    this.engine.particleOverhang = 0;
    this.engine.setState("idle", true);
    // Three pokes: dizzy, and the island shows the confused view.
    this.engine.onDizzy = () => void emitToWindow(ISLAND, DESKTOP_EVENTS.dizzy);
    this.wireInput();
  }

  async start() {
    void Sound.preload();
    const info = await Bridge.desktopInfo();
    if (info) this.mode = info.mode;

    await onEvent<DesktopSnapshot>(DESKTOP_EVENTS.state, (s) => this.onSnapshot(s));
    await onEvent<{ emote: BotEmoteName; duration: number }>(DESKTOP_EVENTS.emote, (e) => {
      this.lastAgentActive = performance.now();
      this.wake();
      this.engine.triggerEmote(e.emote, e.duration);
      this.schedule();
    });
    await onEvent<Point>(DESKTOP_EVENTS.cursor, (p) => this.notePointer(p, false));
    await onEvent<boolean>(DESKTOP_EVENTS.visible, (on) => this.setVisible(on));
    await onEvent<Dock>(DESKTOP_EVENTS.dock, (d) => (this.dock = d));
    await onEvent<Activity | null>("puhu-activity", (a) => {
      this.activity = a;
      this.schedule();
    });
    await onEvent<Weather | null>("weather", (w) => {
      this.weather = w;
      this.schedule();
    });
    void Bridge.weatherNow().then((w) => {
      if (w && !this.weather) this.weather = w;
    });
    await onEvent<boolean>(DESKTOP_EVENTS.perched, (on) => {
      this.life.perched = on;
      this.schedule();
    });
    await onEvent<string>(DESKTOP_EVENTS.flight, (kind) => {
      if (kind !== "out" && kind !== "home") return;
      // Out of the island he grows from his size there; home, he shrinks into it.
      this.flight = { kind, at: performance.now() };
      this.life.stopWalking();
      this.engine.flutter(FLIGHT_MS, 8);
      this.schedule();
    });
    await emitToWindow(ISLAND, DESKTOP_EVENTS.ready);
  }

  // ── State ───────────────────────────────────────────────────────────────────

  private onSnapshot(s: DesktopSnapshot) {
    this.snap = s;
    this.informed = true;
    Sound.setEnabled(s.soundEnabled);
    Sound.setVolume(s.soundVolume);
    if (agentActive(s.state)) this.lastAgentActive = performance.now();
    if (!this.asleep) this.engine.setState(s.state);
    this.updateSleep(performance.now());
    this.schedule();
  }

  private setVisible(on: boolean) {
    this.visible = on;
    if (on) {
      // The two pages may have started in either order: ask again if needed.
      if (!this.informed) void emitToWindow(ISLAND, DESKTOP_EVENTS.ready);
      // Landing counts as something going on: he looks around for a while.
      this.lastAgentActive = performance.now();
      this.asleep = false;
      this.engine.setState(this.snap.state, true);
      this.schedule();
      return;
    }
    this.cancelPoke();
    this.flight = null;
    // Shown again, the window must not show his last frame before the next one.
    this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.press = null;
    this.dragging = false;
    this.setOffset({ x: 0, y: 0 });
    this.pending?.();
    this.pending = null;
    Sound.idle();
  }

  private updateSleep(now: number) {
    if (!this.visible) return;
    // Dancing keeps him up: asleep he would bounce at a few frames a second.
    if (this.snap.dancing && !this.snap.paused) this.lastAgentActive = now;
    const distance = pointerDistance(this.mode === "poll", this.cursor, now - this.lastPointer);
    const sleep =
      !this.dragging &&
      (this.snap.paused || shouldSleep((now - this.lastAgentActive) / 1000, distance));
    if (sleep === this.asleep) return;
    this.asleep = sleep;
    this.life.stopWalking();
    // Paused he drops off at once; otherwise he nods off first (frame() puts him to sleep).
    if (sleep && !this.snap.paused) {
      this.dozeUntil = now + DOZE_MS;
      this.engine.doze();
    } else {
      if (!sleep && this.dozeUntil) this.engine.undoze();
      this.dozeUntil = 0;
      this.engine.setState(sleep ? "sleeping" : this.snap.state);
    }
    // Asleep, Rust stops the cursor poll; his whole little window then listens
    // for the pointer, and the first move over it wakes him.
    void Bridge.desktopSetAsleep(sleep);
    if (sleep) Sound.idle();
    this.schedule();
  }

  private wake() {
    if (!this.asleep) return;
    this.updateSleep(performance.now());
  }

  /**
   * Pointer in window coordinates: his eyes, and waking up. `fromPage`: the page's own
   * mouse events, else Rust's cursor poll (Windows). Over him on Windows both come, the
   * poll's a little behind: startles and petting read one of them only, or the lag
   * between the two looked like a jerk of the mouse and no stroke ever added up.
   */
  private notePointer(p: Point, fromPage: boolean) {
    this.cursor = p;
    this.lastPointer = performance.now();
    if (!this.asleep && !this.dragging && fromPage === (this.mode !== "poll")) this.life.pointer(p, this.lastPointer);
    if (this.asleep) this.wake();
    this.schedule();
  }

  // ── Frames ──────────────────────────────────────────────────────────────────

  private schedule() {
    if (this.pending || !this.visible) return;
    const now = performance.now();
    const lively = this.dragging || this.flight != null || now - this.lastPointer < 1000 || this.snap.dancing ||
      this.life.walking;
    // Nodding off is still awake.
    const pace = this.asleep && now >= this.dozeUntil ? ASLEEP_FRAME_MS : lively ? LIVELY_FRAME_MS : AWAKE_FRAME_MS;
    this.pending = this.pace.after(this.lastDraw, pace, (t) => {
      this.pending = null;
      this.frame(t);
    });
  }

  private frame(now: number) {
    if (!this.visible) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastDraw) / 1000));
    this.lastDraw = now;
    this.updateSleep(now);
    if (this.asleep && this.dozeUntil && now >= this.dozeUntil) {
      this.dozeUntil = 0;
      this.engine.setState("sleeping");
    }
    if (!this.asleep) {
      const busy = this.dragging || this.flight != null || this.snap.dancing || agentActive(this.snap.state);
      if (this.dragging || this.flight) this.life.stopWalking();
      this.life.tick(now, !busy);
      // Carried, his wings keep beating.
      if (this.dragging && now >= this.nextFlap) {
        this.nextFlap = now + 600;
        this.engine.flutter(750, 7);
      }
    }
    this.draw(dt, now);
    this.schedule();
  }

  private draw(dt: number, now: number) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const engine = this.engine;
    if (!this.asleep) {
      // Windows: the global cursor. Linux: only while the pointer is over him.
      const fresh = this.mode === "poll" || now - this.lastPointer < 1500;
      const g = this.cursor && fresh ? gaze(lookOrigin(0, 0), this.cursor) : { lookX: 0, lookY: 0 };
      engine.lookX = g.lookX;
      engine.lookY = g.lookY;
    }
    engine.setWeather(dress(this.weather, Date.now()));
    engine.setActivity(this.activity);
    // Dances while Spotify plays, by the compact island's rules.
    engine.setDancing(this.snap.dancing && !this.asleep);
    engine.update(dt);
    const dpr = this.dpr();
    // Dragged onto a monitor of another scale, the bitmap follows the ratio.
    if (this.canvas.width !== Math.round(PANEL_SIZE * dpr)) {
      this.canvas.width = Math.round(PANEL_SIZE * dpr);
      this.canvas.height = Math.round(PANEL_SIZE * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PANEL_SIZE, PANEL_SIZE);
    const inside = this.inside(now);
    ctx.save();
    const dock = this.dock;
    if (inside > 0 && dock) {
      // Towards his place and size in the island, about the middle of his body.
      const k = 1 + (dock.d / BODY_W - 1) * inside;
      ctx.translate(PANEL_SIZE / 2 + dock.dx * inside, BODY_CY + (dock.cy - BODY_CY) * inside);
      ctx.scale(k, k);
      ctx.translate(-PANEL_SIZE / 2, -BODY_CY);
    }
    const perched = this.life.perched && !this.flight && !this.dragging;
    if (perched || this.dragging) this.drawFeet(ctx, now, perched);
    ctx.translate(SIDE, 0);
    engine.applyDance(ctx, DRAW_W, PANEL_SIZE);
    engine.draw(ctx, DRAW_W, PANEL_SIZE);
    ctx.restore();
  }

  /**
   * His feet, under his body: perched, three toes each curled over the taskbar's edge, a step
   * lifting one as he walks; carried, hanging and swinging a little.
   */
  private drawFeet(ctx: CanvasRenderingContext2D, now: number, perched: boolean) {
    const { body, ink } = PUHU_COLORS[puhuColor()];
    const inkRgb = ink.match(/\d+/g)?.map(Number) ?? [26, 24, 30];
    const c = body.map((v, i) => Math.round(v * 255 * 0.55 + inkRgb[i] * 0.45));
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    const cx = PANEL_SIZE / 2 + this.engine.ox * DRAW_W * 0.3;
    const stride = this.engine.stride;
    for (const sd of [-1, 1]) {
      // Walking, the foot he is not rocked onto comes off the edge (engine.draw's rock).
      const lift = stride > 0.01 ? Math.max(0, Math.sin(this.engine.stridePhase + (sd > 0 ? Math.PI : 0))) * 3 * stride : 0;
      const swing = perched ? 0 : Math.sin(now / 1000 * 7 + sd) * 0.25;
      const x = cx + sd * 8.5;
      const y = (perched ? PERCH_FEET - 3 : BODY_BOTTOM - 1) - lift;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(swing);
      for (const toe of [-0.45, 0, 0.45]) {
        ctx.save();
        ctx.rotate(toe);
        ctx.beginPath();
        ctx.roundRect(-1.1, 0, 2.2, 5.5, 1.1);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  /**
   * In a flight, how far he is drawn into the island: 0 himself, 1 at his place and size
   * there. Out, he grows from there over most of the flight. Home, he shrinks into it from
   * early on, and is there by the time the island's Puhu fades in under him (HANDOFF_MS):
   * when the window goes, the island's is in his place. A cross-fade greyed them both.
   */
  private inside(now: number): number {
    const f = this.flight;
    if (!f) return 0;
    const u = (now - f.at) / FLIGHT_MS;
    if (f.kind === "out") {
      if (u >= 1) this.flight = null;
      return 1 - smooth(u / 0.75);
    }
    return smooth((u - 0.2) / 0.65);
  }

  private dpr(): number {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private local(e: MouseEvent): Point {
    return { x: e.clientX - this.offset.x, y: e.clientY - this.offset.y };
  }

  private wireInput() {
    document.addEventListener("pointerdown", (e) => {
      Sound.resume();
      if (e.button !== 0 || !isOverBody(this.local(e))) return;
      this.press = { client: this.local(e), screen: { x: e.screenX, y: e.screenY } };
      this.dragging = false;
      try {
        document.documentElement.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
    });

    document.addEventListener("pointermove", (e) => {
      if (!this.dragging) this.notePointer(this.local(e), true);
      const press = this.press;
      if (!press) return;
      if (!this.dragging) {
        const l = this.local(e);
        if (Math.hypot(l.x - press.client.x, l.y - press.client.y) <= DRAG_THRESHOLD) return;
        this.beginDrag();
      }
      this.dragTo(e);
    });

    document.addEventListener("pointerup", (e) => {
      const press = this.press;
      this.press = null;
      if (!press) return;
      if (this.dragging) {
        this.endDrag(e);
        return;
      }
      // Single click → poke, once it is clear it isn't a double click.
      this.cancelPoke();
      this.pokeTimer = window.setTimeout(() => {
        this.pokeTimer = null;
        this.lastAgentActive = performance.now();
        this.wake();
        this.engine.slap();
        this.schedule();
      }, DOUBLE_CLICK_MS);
    });

    document.addEventListener("dblclick", (e) => {
      if (!isOverBody(this.local(e))) return;
      this.cancelPoke();
      void emitToWindow(ISLAND, DESKTOP_EVENTS.home);
    });

    document.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (isOverBody(this.local(e))) void emitToWindow(ISLAND, DESKTOP_EVENTS.wardrobe);
    });

    document.addEventListener("pointerleave", () => {
      if (this.mode !== "poll" && !this.dragging) this.cursor = null;
    });

    // A layer-shell drag stretches the window over the display; once it is
    // back to its own size, so is the canvas.
    window.addEventListener("resize", () => {
      if (!this.dragging && window.innerWidth <= PANEL_SIZE + 20) this.setOffset({ x: 0, y: 0 });
    });
  }

  private cancelPoke() {
    if (this.pokeTimer != null) window.clearTimeout(this.pokeTimer);
    this.pokeTimer = null;
  }

  private beginDrag() {
    this.dragging = true;
    this.cancelPoke();
    this.dragOrigin = null;
    this.dragTopLeft = null;
    void Bridge.desktopDragBegin().then((pos) => {
      if (!pos) {
        this.dragging = false;
        this.press = null;
        return;
      }
      this.dragOrigin = { x: pos[0], y: pos[1] };
    });
  }

  /** Linux: the page drives the drag. Windows: the cursor poll carries him. */
  private dragTo(e: PointerEvent) {
    const origin = this.dragOrigin;
    const press = this.press;
    if (!origin || !press || this.mode === "poll") return;
    if (this.mode === "layer") {
      const applied = window.innerWidth > PANEL_SIZE + 20;
      const topLeft = layerDragTopLeft(origin, { x: e.clientX, y: e.clientY }, press.client, applied);
      this.dragTopLeft = topLeft;
      this.setOffset(applied ? topLeft : { x: topLeft.x - origin.x, y: topLeft.y - origin.y });
      return;
    }
    if (this.mode === "window") {
      const topLeft = windowDragTopLeft(origin, { x: e.screenX, y: e.screenY }, press.screen, this.dpr());
      this.dragTopLeft = topLeft;
      if (this.moveFrame) return;
      this.moveFrame = true;
      requestAnimationFrame(() => {
        this.moveFrame = false;
        const p = this.dragTopLeft;
        if (p && this.dragging) void Bridge.desktopDragMove(p.x, p.y);
      });
    }
  }

  private endDrag(e: PointerEvent) {
    this.dragTo(e);
    this.dragging = false;
    // Let go, he settles into his spot (desktop.rs SNAP_MS) and lands there.
    window.setTimeout(() => {
      this.engine.squash();
      this.engine.emit("feather", 2);
    }, 260);
    const topLeft = this.dragTopLeft;
    this.dragOrigin = null;
    this.dragTopLeft = null;
    if (this.mode === "poll" || !topLeft) return;
    void Bridge.desktopDragEnd(Math.round(topLeft.x), Math.round(topLeft.y));
  }

  private setOffset(p: Point) {
    this.offset = p;
    this.canvas.style.left = `${p.x}px`;
    this.canvas.style.top = `${p.y}px`;
  }
}

const canvas = document.getElementById("puhu");
if (canvas instanceof HTMLCanvasElement) {
  const puhu = new DesktopPuhu(canvas);
  void puhu.start();
  // The lab drives him over CDP, as main.ts does with the island.
  if (import.meta.env.DEV) Object.assign(window, { __desktop: puhu });
}
