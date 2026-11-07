// The colour of the song's cover, for the glow around Puhu and the closed island's
// note: its most vivid colour, lifted so it glows on black. Worked out once per cover,
// on a 24 px copy of it.

type RGB = [number, number, number];

const SIDE = 24;
let source = "";
let color: RGB | null = null;
/** The cover's two colours for the waveform: its most vivid, and the one most unlike it. */
let palette: [RGB, RGB] | null = null;

export const CoverColor = {
  /** The current cover's colour, or null before the first cover (or for a grey one). */
  get rgb(): RGB | null {
    return color;
  },

  /** The waveform's two colours, as CSS; the fallback twice before the first cover. */
  pair(fallback = "#22D3EE"): [string, string] {
    if (!palette) return [fallback, fallback];
    return palette.map((c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`) as [string, string];
  },

  css(alpha = 1, fallback = "#22D3EE"): string {
    if (!color) return fallback;
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
  },

  /** A cover arrived (a data URL): its colour, then `done` once it is known. */
  read(dataUrl: string, done: () => void) {
    if (!dataUrl || dataUrl === source || typeof Image === "undefined") return;
    source = dataUrl;
    const img = new Image();
    img.onload = () => {
      if (source !== dataUrl) return;
      const found = vivid(img);
      color = found?.[0] ?? null;
      palette = found;
      done();
    };
    img.src = dataUrl;
  },
};

function vivid(img: HTMLImageElement): [RGB, RGB] | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SIDE, SIDE);
  const data = ctx.getImageData(0, 0, SIDE, SIDE).data;
  // Each pixel by how colourful it is: saturated, neither near black nor near white.
  const px: { score: number; rgb: RGB }[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const rgb: RGB = [data[i], data[i + 1], data[i + 2]];
    const [, s, l] = toHsl(rgb);
    px.push({ score: s * Math.max(0, 1 - Math.abs(l - 0.5) * 1.8), rgb });
  }
  px.sort((a, b) => b.score - a.score);
  const top = px.slice(0, Math.max(1, Math.round(px.length * 0.15)));
  const weight = top.reduce((sum, p) => sum + p.score, 0);
  if (weight / top.length < 0.12) return null; // a grey cover: no colour of its own
  const avg = [0, 1, 2].map((k) => top.reduce((sum, p) => sum + p.rgb[k] * p.score, 0) / weight) as RGB;
  const [h] = toHsl(avg);
  // The second colour: among the colourful pixels, the hue furthest from the first.
  let other: RGB | null = null;
  let far = 0;
  for (const p of px.slice(0, Math.round(px.length * 0.4))) {
    if (p.score < 0.12) break;
    const d = Math.min(Math.abs(toHsl(p.rgb)[0] - h), 1 - Math.abs(toHsl(p.rgb)[0] - h));
    if (d > far) {
      far = d;
      other = p.rgb;
    }
  }
  // A cover of one hue: the second is the first, turned a little and lighter.
  const second = far > 0.08 && other ? other : toRgb((h + 0.07) % 1, 0.6, 0.72);
  return [lift(avg), lift(second)];
}

/** Lifted to glow on the island's black: never dull, never washed out. */
function lift(c: RGB): RGB {
  const [h, s, l] = toHsl(c);
  return toRgb(h, Math.max(s, 0.55), Math.min(0.7, Math.max(l, 0.55)));
}

function toHsl([r, g, b]: RGB): RGB {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function toRgb(h: number, s: number, l: number): RGB {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    t = (t + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
}
