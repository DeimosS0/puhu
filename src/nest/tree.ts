// Puhu's tree (docs/gamification.md, "How the tree is drawn"): the visible history of
// focus play, drawn in code like Puhu himself. Grown, not placed: the whole shape comes
// from one seed, and how much of it shows is how far the person has come, so a limb
// that has grown stays where it grew and the next one comes where there is room. Leaves
// are soft clusters with a shadow under them and light on top, not single leaves: past
// a point they get fuller, not more. A blossom for each day the goal was reached, a
// lantern for each streak milestone; the season follows the calendar, and at night the
// lanterns glow. On the first days it is a sprout.

import { seeded } from "../core/quests";

export interface TreeLook {
  /** 0 (a sprout) to 1 (years of rounds): see treeAge. */
  age: number;
  /** Days the goal was reached: blossoms (spring and summer). */
  goalDays: number;
  /** Streak milestones reached: lanterns. */
  lanterns: number;
  season: "spring" | "summer" | "autumn" | "winter";
  night: boolean;
  /** The same seed, the same tree: one per install. */
  seed: number;
}

/** How grown the tree is from the rounds done: a sprout on the first day, nearly full after two years. */
export function treeAge(rounds: number): number {
  return Math.min(1, Math.max(0.03, (rounds / 1500) ** 0.45));
}

export function seasonOf(date: Date): TreeLook["season"] {
  const m = date.getMonth();
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
}

interface Branch {
  angle: number;
  len: number;
  width: number;
  depth: number;
  /** The age it starts growing at, and how it bends. */
  birth: number;
  bend: number;
  children: { at: number; branch: Branch }[];
}

const MAX_DEPTH = 5;
/** How much age a limb takes to reach its full length. */
const GROW_SPAN = 0.2;
/** Below this age it is a sprout: a stem and two leaves. */
const SPROUT_AGE = 0.07;

const PALETTES = {
  spring: { leaf: ["#2c7a4a", "#4caf6a", "#8fdc9c"], bark: "#6b4a33", hill: ["#3f7a50", "#24452f"] },
  summer: { leaf: ["#1d5e36", "#348c4e", "#6cc77b"], bark: "#634430", hill: ["#356a44", "#1f3c29"] },
  autumn: { leaf: ["#8f3a20", "#d4703a", "#f6b766"], bark: "#634430", hill: ["#6b5a33", "#3a3220"] },
  winter: { leaf: ["#6d8c9b", "#a9c6d3", "#f2f8fb"], bark: "#5a463a", hill: ["#e3edf2", "#a9bcc6"] },
} as const;

/** The tree's whole shape, from its seed; the age only decides how much of it shows. */
function grow(seed: number): Branch {
  const rand = seeded(seed);
  const make = (angle: number, len: number, width: number, depth: number, birth: number): Branch => {
    const b: Branch = { angle, len, width, depth, birth, bend: (rand() - 0.5) * 0.6, children: [] };
    if (depth >= MAX_DEPTH) return b;
    // The trunk opens into three or four limbs; each limb into two or three. They lean
    // back towards the sky as they go, and the thinner they are, the later they come.
    const count = depth === 0 ? (rand() < 0.5 ? 3 : 4) : rand() < 0.4 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const side = (i / (count - 1)) * 2 - 1;
      const at = depth === 0 ? 0.72 + rand() * 0.28 : 0.5 + rand() * 0.5;
      const spread = side * (depth === 0 ? 0.62 + rand() * 0.25 : 0.38 + rand() * 0.22) + (rand() - 0.5) * 0.16;
      const upward = (angle + Math.PI / 2) * 0.22;
      const childLen = len * (depth === 0 ? 0.78 + rand() * 0.12 : 0.7 + rand() * 0.12);
      const delay = 0.06 + rand() * 0.08 + depth * 0.03;
      b.children.push({ at, branch: make(angle + spread - upward, childLen, width * 0.58, depth + 1, birth + delay) });
    }
    return b;
  };
  return make(-Math.PI / 2, 0.62, 1, 0, 0);
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface Tip {
  x: number;
  y: number;
  grown: number;
  depth: number;
}

/** Every visible limb as a tapered stroke, the tips for the leaves, and the places to hang things. */
function lay(root: Branch, age: number, scale: number, x0: number, y0: number) {
  const strokes: { pts: [number, number][]; w0: number; w1: number; depth: number }[] = [];
  const tips: Tip[] = [];
  const holds: { x: number; y: number; depth: number }[] = [];
  const walk = (b: Branch, x: number, y: number) => {
    const grown = easeOut(Math.min(1, Math.max(0, (age - b.birth) / GROW_SPAN)));
    if (grown <= 0) return;
    const len = b.len * scale * grown;
    const ex = x + Math.cos(b.angle) * len;
    const ey = y + Math.sin(b.angle) * len;
    const mx = (x + ex) / 2 + Math.cos(b.angle + Math.PI / 2) * len * b.bend * 0.25;
    const my = (y + ey) / 2 + Math.sin(b.angle + Math.PI / 2) * len * b.bend * 0.25;
    const at = (t: number): [number, number] => [
      (1 - t) ** 2 * x + 2 * (1 - t) * t * mx + t * t * ex,
      (1 - t) ** 2 * y + 2 * (1 - t) * t * my + t * t * ey,
    ];
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) pts.push(at(i / 12));
    // A sapling is thin; the wood thickens as the tree ages.
    const w = b.width * scale * 0.17 * (0.4 + 0.6 * grown) * (b.depth === 0 ? 1.25 : 1) * Math.min(1, 0.3 + age * 1.4);
    strokes.push({ pts, w0: w, w1: w * 0.55, depth: b.depth });
    if (b.depth >= 1 && b.depth <= 2 && grown > 0.7) holds.push({ x: at(0.5)[0], y: at(0.5)[1], depth: b.depth });
    for (const c of b.children) {
      // A limb can only start where its branch has already reached.
      if (c.at > grown + 0.05) continue;
      const [cx, cy] = at(Math.min(1, c.at / Math.max(grown, 0.001)));
      walk(c.branch, cx, cy);
    }
    // Leaves at the end of every limb (and of the trunk while it is alone): a young tree
    // is never bare, and an old one's inner clusters only make the crown fuller.
    if (b.depth >= 1 || b.children.every((c) => age < c.branch.birth + 0.03)) tips.push({ x: ex, y: ey, grown, depth: b.depth });
  };
  walk(root, x0, y0);
  return { strokes, tips, holds };
}

function taper(ctx: CanvasRenderingContext2D, pts: [number, number][], w0: number, w1: number) {
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[Math.min(pts.length - 1, i + 1)];
    const [px, py] = pts[Math.max(0, i - 1)];
    const d = Math.hypot(nx - px, ny - py) || 1;
    const w = (w0 + (w1 - w0) * (i / (pts.length - 1))) / 2;
    left.push([x - ((ny - py) / d) * w, y + ((nx - px) / d) * w]);
    right.push([x + ((ny - py) / d) * w, y - ((nx - px) / d) * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const [x, y] of left) ctx.lineTo(x, y);
  const [ex, ey] = pts[pts.length - 1];
  ctx.arc(ex, ey, w1 / 2, 0, Math.PI * 2);
  for (const [x, y] of right.reverse()) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

function blossom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function lantern(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, night: boolean) {
  const cy = y + s * 2.1;
  ctx.strokeStyle = "rgba(50, 34, 24, 0.9)";
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, cy - s * 0.7);
  ctx.stroke();
  if (night) {
    const glow = ctx.createRadialGradient(x, cy, 0, x, cy, s * 3.4);
    glow.addColorStop(0, "rgba(255, 196, 100, 0.6)");
    glow.addColorStop(1, "rgba(255, 196, 100, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, cy, s * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = night ? "#ffd27f" : "#f0a04b";
  ctx.beginPath();
  ctx.roundRect(x - s * 0.55, cy - s * 0.7, s * 1.1, s * 1.4, s * 0.45);
  ctx.fill();
  ctx.fillStyle = "rgba(80, 44, 26, 0.9)";
  ctx.beginPath();
  ctx.roundRect(x - s * 0.42, cy - s * 0.86, s * 0.84, s * 0.24, s * 0.08);
  ctx.fill();
}

/** Puhu, small, sitting on a limb: the round owl, his tufts, his eyes (asleep at night), a scarf in winter. */
function puhu(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, night: boolean, scarf: boolean) {
  ctx.fillStyle = "#f4f4f7";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.8, y - s * 1.3);
  ctx.lineTo(x - s * 0.55, y - s * 2.05);
  ctx.lineTo(x - s * 0.15, y - s * 1.55);
  ctx.lineTo(x + s * 0.15, y - s * 1.55);
  ctx.lineTo(x + s * 0.55, y - s * 2.05);
  ctx.lineTo(x + s * 0.8, y - s * 1.3);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.95, s, s * 0.98, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#15161a";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    if (night) ctx.ellipse(x + side * s * 0.37, y - s * 1.08, s * 0.2, s * 0.06, 0, 0, Math.PI * 2);
    else ctx.arc(x + side * s * 0.37, y - s * 1.08, s * 0.17, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!scarf) return;
  ctx.fillStyle = "#d94a4a";
  ctx.beginPath();
  ctx.roundRect(x - s * 0.82, y - s * 0.6, s * 1.64, s * 0.32, s * 0.16);
  ctx.fill();
  // Its end hangs down one side.
  ctx.beginPath();
  ctx.roundRect(x + s * 0.3, y - s * 0.45, s * 0.3, s * 0.62, s * 0.12);
  ctx.fill();
  ctx.fillStyle = "#f2f2f2";
  ctx.fillRect(x + s * 0.3, y + s * 0.02, s * 0.3, s * 0.07);
}

/** The first days: a stem and two leaves, a little taller each round. */
function sprout(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, age: number, leaf: readonly string[]) {
  const h = s * (0.35 + (age / SPROUT_AGE) * 0.5);
  ctx.strokeStyle = "#5c8a3c";
  ctx.lineWidth = s * 0.06;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - s * 0.08, y - h * 0.5, x, y - h);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(x, y - h);
    ctx.rotate(side * 0.7 - 0.1);
    ctx.fillStyle = leaf[1];
    ctx.beginPath();
    ctx.ellipse(side * s * 0.16, -s * 0.04, s * 0.18, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = leaf[2];
    ctx.beginPath();
    ctx.ellipse(side * s * 0.13, -s * 0.07, s * 0.08, s * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** The tree in a w × h box: a small hill at the bottom, the trunk from its middle. */
export function drawTree(ctx: CanvasRenderingContext2D, w: number, h: number, look: TreeLook) {
  const palette = PALETTES[look.season];
  const rand = seeded(look.seed * 31 + 7);
  const groundY = h * 0.84;
  const scale = h * 0.34;

  const hill = ctx.createLinearGradient(0, groundY - h * 0.05, 0, h);
  hill.addColorStop(0, look.night ? palette.hill[1] : palette.hill[0]);
  hill.addColorStop(1, palette.hill[1]);
  // The ground: wall to wall and down to the bottom edge, rising into a gentle hill
  // where the tree stands, so nothing floats.
  const crest = groundY - h * 0.01;
  const base = groundY + h * 0.07;
  const groundAt = (x: number) => base - (base - crest) * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, Math.abs(x - w / 2) / (w * 0.55))));
  ctx.fillStyle = hill;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i <= 48; i++) ctx.lineTo((i / 48) * w, groundAt((i / 48) * w));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  const winter = look.season === "winter";
  if (winter) {
    // Snow falling, still: a sprinkle of flakes in the air, and soft drifts on the hill.
    const flakes = seeded(look.seed * 17 + 3);
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + flakes() * 0.5})`;
      ctx.beginPath();
      ctx.arc(flakes() * w, flakes() * groundY * 0.95, h * (0.003 + flakes() * 0.006), 0, Math.PI * 2);
      ctx.fill();
    }
    // Drifts: soft bumps on the hill's own curve, in its own colour, so they are the hill.
    ctx.fillStyle = hill;
    for (const [dx, rx, ry] of [[-0.24, 0.13, 0.04], [-0.05, 0.09, 0.025], [0.2, 0.15, 0.045]]) {
      const x = w / 2 + dx * w;
      const top = groundAt(x);
      ctx.beginPath();
      ctx.ellipse(x, top + h * ry * 0.55, w * rx, h * ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (look.age < SPROUT_AGE) {
    sprout(ctx, w / 2, groundY + h * 0.01, scale, look.age, palette.leaf);
    return;
  }

  const { strokes, tips, holds } = lay(grow(look.seed), look.age, scale, w / 2, groundY + h * 0.01);

  ctx.fillStyle = palette.bark;
  for (const s of strokes) taper(ctx, s.pts, s.w0, s.w1);
  if (look.season === "winter") {
    // Snow along the top of the limbs.
    ctx.strokeStyle = "#f2f8fb";
    ctx.lineCap = "round";
    for (const s of strokes) {
      if (s.depth === 0) continue;
      ctx.lineWidth = Math.max(0.8, s.w1 * 0.45);
      ctx.beginPath();
      for (let i = 0; i < s.pts.length - 1; i++) {
        const [x0, y0] = s.pts[i];
        const [x1, y1] = s.pts[i + 1];
        if (Math.abs(y1 - y0) > Math.abs(x1 - x0) * 1.1) continue;
        // On the upper side: the half-width up from the middle of the limb.
        const half = (s.w0 + (s.w1 - s.w0) * (i / (s.pts.length - 1))) / 2;
        ctx.moveTo(x0, y0 - half * 0.8);
        ctx.lineTo(x1, y1 - half * 0.8);
      }
      ctx.stroke();
    }
  }

  // Leaves: a soft cluster at each tip, its size from how grown it is. All the shadows
  // first, then the bodies, then the light on top, so the crown reads as one with depth.
  const leafScale = scale * 0.17;
  const clusters = tips.filter((t) => t.grown > 0.3);
  if (winter) {
    // No leaves till spring: a pillow of snow on each tip, and holly berries under some.
    const berries = seeded(look.seed * 5 + 11);
    for (const t of clusters) {
      const r = scale * 0.05 * (0.6 + 0.4 * t.grown);
      ctx.fillStyle = "#c9dbe4";
      ctx.beginPath();
      ctx.ellipse(t.x + r * 0.1, t.y - r * 0.05, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f7fbfd";
      ctx.beginPath();
      ctx.ellipse(t.x, t.y - r * 0.2, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      if (berries() < 0.45) {
        ctx.fillStyle = "#d63c3c";
        for (const [bx, by] of [[-0.35, 0.55], [0.15, 0.7], [0.55, 0.45]]) {
          ctx.beginPath();
          ctx.arc(t.x + bx * r, t.y + by * r, r * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  const layers = [
    { color: palette.leaf[0], n: 4, size: 0.62, dx: 0.1, dy: 0.24 },
    { color: palette.leaf[1], n: 5, size: 0.58, dx: 0, dy: 0 },
    { color: palette.leaf[2], n: 2, size: 0.3, dx: -0.28, dy: -0.34 },
  ];
  for (const layer of winter ? [] : layers) {
    ctx.fillStyle = layer.color;
    for (const t of clusters) {
      const r = leafScale * (0.55 + 0.45 * t.grown);
      const local = seeded(Math.round(t.x * 13 + t.y * 7) + look.seed);
      for (let i = 0; i < layer.n; i++) {
        const a = local() * Math.PI * 2;
        const d = local() * r * 0.55;
        const rr = r * layer.size * (0.8 + local() * 0.35);
        ctx.beginPath();
        ctx.arc(t.x + Math.cos(a) * d + layer.dx * r, t.y + Math.sin(a) * d * 0.75 + layer.dy * r, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // A blossom for each goal day, in spring and summer, as many as the leaves can hold.
  if ((look.season === "spring" || look.season === "summer") && clusters.length > 0) {
    const n = Math.min(look.goalDays, clusters.length * 3);
    for (let i = 0; i < n; i++) {
      const t = clusters[Math.floor(rand() * clusters.length)];
      const r = leafScale * 0.7;
      blossom(ctx, t.x + (rand() - 0.5) * r * 1.5, t.y + (rand() - 0.6) * r * 1.1, scale * 0.024, look.season === "spring" ? "#ffd3e2" : "#fff1f6");
    }
  }

  // A lantern for each milestone, hung under the crown from the strong limbs, spread out.
  const spots = holds.filter((p) => p.depth === 2).sort((a, b) => a.x - b.x);
  const hung = Math.min(look.lanterns, spots.length);
  for (let i = 0; i < hung; i++) {
    const p = spots[Math.floor(((i + 0.5) / hung) * spots.length)];
    lantern(ctx, p.x, p.y, scale * 0.06, look.night);
  }

  // Puhu sits on a big limb once the tree can hold him.
  const perch = holds.filter((p) => p.depth === 1).sort((a, b) => b.y - a.y)[0];
  if (perch && look.age > 0.3) puhu(ctx, perch.x, perch.y, scale * 0.1, look.night, winter);
}
