// The upload canvas, with Puhu in it.
//
// While the sequence engine is active this canvas draws the whole island body:
// card, dashed drop frame, drop text, progress bar, the choose card, Puhu and the
// file he catches. The island's own Puhu is hidden for the duration, because this
// canvas draws its own. The choose card's buttons are real ones over it: what they
// offer depends on the files (a PDF from photos or a document; island/convert.ts).

import { State } from "../core/state";
import { PUHU_EYE_P, PUHU_EYE_SCALE, PUHU_EYE_SP, PUHU_RX, PUHU_RY, puhuCss, puhuPoint } from "../puhu/puhu";
import { SCRIPT_FONTS } from "../core/fonts";
import { N_, isRtl, language, t, tl } from "../i18n/i18n";
import { USC, lerp, progressAt, type UploadEyeShape, type UploadFile, type UploadFrame } from "./sequence";
import { offers, onePicture, type ConvertKind } from "../island/convert";
import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { PHONE_ICON } from "../views/phone";

const FONT = `system-ui, "Segoe UI Variable Text", "Segoe UI", ${SCRIPT_FONTS}, sans-serif`;

/** The card's inner right edge: no text runs past it. */
const TEXT_RIGHT = USC.CARD_X + USC.CARD_W - 16;
/** Where the choose card's row of buttons starts. */
const BUTTONS = { x: 114, y: 113 };
/** The row's room before the card's right edge: wider, Ask keeps only its bubble. */
const ROW_MAX = USC.CARD_X + USC.CARD_W - BUTTONS.x - 18;
/** What the dropped files can be made into, as the buttons say it. */
const MAKE: Record<ConvertKind, string> = {
  pdf: N_("Make a PDF"),
  small: N_("Make it smaller"),
  jpg: N_("Make a JPG"),
};
/** Drop-zone chips (English keys, shown with `t()`). */
const CHIPS = [N_("PDF"), N_("Images"), N_("Code"), N_("Docs")];

/** Mirrors the reference `rr()`: a rounded rect, radius clamped to the box. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
}

/** Puhu's outline for a body `R`: tufts raised by `tuft`, leaning with `lean`, turned by `turn`. */
function bodyPath(ctx: CanvasRenderingContext2D, R: number, tuft: number, lean: number, turn: number) {
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const { x, y } = puhuPoint((i / 96) * Math.PI * 2, R, tuft, lean, turn);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "left",
) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  // Arabic orders its words right to left; the anchor (left, centre, right) stays put.
  ctx.direction = isRtl() ? "rtl" : "ltr";
  // The anchors are vertically centred.
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
}

/**
 * The font that fits `s` in `maxW`: `weight size FONT`, or smaller down to
 * `minSize` for a longer translation. English was laid out for these widths
 * and keeps its size (only an overlong file name can make it shrink).
 */
export function fitFont(
  ctx: CanvasRenderingContext2D,
  s: string,
  maxW: number,
  weight: number,
  size: number,
  minSize = size * 0.75,
): string {
  let px = size;
  ctx.font = `${weight} ${px}px ${FONT}`;
  while (ctx.measureText(s).width > maxW && px > minSize) {
    px = Math.max(minSize, px - 0.5);
    ctx.font = `${weight} ${px}px ${FONT}`;
  }
  return ctx.font;
}

/** `s` cut with an ellipsis so it fits `maxW` in `font` (a file name that is too long). */
export function ellipsize(ctx: CanvasRenderingContext2D, s: string, maxW: number, font: string): string {
  ctx.font = font;
  if (ctx.measureText(s).width <= maxW) return s;
  let cut = s;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** A label that fits `maxW`: a smaller font first, then an ellipsis. */
function fitted(ctx: CanvasRenderingContext2D, s: string, maxW: number, weight: number, size: number) {
  const font = fitFont(ctx, s, maxW, weight, size);
  return { font, s: ellipsize(ctx, s, maxW, font) };
}

export interface UploadCanvasActions {
  /** Primary button — hand the file to the chat. */
  ask(): void;
  /** Secondary button. */
  cancel(): void;
  /** The dropped files made into a PDF, a smaller picture or a JPG. */
  convert(kind: ConvertKind): void;
  /** The dropped files sent to a phone (island/phone.ts). */
  phoneSend(): void;
  /** Copy text on the one picture dropped: it opens in the screenshot viewer, read. */
  pictureText(): void;
  /** What the island's Puhu wears, drawn on this one at his middle (BotEngine.drawWorn). */
  dress(ctx: CanvasRenderingContext2D, R: number, turn: number, layer: "behind" | "front", pitch: number): void;
}

export class UploadCanvas {
  /** Wrapper holding the canvas and the choose card's buttons. */
  readonly el: HTMLElement;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private overlay: HTMLElement;
  private sizedFor = 0;
  private readonly row: HTMLElement;
  private readonly ask: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly close: HTMLButtonElement;
  /** Beside the corner's ×: the dropped files to a phone. */
  private readonly toPhone: HTMLButtonElement;
  /** The files the buttons were made for. */
  private buttonsFor = "";

  constructor(private readonly actions: UploadCanvasActions) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "upload-canvas";

    this.ask = h(
      "button",
      { class: "btn primary upload-btn upload-ask", title: tl("Ask a question about it"), onclick: () => actions.ask() },
      svg(ICONS.bubbleRound, 14),
      h("span", { text: tl("Ask a question about it") }),
    ) as HTMLButtonElement;
    this.cancel = h("button", { class: "btn secondary upload-btn", text: tl("Cancel"), onclick: () => actions.cancel() });
    // With something to make, Cancel steps aside to the card's corner and leaves the row to it.
    this.close = h("button", { class: "card-x upload-x", title: tl("Cancel"), onclick: () => actions.cancel() }, svg(ICONS.xmark, 10));
    this.row = h("div", { class: "upload-row" }, this.ask, this.cancel);
    this.row.style.left = `${BUTTONS.x}px`;
    this.row.style.top = `${BUTTONS.y}px`;
    this.toPhone = h("button", { class: "btn secondary upload-btn upload-phone", onclick: () => actions.phoneSend() },
      svg(PHONE_ICON, 13, { stroke: 1.8 }), h("span", { text: tl("Send to phone") })) as HTMLButtonElement;
    this.overlay = document.createElement("div");
    this.overlay.id = "upload-overlay";
    this.overlay.append(this.row, this.toPhone, this.close);

    this.el = document.createElement("div");
    this.el.id = "upload-layer";
    this.el.append(this.canvas, this.overlay);

    this.ctx = this.canvas.getContext("2d");
  }

  /** `wallTime` in seconds drives the marching dashes. */
  draw(f: UploadFrame, wallTime: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.sizedFor !== dpr) {
      this.sizedFor = dpr;
      this.canvas.width = Math.round(USC.W * dpr);
      this.canvas.height = Math.round(USC.ISL_H * dpr);
      this.canvas.style.width = `${USC.W}px`;
      this.canvas.style.height = `${USC.ISL_H}px`;
    }
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, USC.W, USC.ISL_H);

    this.drawScene(ctx, f, wallTime);

    // The buttons come in with the choose card, and take clicks once it is mostly there.
    this.overlay.style.display = f.chooseAlpha > 0.01 ? "block" : "none";
    if (f.chooseAlpha > 0.01) {
      this.syncButtons();
      this.overlay.style.opacity = String(f.chooseAlpha);
      this.overlay.style.transform = `translateY(${(1 - f.chooseAlpha) * 4}px)`;
      this.overlay.style.pointerEvents = f.chooseAlpha > 0.5 ? "" : "none";
    }
  }

  /** The row for the files dropped: what they can be made into first, then the question. */
  private syncButtons() {
    const paths = State.droppedPaths;
    const kinds = offers(paths);
    const picture = onePicture(paths);
    const key = `${kinds.join()}|${paths.length}|${picture}|${language()}`;
    if (key === this.buttonsFor) return;
    this.buttonsFor = key;
    const makes = kinds.map((kind, i) =>
      h("button", { class: `btn ${i === 0 ? "primary" : "secondary"} upload-btn`, text: tl(MAKE[kind]), onclick: () => this.actions.convert(kind) }),
    );
    if (picture) makes.push(h("button", { class: "btn secondary upload-btn", text: tl("Copy text"), onclick: () => this.actions.pictureText() }));
    this.ask.classList.toggle("primary", makes.length === 0);
    this.ask.classList.toggle("secondary", makes.length > 0);
    this.row.replaceChildren(...makes, this.ask, ...(makes.length ? [] : [this.cancel]));
    this.close.hidden = makes.length === 0;
    // Where a language's words leave the row no room, Ask keeps only its bubble.
    this.row.classList.remove("tight");
    this.row.classList.toggle("tight", this.row.offsetWidth > ROW_MAX);
  }

  // ── Scene ─────────────────────────────────────────────────────────────────

  private drawScene(ctx: CanvasRenderingContext2D, f: UploadFrame, wallTime: number) {
    // Island background.
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, USC.W, USC.ISL_H);

    // Card.
    ctx.save();
    rr(ctx, USC.CARD_X, USC.CARD_Y, USC.CARD_W, USC.CARD_H, USC.CARD_R);
    ctx.clip();
    ctx.fillStyle = "#0D0E10";
    ctx.fillRect(USC.CARD_X, USC.CARD_Y, USC.CARD_W, USC.CARD_H);

    // Green glow, fanning up from the bottom edge of the card.
    if (f.greenWash > 0) {
      const gx = USC.CARD_X + USC.CARD_W / 2;
      const gy = USC.CARD_Y + USC.CARD_H;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, USC.CARD_H * 1.5);
      g.addColorStop(0, `rgba(40,212,130,${f.greenWash * 0.9})`);
      g.addColorStop(0.55, `rgba(40,212,130,${f.greenWash * 0.3})`);
      g.addColorStop(1, "rgba(40,212,130,0)");
      ctx.fillStyle = g;
      ctx.fillRect(USC.CARD_X, USC.CARD_Y, USC.CARD_W, USC.CARD_H);
    }
    ctx.restore();

    // Dashed border, marching left to right at ~20 pt/s.
    if (f.zoneAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = f.zoneAlpha;
      ctx.strokeStyle = f.zoneOver ? "rgba(52,212,153,0.55)" : "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -wallTime * 20;
      rr(ctx, USC.CARD_X + 0.75, USC.CARD_Y + 0.75, USC.CARD_W - 1.5, USC.CARD_H - 1.5, USC.CARD_R - 0.5);
      ctx.stroke();
      ctx.restore();
    }

    if (f.zoneAlpha > 0 && f.textAlpha > 0) this.drawDropText(ctx, f);
    if (f.barAlpha > 0 || f.barReveal > 0) this.drawProgressBar(ctx, f);
    if (f.chooseAlpha > 0) this.drawChoose(ctx, f);

    this.drawPuhu(ctx, f);
    this.drawFeathers(ctx, f);
    this.drawHuffs(ctx, f);
  }

  // ── Drop zone text and chips ──────────────────────────────────────────────

  private drawDropText(ctx: CanvasRenderingContext2D, f: UploadFrame) {
    ctx.save();
    ctx.globalAlpha = f.textAlpha;
    const title = fitted(ctx, t("Drop your files here"), TEXT_RIGHT - USC.TEXT_X, 500, 13);
    text(ctx, title.s, USC.TEXT_X, USC.TEXT_Y - 4, title.font, "#D5D7DB");

    // Chips are sized by a rough estimate (6.5 px a character); a
    // translation wider than that estimate gets the room it needs.
    const labels = CHIPS.map((chip) => t(chip));
    let chipPx = 11;
    const widths = () => {
      ctx.font = `500 ${chipPx}px ${FONT}`;
      return labels.map((l) => Math.max(l.length * 6.5 + 16, Math.ceil(ctx.measureText(l).width) + 16));
    };
    let ws = widths();
    const rowW = () => ws.reduce((a, b) => a + b, 0) + 6 * (ws.length - 1);
    while (rowW() > TEXT_RIGHT - USC.TEXT_X && chipPx > 8.5) {
      chipPx -= 0.5;
      ws = widths();
    }
    let cx = USC.TEXT_X;
    labels.forEach((chip, i) => {
      const w = ws[i];
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      rr(ctx, cx, USC.TEXT_Y + 9, w, 18, 9);
      ctx.fill();
      text(ctx, chip, cx + 8, USC.TEXT_Y + 18, `500 ${chipPx}px ${FONT}`, "#B9BDC4");
      cx += w + 6;
    });
    ctx.restore();
  }

  // ── Progress bar ──────────────────────────────────────────────────────────

  private drawProgressBar(ctx: CanvasRenderingContext2D, f: UploadFrame) {
    ctx.save();
    ctx.globalAlpha = Math.max(f.barAlpha, 0.001);

    const x0 = USC.BAR_X0;
    const x1 = USC.BAR_X1;
    const by = USC.BAR_Y;
    const barLen = (x1 - x0) * f.barReveal;

    // Room up to the percentage (or the check mark) at the bar's right end.
    const uploading = t("Uploading {name}", { name: State.droppedFile?.name ?? t("file") });
    const label = fitted(ctx, uploading, x1 - x0 - 56, 500, 12.5);
    text(ctx, label.s, x0, by - 30, label.font, "#A9ADB5");

    if (f.check > 0) {
      ctx.save();
      ctx.translate(x1 - 8, by - 30);
      ctx.scale(f.check, f.check);
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#34D399";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-3.6, 0.2);
      ctx.lineTo(-1, 2.8);
      ctx.lineTo(3.8, -2.6);
      ctx.strokeStyle = "#07130E";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    } else {
      text(ctx, `${Math.round(f.progress * 100)} %`, x1, by - 30, `500 12.5px ${FONT}`, "#A9ADB5", "right");
    }

    // Track.
    if (barLen > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      rr(ctx, x0, by - 3, barLen, 6, 3);
      ctx.fill();
    }

    // Fill.
    const fx = lerp(x0, x1, f.progress);
    if (fx > x0 + 1) {
      const flashGreen = `rgb(${Math.round(lerp(52, 110, f.flash))},${Math.round(
        lerp(211, 231, f.flash),
      )},${Math.round(lerp(153, 183, f.flash))})`;
      const g = ctx.createLinearGradient(x0, 0, fx, 0);
      g.addColorStop(0, "#1FA87A");
      g.addColorStop(1, flashGreen);
      ctx.fillStyle = g;
      rr(ctx, x0, by - 3, fx - x0, 6, 3);
      ctx.fill();
    }

    // Glow trail, its length driven by how fast the bar is moving.
    if (f.progress > 0.01 && f.progress < 1) {
      const v =
        (progressAt(f.t + 0.01, USC.T_PROG_START, f.progEnd) -
          progressAt(f.t, USC.T_PROG_START, f.progEnd)) / 0.01;
      const tl = Math.max(8, Math.min(34, 8 + v * 40));
      const g = ctx.createLinearGradient(fx - tl, 0, fx, 0);
      g.addColorStop(0, "rgba(52,212,153,0)");
      g.addColorStop(1, "rgba(110,231,183,0.6)");
      ctx.save();
      ctx.filter = "blur(3px)";
      ctx.fillStyle = g;
      rr(ctx, fx - tl, by - 4, tl, 8, 4);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── Choose card ───────────────────────────────────────────────────────────

  private drawChoose(ctx: CanvasRenderingContext2D, f: UploadFrame) {
    ctx.save();
    ctx.globalAlpha = f.chooseAlpha;
    ctx.translate(0, (1 - f.chooseAlpha) * 4);

    // Clear of the corner's Cancel.
    const maxW = TEXT_RIGHT - 114 - 30;
    const many = State.droppedPaths.length > 1;
    const heading = many
      ? t("{n} files are ready.", { n: State.droppedPaths.length })
      : t("{name} is ready.", { name: State.droppedFile?.name ?? t("file") });
    const ready = fitted(ctx, heading, maxW, 600, 14);
    text(ctx, ready.s, 114, 80, ready.font, "#F5F6F8");
    const what = fitted(ctx, many ? t("What do you want to do with them?") : t("What do you want to do with it?"), maxW, 400, 12.5);
    text(ctx, what.s, 114, 100, what.font, "#9398A1");
    ctx.restore();
  }

  // ── Puhu ──────────────────────────────────────────────────────────────────

  /**
   * Puhu with his wings and the file: wings raised behind him to catch, wrapped in
   * front of him round the file he holds, beating as he flies with it hanging below.
   */
  private drawPuhu(ctx: CanvasRenderingContext2D, f: UploadFrame) {
    const R = f.d / 2 / 1.04;
    const rx = R * PUHU_RX;
    const ry = R * PUHU_RY;
    const puhu = puhuCss();
    ink = puhu.ink;

    // The wings' angle from the shoulder: hanging (0.45), raised (2.35), beating, or
    // swung round in front of him (negative) to hold the file.
    let ang = lerp(0.45, 2.35, f.wingsUp);
    if (f.beat != null) ang = 1.05 + 0.75 * Math.sin(f.beat);
    ang = lerp(ang, -1.05, f.hug);
    const front = ang < 0.2;
    const place = () => {
      ctx.translate(f.x, f.y + f.hop);
      ctx.rotate(f.tilt);
      ctx.scale(f.sx, f.sy);
    };
    const carried = f.file.held && f.file.y > f.y + R * 0.6;

    if (carried) drawHeldFile(ctx, f.file, f.tilt);

    ctx.save();
    place();
    if (!front) for (const sd of [-1, 1]) wing(ctx, sd, R, rx, ang, puhu.wing);
    const turn = f.lookX * 0.4;
    // Dressed as he is in the island: the scene takes him over and gives him back as he is.
    ctx.save();
    this.actions.dress(ctx, R, turn, "behind", f.lookY * 0.35);
    ctx.restore();
    bodyPath(ctx, R, f.tuft, -f.tilt * 2, turn);
    ctx.fillStyle = puhu.body;
    ctx.fill();
    ctx.save();
    bodyPath(ctx, R, f.tuft, -f.tilt * 2, turn);
    ctx.clip();
    // Eyes where the island's Puhu has them, turning with where he looks.
    const pitch = PUHU_EYE_P + f.lookY * 0.35;
    for (const sd of [-1, 1]) {
      const yaw = sd * PUHU_EYE_SP + f.lookX * 0.5;
      ctx.save();
      ctx.translate(Math.sin(yaw) * Math.cos(pitch) * rx, -Math.sin(pitch) * ry);
      ctx.scale(Math.max(0.18, Math.cos(yaw)), 1);
      drawEye(ctx, f.eye, R * 0.25 * PUHU_EYE_SCALE, R * 0.27 * PUHU_EYE_SCALE);
      ctx.restore();
    }
    ctx.restore(); // body clip
    ctx.save();
    this.actions.dress(ctx, R, turn, "front", f.lookY * 0.35);
    ctx.restore();
    ctx.restore(); // transform

    if (f.file.held && !carried) drawHeldFile(ctx, f.file, f.tilt);
    if (front) {
      ctx.save();
      place();
      for (const sd of [-1, 1]) wing(ctx, sd, R, rx, ang, puhu.wing);
      ctx.restore();
    }
    // Not his yet: under the pointer, or falling into his wings, over everything.
    if (!f.file.held) {
      const falling = f.file.s < 1 ? Math.sin(f.file.s * Math.PI * 3) * 0.12 : 0;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.translate(f.file.x, f.file.y);
      ctx.rotate(falling);
      drawDoc(ctx, 0, 0, f.file.s, f.file.s);
      ctx.restore();
    }
  }

  /** Sulking: little puffs of "hmph" rise off his head, on the side he turned to. */
  private drawHuffs(ctx: CanvasRenderingContext2D, f: UploadFrame) {
    if (f.sulk < 0.5) return;
    const R = f.d / 2 / 1.04;
    const side = f.lookX >= 0 ? 1 : -1;
    ctx.save();
    ctx.fillStyle = "rgba(220,224,232,0.9)";
    for (let i = 0; i < 2; i++) {
      const k = (f.t * 1.1 + i * 0.5) % 1;
      ctx.globalAlpha = (f.sulk - 0.5) * 2 * Math.sin(Math.PI * k);
      ctx.beginPath();
      ctx.arc(f.x + side * R * (0.75 + 0.35 * k), f.y - R * (0.9 + 0.7 * k), R * (0.07 + 0.06 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** As he catches it, a few feathers come loose and drift down. */
  private drawFeathers(ctx: CanvasRenderingContext2D, f: UploadFrame) {
    const age = f.caughtFor;
    if (age < 0 || age > 0.9) return;
    const R = f.d / 2 / 1.04;
    ctx.save();
    ctx.fillStyle = puhuCss().wing;
    ctx.globalAlpha = 1 - age / 0.9;
    for (let i = 0; i < 5; i++) {
      const sd = i % 2 ? 1 : -1;
      const x = f.x + sd * (R * 0.8 + (30 + 9 * i) * age);
      const y = f.y - (34 + 7 * i) * age + 120 * age * age;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(sd * (0.6 + 3 * age) + Math.sin(age * 9 + i) * 0.5);
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.13, R * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

/** One wing from his shoulder, `ang` radians out from hanging down (negative: across his front). */
function wing(ctx: CanvasRenderingContext2D, sd: number, R: number, rx: number, ang: number, color: string) {
  const len = R * 0.62;
  ctx.save();
  ctx.translate(sd * rx * 0.74, R * 0.04);
  ctx.rotate(-sd * ang);
  ctx.beginPath();
  ctx.ellipse(sd * len * 0.06, len * 0.5, R * 0.21, len * 0.52, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** The file he holds, small, tipping with him. */
function drawHeldFile(ctx: CanvasRenderingContext2D, file: UploadFile, tilt: number) {
  ctx.save();
  ctx.translate(file.x, file.y);
  ctx.rotate(tilt * 0.6);
  drawDoc(ctx, 0, 0, file.s, file.s);
  ctx.restore();
}

// ── Eye shapes ──────────────────────────────────────────────────────────────

/** The eyes' colour: Puhu's, set with his body each frame. */
let ink = "#0E0F12";

function drawEye(ctx: CanvasRenderingContext2D, shape: UploadEyeShape, w: number, h: number) {
  switch (shape) {
    case "pill":
      ctx.fillStyle = ink;
      rr(ctx, -w / 2, -h / 2, w, h, w / 2);
      ctx.fill();
      break;

    case "cup": {
      // Flat top, semicircular bottom.
      const hh = h * 0.55;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -hh / 2);
      ctx.lineTo(w / 2, -hh / 2);
      ctx.lineTo(w / 2, hh / 2 - w / 2);
      ctx.arc(0, hh / 2 - w / 2, w / 2, 0, Math.PI, false);
      ctx.closePath();
      ctx.fillStyle = ink;
      ctx.fill();
      break;
    }

    case "sulk":
      // The lids half down: only the lower half of the eye, flat along the top.
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 2, h * 0.5 - w / 2);
      ctx.arc(0, h * 0.5 - w / 2, w / 2, 0, Math.PI, false);
      ctx.closePath();
      ctx.fill();
      break;

    case "content":
      ctx.beginPath();
      ctx.arc(0, -h * 0.12, w * 0.85, Math.PI * 0.15, Math.PI * 0.85, false);
      ctx.strokeStyle = ink;
      ctx.lineWidth = w * 0.5;
      ctx.lineCap = "round";
      ctx.stroke();
      break;
  }
}

// ── Document icon ───────────────────────────────────────────────────────────

/**
 * The generic sheet with a folded corner. Windows has no real file icon
 * reachable from the webview, so this is the shape in every case.
 */
function drawDoc(ctx: CanvasRenderingContext2D, cx: number, cy: number, wsc: number, hsc: number) {
  const w = 34 * wsc;
  const h = 42 * hsc;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const fold = 8 * Math.min(wsc, hsc);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.moveTo(x + 2, y);
  ctx.lineTo(x + w - fold, y);
  ctx.lineTo(x + w, y + fold);
  ctx.lineTo(x + w, y + h - 2);
  ctx.quadraticCurveTo(x + w, y + h, x + w - 2, y + h);
  ctx.lineTo(x + 2, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - 2);
  ctx.lineTo(x, y + 2);
  ctx.quadraticCurveTo(x, y, x + 2, y);
  ctx.closePath();
  ctx.fillStyle = "#F4F4F6";
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(x + w - fold, y);
  ctx.lineTo(x + w - fold, y + fold);
  ctx.lineTo(x + w, y + fold);
  ctx.closePath();
  ctx.fillStyle = "#D5D6DB";
  ctx.fill();

  ctx.fillStyle = "#3B82F5";
  rr(ctx, x + w * 0.18, y + h * 0.58, w * 0.64, h * 0.16, 2);
  ctx.fill();
}
