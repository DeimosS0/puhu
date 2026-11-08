// Mini Puhus (pills + compact grid).
// Each canvas owns a BotEngine; the island's frame loop ticks every live one.

import { BotEngine, hexToRGB } from "./engine";
import type { AgentTask } from "../core/state";

interface MiniBot {
  canvas: HTMLCanvasElement;
  engine: BotEngine;
  cssSize: number;
  taskId: string;
  /** Asked every frame: whether this one dances (the music pill's). */
  dancing?: () => boolean;
}

const live = new Map<HTMLCanvasElement, MiniBot>();

/**
 * Creates a mini Puhu whose **body** is `bodySize` CSS pixels across.
 *
 * The engine draws the body at 60 % of its canvas, so the canvas is
 * `bodySize / 0.6` and is centred in a `bodySize` slot, overflowing it.
 * Sizing the canvas itself to `bodySize` would shrink the
 * whole drawing to 60 %, which is what used to happen.
 */
export function createMiniBot(task: AgentTask, bodySize: number, dancing?: () => boolean): HTMLElement {
  const slot = document.createElement("span");
  slot.className = "mini";
  slot.style.width = `${bodySize}px`;
  slot.style.height = `${bodySize}px`;

  const canvas = document.createElement("canvas");
  const engineSize = bodySize / 0.6;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(engineSize * dpr);
  canvas.height = Math.round(engineSize * dpr);
  canvas.style.width = `${engineSize}px`;
  canvas.style.height = `${engineSize}px`;
  slot.append(canvas);

  const engine = new BotEngine();
  engine.isMini = true;
  engine.bodyColor = hexToRGB(task.color);
  engine.setState(task.state, true);
  if (task.emote) engine.setPermanentEmote(task.emote);
  if (task.miniEye) {
    engine.permanentEye = task.miniEye;
    engine.eyeOverride = task.miniEye;
    engine.eyeOverrideUntil = Number.POSITIVE_INFINITY;
  }

  live.set(canvas, { canvas, engine, cssSize: engineSize, taskId: task.id, dancing });
  return slot;
}

export function releaseMiniBot(canvas: HTMLCanvasElement) {
  live.delete(canvas);
}

/** Drops every canvas no longer in the document (views are rebuilt wholesale). */
export function pruneMiniBots() {
  for (const [canvas] of live) {
    if (!canvas.isConnected) live.delete(canvas);
  }
}

export function syncMiniBotStates(tasks: AgentTask[]) {
  for (const mb of live.values()) {
    const task = tasks.find((t) => t.id === mb.taskId);
    if (!task) continue;
    mb.engine.setState(task.state);
    mb.engine.bodyColor = hexToRGB(task.color);
  }
}

export function tickMiniBots(dt: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const mb of live.values()) {
    const ctx = mb.canvas.getContext("2d");
    if (!ctx) continue;
    mb.engine.setDancing(mb.dancing?.() ?? false);
    mb.engine.update(dt);
    // Sized at creation: the island may have moved to a monitor of another scale.
    const px = Math.round(mb.cssSize * dpr);
    if (mb.canvas.width !== px) {
      mb.canvas.width = px;
      mb.canvas.height = px;
    }
    // Cleared in device pixels: the canvas is a fraction of a CSS pixel short of its
    // rounded size (13 / 0.6 at 1.5 scale is 32.5 px of 33), and a clear in CSS pixels
    // left the last column and row behind, drawn over for good (lines round the grid).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mb.canvas.width, mb.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    mb.engine.applyDance(ctx, mb.cssSize, mb.cssSize);
    mb.engine.draw(ctx, mb.cssSize, mb.cssSize);
    ctx.restore();
  }
}

export const miniBotCount = () => live.size;
