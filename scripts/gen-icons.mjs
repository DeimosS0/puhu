// Draws Puhu into the PNG/ICO set Tauri needs. No dependencies: the icons are
// rasterised here and encoded with node:zlib, so the app icon stays "drawn in
// code" like the character itself (the outline is src/puhu/puhu.ts's).
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── Puhu ──────────────────────────────────────────────────────────────────────

const BODY = [241, 243, 248]; // Kar
const INK = [26, 24, 30];
const RIM = [26, 24, 30];

const SS = 4; // supersampling factor

const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const TOP = -Math.PI / 2;

/** puhuPoint() of src/puhu/puhu.ts, at rest. */
function puhuPoint(a, R) {
  const s = Math.sin(a);
  const c = Math.cos(a);
  let x = R * 0.86 * c * (1 + 0.07 * s);
  let y = R * s * (s < 0 ? 0.86 : 0.88) + R * 0.04;
  const brow = angle(a, TOP) / 0.55;
  if (Math.abs(brow) < 1) y += R * 0.12 * Math.pow(1 - brow * brow, 2);
  for (const side of [-1, 1]) {
    const d = angle(a, TOP + side * 0.8) / 0.24;
    if (Math.abs(d) >= 1) continue;
    const b = 0.24 * Math.pow(1 - d * d, 2);
    x += R * b * side * 0.95;
    y -= R * b * 0.75;
  }
  return [x, y];
}

/** The outline as a polygon, and the same pushed out by `rim` along its normals. */
function outlines(R, rim) {
  const n = 360;
  const body = [];
  for (let i = 0; i < n; i++) body.push(puhuPoint((i / n) * Math.PI * 2, R));
  const out = body.map(([x, y], i) => {
    const [x0, y0] = body[(i + n - 1) % n];
    const [x1, y1] = body[(i + 1) % n];
    const tx = x1 - x0;
    const ty = y1 - y0;
    const len = Math.hypot(tx, ty) || 1;
    // The outline runs clockwise on screen (y down): its outside is to the left of the tangent.
    return [x + (ty / len) * rim, y - (tx / len) * rim];
  });
  return { body, out };
}

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function insidePill(x, y, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(hw, hh);
  const cx = Math.max(-hw + r, Math.min(hw - r, x));
  const cy = Math.max(-hh + r, Math.min(hh - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function renderPuhu(size) {
  const px = new Uint8Array(size * size * 4);
  const R = size * 0.43;
  const cx = size / 2;
  const cy = size / 2 + R * 0.05;
  const rim = Math.max(1, R * 0.06); // dark outline so the tray icon reads on light themes
  const { body, out } = outlines(R, rim);

  // Eyes — same geometry as BotEngine with Puhu's constants (yaw ±0.38, pitch 0.14, x1.18)
  const eyeYaw = 0.38;
  const eyePitch = 0.14;
  const cp = Math.cos(eyePitch);
  const ex = Math.sin(eyeYaw) * cp * R * 0.86;
  const ey = -Math.sin(eyePitch) * R * 0.88;
  const ew = R * 0.25 * 1.18 * Math.cos(eyeYaw);
  const eh = R * 0.27 * 1.18 * cp;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bodyHits = 0;
      let rimHits = 0;
      let eyeHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = x + (sx + 0.5) / SS - cx;
          const py0 = y + (sy + 0.5) / SS - cy;
          if (!inside(out, px0, py0)) continue;
          rimHits++;
          if (!inside(body, px0, py0)) continue;
          bodyHits++;
          if (insidePill(px0 - ex, py0 - ey, ew, eh) || insidePill(px0 + ex, py0 - ey, ew, eh)) eyeHits++;
        }
      }
      if (rimHits === 0) continue;

      const total = SS * SS;
      const rimA = rimHits / total;
      const bodyA = bodyHits / total;
      const eyeA = eyeHits / total;

      // rim under body, body over rim, eyes over body
      let col = RIM.slice();
      if (bodyA > 0) col = col.map((c, i) => c * (1 - bodyA / rimA) + BODY[i] * (bodyA / rimA));
      if (eyeA > 0) col = col.map((c, i) => c * (1 - eyeA) + INK[i] * eyeA);

      const o = (y * size + x) * 4;
      px[o] = Math.round(col[0]);
      px[o + 1] = Math.round(col[1]);
      px[o + 2] = Math.round(col[2]);
      px[o + 3] = Math.round(Math.min(1, rimA) * 255);
    }
  }
  return px;
}

// ── PNG ───────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Go ────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const png = (size) => encodePNG(size, renderPuhu(size));

const files = {
  "32x32.png": png(32),
  "128x128.png": png(128),
  "128x128@2x.png": png(256),
  "icon.png": png(512),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name} — ${data.length} bytes`);
}

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);
