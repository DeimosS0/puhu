// A Word document (.docx) or plain text as HTML, for Puhu to print to a PDF without Word
// (src-tauri/src/convert.rs prints it with Edge). It keeps what homework or a letter
// needs: paragraphs and headings, bold, italic, underline, colour and size, alignment,
// spacing and indents, numbered and bulleted lists, tables, pictures, page breaks, and
// the page's size and margins. Not kept: headers and footers, text boxes, footnotes,
// columns, tracked changes. The zip is read here and inflated by the browser
// (DecompressionStream), the XML parsed by DOMParser: nothing to install.

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

/** Twentieths of a point (Word's twips) to points. */
const pt = (twips: string | null) => (twips == null ? null : Number(twips) / 20);

// ── The zip ──────────────────────────────────────────────────────────────────

interface Entry {
  method: number;
  data: Uint8Array;
}

function unzip(buf: ArrayBuffer): Map<string, Entry> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // The end of the central directory, last in the file (a comment may follow it).
  let end = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a .docx");
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const names = new TextDecoder();
  const out = new Map<string, Entry>();
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.set(name, { method, data: bytes.subarray(start, start + size) });
  }
  return out;
}

async function inflate(entry: Entry): Promise<Uint8Array> {
  if (entry.method === 0) return entry.data;
  const stream = new Blob([entry.data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function xml(zip: Map<string, Entry>, name: string): Promise<Document | null> {
  const entry = zip.get(name);
  if (!entry) return null;
  return new DOMParser().parseFromString(new TextDecoder().decode(await inflate(entry)), "application/xml");
}

// ── Small helpers ────────────────────────────────────────────────────────────

const kids = (el: Element | null | undefined, name?: string) =>
  el ? Array.from(el.children).filter((c) => c.namespaceURI === W && (!name || c.localName === name)) : [];
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const val = (el: Element | null | undefined) => el?.getAttributeNS(W, "val") ?? null;
/** An on/off property (<w:b/>, <w:b w:val="0"/>): null when not said. */
const flag = (el: Element | null) => (el == null ? null : !["0", "false", "off"].includes(val(el) ?? "1"));

/** A colour as Word writes it (six hex digits), else nothing: only that reaches the page. */
const hex = (v: string | null | undefined) => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : undefined);
/** A font's name, kept to letters, digits, spaces, dots and dashes. */
const fontName = (v: string | null | undefined) => v?.replace(/[^\p{L}\p{N} .\-]/gu, "").trim() || undefined;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Styles ───────────────────────────────────────────────────────────────────

interface RunLook {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  size?: number;
  color?: string;
  font?: string;
  highlight?: string;
  vert?: string;
  caps?: boolean;
}

interface ParaLook {
  align?: string;
  before?: number;
  after?: number;
  line?: number;
  lineExact?: number;
  left?: number;
  right?: number;
  first?: number;
  heading?: number;
  pageBefore?: boolean;
}

const HIGHLIGHT: Record<string, string> = {
  yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000",
  darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000",
  darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000",
};

function runLook(rPr: Element | null): RunLook {
  const look: RunLook = {};
  if (!rPr) return look;
  const set = <K extends keyof RunLook>(k: K, v: RunLook[K] | null | undefined) => {
    if (v != null) look[k] = v;
  };
  set("b", flag(kid(rPr, "b")));
  set("i", flag(kid(rPr, "i")));
  const u = val(kid(rPr, "u"));
  if (u != null) look.u = u !== "none";
  set("strike", flag(kid(rPr, "strike")));
  set("caps", flag(kid(rPr, "caps")));
  const sz = val(kid(rPr, "sz"));
  if (sz) look.size = Number(sz) / 2;
  const color = hex(val(kid(rPr, "color")));
  if (color) look.color = color;
  const fonts = kid(rPr, "rFonts");
  const font = fontName(fonts?.getAttributeNS(W, "ascii") ?? fonts?.getAttributeNS(W, "hAnsi"));
  if (font) look.font = font;
  const hl = val(kid(rPr, "highlight"));
  if (hl && HIGHLIGHT[hl]) look.highlight = HIGHLIGHT[hl];
  const shd = hex(kid(rPr, "shd")?.getAttributeNS(W, "fill"));
  if (!look.highlight && shd) look.highlight = shd;
  const vert = val(kid(rPr, "vertAlign"));
  if (vert === "superscript" || vert === "subscript") look.vert = vert;
  return look;
}

function paraLook(pPr: Element | null): ParaLook {
  const look: ParaLook = {};
  if (!pPr) return look;
  const jc = val(kid(pPr, "jc"));
  const align: Record<string, string> = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
  if (jc && align[jc]) look.align = align[jc];
  const sp = kid(pPr, "spacing");
  if (sp) {
    const before = pt(sp.getAttributeNS(W, "before"));
    const after = pt(sp.getAttributeNS(W, "after"));
    if (before != null) look.before = before;
    if (after != null) look.after = after;
    const line = sp.getAttributeNS(W, "line");
    const rule = sp.getAttributeNS(W, "lineRule") ?? "auto";
    if (line) {
      if (rule === "auto") look.line = Number(line) / 240;
      else look.lineExact = Number(line) / 20;
    }
  }
  const ind = kid(pPr, "ind");
  if (ind) {
    const left = pt(ind.getAttributeNS(W, "left") ?? ind.getAttributeNS(W, "start"));
    const right = pt(ind.getAttributeNS(W, "right") ?? ind.getAttributeNS(W, "end"));
    const first = pt(ind.getAttributeNS(W, "firstLine"));
    const hanging = pt(ind.getAttributeNS(W, "hanging"));
    if (left != null) look.left = left;
    if (right != null) look.right = right;
    if (first != null) look.first = first;
    if (hanging != null) look.first = -hanging;
  }
  if (flag(kid(pPr, "pageBreakBefore"))) look.pageBefore = true;
  return look;
}

interface Style {
  para: ParaLook;
  run: RunLook;
  basedOn: string | null;
  heading?: number;
}

class Styles {
  private readonly byId = new Map<string, Style>();
  defaultPara: ParaLook = {};
  defaultRun: RunLook = {};
  defaultStyle: string | null = null;

  constructor(doc: Document | null) {
    if (!doc) return;
    const root = doc.documentElement;
    const defaults = kid(root, "docDefaults");
    this.defaultRun = runLook(kid(kid(defaults, "rPrDefault"), "rPr"));
    this.defaultPara = paraLook(kid(kid(defaults, "pPrDefault"), "pPr"));
    for (const s of kids(root, "style")) {
      const id = s.getAttributeNS(W, "styleId");
      if (!id) continue;
      const name = (val(kid(s, "name")) ?? "").toLowerCase();
      const h = /^heading (\d)$/.exec(name);
      const style: Style = {
        para: paraLook(kid(s, "pPr")),
        run: runLook(kid(s, "rPr")),
        basedOn: val(kid(s, "basedOn")),
        heading: h ? Number(h[1]) : name === "title" ? 1 : undefined,
      };
      this.byId.set(id, style);
      if (s.getAttributeNS(W, "type") === "paragraph" && s.getAttributeNS(W, "default") === "1") this.defaultStyle = id;
    }
  }

  /** A character style's own look (what it is based on under it), without the defaults. */
  character(id: string | null): RunLook {
    const chain: RunLook[] = [];
    for (let at = id, n = 0; at && n < 20; n++) {
      const s = this.byId.get(at);
      if (!s) break;
      chain.unshift(s.run);
      at = s.basedOn;
    }
    return Object.assign({}, ...chain);
  }

  /** A style with what it is based on under it: (paragraph, run, heading level). */
  resolve(id: string | null): { para: ParaLook; run: RunLook; heading?: number } {
    const chain: Style[] = [];
    for (let at = id ?? this.defaultStyle, n = 0; at && n < 20; n++) {
      const s = this.byId.get(at);
      if (!s) break;
      chain.unshift(s);
      at = s.basedOn;
    }
    const para = { ...this.defaultPara };
    const run = { ...this.defaultRun };
    let heading: number | undefined;
    for (const s of chain) {
      Object.assign(para, s.para);
      Object.assign(run, s.run);
      if (s.heading) heading = s.heading;
    }
    return { para, run, heading };
  }
}

// ── Lists ────────────────────────────────────────────────────────────────────

interface Level {
  format: string;
  text: string;
  start: number;
  left?: number;
  first?: number;
}

class Numbering {
  private readonly abstract = new Map<string, Map<number, Level>>();
  private readonly nums = new Map<string, string>();
  private readonly counters = new Map<string, number[]>();

  constructor(doc: Document | null) {
    if (!doc) return;
    const root = doc.documentElement;
    for (const a of kids(root, "abstractNum")) {
      const levels = new Map<number, Level>();
      for (const l of kids(a, "lvl")) {
        const ind = paraLook(kid(l, "pPr"));
        levels.set(Number(l.getAttributeNS(W, "ilvl")), {
          format: val(kid(l, "numFmt")) ?? "decimal",
          text: val(kid(l, "lvlText")) ?? "%1.",
          start: Number(val(kid(l, "start")) ?? 1),
          left: ind.left,
          first: ind.first,
        });
      }
      this.abstract.set(a.getAttributeNS(W, "abstractNumId") ?? "", levels);
    }
    for (const n of kids(root, "num")) {
      this.nums.set(n.getAttributeNS(W, "numId") ?? "", val(kid(n, "abstractNumId")) ?? "");
    }
  }

  /** The marker for the next item of list `numId` at `level`, and its level's indents. */
  next(numId: string, level: number): { marker: string; level: Level | null } {
    const levels = this.abstract.get(this.nums.get(numId) ?? "");
    const lvl = levels?.get(level) ?? null;
    if (!levels || !lvl) return { marker: "•", level: null };
    const counts = this.counters.get(numId) ?? [];
    for (let i = 0; i <= level; i++) counts[i] ??= (levels.get(i)?.start ?? 1) - 1;
    counts[level] += 1;
    // A deeper level starts again under each new item.
    counts.length = level + 1;
    this.counters.set(numId, counts);
    if (lvl.format === "bullet") return { marker: bullet(lvl.text), level: lvl };
    if (lvl.format === "none") return { marker: "", level: lvl };
    const marker = lvl.text.replace(/%(\d)/g, (_, d) => {
      const i = Number(d) - 1;
      return formatNumber(counts[i] ?? levels.get(i)?.start ?? 1, levels.get(i)?.format ?? "decimal");
    });
    return { marker, level: lvl };
  }
}

/** Word's bullets are often Symbol or Wingdings code points; shown as what they look like. */
function bullet(text: string): string {
  const c = text.codePointAt(0) ?? 0x2022;
  if (c === 0xf0b7 || c === 0xb7) return "•";
  if (c === 0xf0a7 || c === 0xa7) return "▪";
  if (c === 0xf0d8) return "➢";
  if (c === 0xf0fc) return "✓";
  if (c === 0x6f || c === 0xf06f) return "◦";
  return c >= 0xf000 ? "•" : text;
}

function formatNumber(n: number, format: string): string {
  const letters = (k: number) => {
    let s = "";
    for (let x = k; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
    return s;
  };
  const roman = (k: number) => {
    const map: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let s = "";
    let x = k;
    for (const [v, r] of map) for (; x >= v; x -= v) s += r;
    return s;
  };
  switch (format) {
    case "lowerLetter": return letters(n);
    case "upperLetter": return letters(n).toUpperCase();
    case "lowerRoman": return roman(n);
    case "upperRoman": return roman(n).toUpperCase();
    default: return String(n);
  }
}

// ── The document ─────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp",
  webp: "image/webp", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff",
};

function runCss(look: RunLook, base: RunLook): string {
  const css: string[] = [];
  if (look.b && !base.b) css.push("font-weight:bold");
  if (look.b === false && base.b) css.push("font-weight:normal");
  if (look.i && !base.i) css.push("font-style:italic");
  const lines = [look.u ? "underline" : "", look.strike ? "line-through" : ""].filter(Boolean);
  if (lines.length) css.push(`text-decoration:${lines.join(" ")}`);
  if (look.size && look.size !== base.size) css.push(`font-size:${look.size}pt`);
  if (look.color && look.color !== base.color) css.push(`color:${look.color}`);
  if (look.font && look.font !== base.font) css.push(`font-family:${fontStack(look.font)}`);
  if (look.highlight) css.push(`background:${look.highlight}`);
  if (look.caps) css.push("text-transform:uppercase");
  if (look.vert) css.push(`vertical-align:${look.vert === "superscript" ? "super" : "sub"};font-size:smaller`);
  return css.join(";");
}

function fontStack(font: string): string {
  const serif = /times|georgia|garamond|cambria|book|serif/i.test(font);
  return `"${font.replace(/"/g, "")}",${serif ? "'Times New Roman',serif" : "Calibri,Arial,sans-serif"}`;
}

function paraCss(look: ParaLook): string {
  const css: string[] = [];
  if (look.align) css.push(`text-align:${look.align}`);
  if (look.before != null) css.push(`margin-top:${look.before}pt`);
  if (look.after != null) css.push(`margin-bottom:${look.after}pt`);
  if (look.line != null) css.push(`line-height:${(look.line * 1.17).toFixed(3)}`);
  if (look.lineExact != null) css.push(`line-height:${look.lineExact}pt`);
  if (look.left) css.push(`margin-left:${look.left}pt`);
  if (look.right) css.push(`margin-right:${look.right}pt`);
  if (look.first) css.push(`text-indent:${look.first}pt`);
  if (look.pageBefore) css.push("break-before:page");
  return css.join(";");
}

class Converter {
  private readonly images = new Map<string, string>();

  constructor(
    private readonly zip: Map<string, Entry>,
    private readonly rels: Map<string, string>,
    private readonly styles: Styles,
    private readonly lists: Numbering,
  ) {}

  /** Pictures read ahead, as data URLs by relationship id (rendering stays synchronous). */
  async loadImages(body: Element) {
    for (const blip of Array.from(body.getElementsByTagNameNS(A, "blip"))) {
      const id = blip.getAttributeNS(R, "embed");
      if (!id || this.images.has(id)) continue;
      const target = this.rels.get(id);
      const entry = target && this.zip.get(`word/${target.replace(/^\/?word\//, "").replace(/^\//, "")}`);
      const mime = MIME[(target ?? "").split(".").pop()?.toLowerCase() ?? ""];
      if (!entry || !mime) continue;
      const data = await inflate(entry);
      let bin = "";
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      this.images.set(id, `data:${mime};base64,${btoa(bin)}`);
    }
  }

  blocks(parent: Element): string {
    let html = "";
    for (const el of kids(parent)) {
      if (el.localName === "p") html += this.paragraph(el);
      else if (el.localName === "tbl") html += this.table(el);
      else if (el.localName === "sdt") html += this.blocks(kid(el, "sdtContent") ?? el);
      else if (el.localName === "customXml") html += this.blocks(el);
    }
    return html;
  }

  private paragraph(p: Element): string {
    const pPr = kid(p, "pPr");
    const style = this.styles.resolve(val(kid(pPr, "pStyle")));
    const look = { ...style.para, ...paraLook(pPr) };
    let marker = "";
    const numPr = kid(pPr, "numPr");
    const numId = val(kid(numPr, "numId"));
    if (numId && numId !== "0") {
      const next = this.lists.next(numId, Number(val(kid(numPr, "ilvl")) ?? 0));
      marker = next.marker;
      if (next.level) {
        if (look.left == null && next.level.left != null) look.left = next.level.left;
        if (look.first == null && next.level.first != null) look.first = next.level.first;
      }
    }
    const runs = this.inline(p, style.run);
    const tag = style.heading ? `h${Math.min(6, style.heading)}` : "p";
    const css = [paraCss(look), runCss(style.run, this.styles.defaultRun)].filter(Boolean).join(";");
    const mark = marker ? `<span class="mk">${esc(marker)}</span>` : "";
    // An empty paragraph keeps its line, as in Word.
    return `<${tag}${css ? ` style="${esc(css)}"` : ""}>${mark}${runs || "<br>"}</${tag}>`;
  }

  private inline(parent: Element, base: RunLook): string {
    let html = "";
    for (const el of kids(parent)) {
      switch (el.localName) {
        case "r":
          html += this.run(el, base);
          break;
        case "hyperlink":
        case "smartTag":
        case "fldSimple":
        case "ins":
        case "customXml":
          html += this.inline(el, base);
          break;
        case "sdt":
          html += this.inline(kid(el, "sdtContent") ?? el, base);
          break;
      }
    }
    return html;
  }

  private run(r: Element, base: RunLook): string {
    const rPr = kid(r, "rPr");
    const look = { ...base, ...this.styles.character(val(kid(rPr, "rStyle"))), ...runLook(rPr) };
    let text = "";
    for (const el of Array.from(r.children)) {
      if (el.namespaceURI === W) {
        if (el.localName === "t") text += esc(el.textContent ?? "");
        else if (el.localName === "tab") text += '<span class="tab">\t</span>';
        else if (el.localName === "br") text += val(el) === "page" || el.getAttributeNS(W, "type") === "page" ? '<span class="pb"></span>' : "<br>";
        else if (el.localName === "cr") text += "<br>";
        else if (el.localName === "noBreakHyphen") text += "&#8209;";
        else if (el.localName === "drawing") text += this.drawing(el);
      } else if (el.localName === "AlternateContent") {
        const drawing = el.getElementsByTagNameNS(W, "drawing")[0];
        if (drawing) text += this.drawing(drawing);
      }
    }
    if (!text) return "";
    const css = runCss(look, base);
    return css ? `<span style="${esc(css)}">${text}</span>` : text;
  }

  private drawing(d: Element): string {
    const blip = d.getElementsByTagNameNS(A, "blip")[0];
    const src = blip && this.images.get(blip.getAttributeNS(R, "embed") ?? "");
    if (!src) return "";
    const extent = d.getElementsByTagNameNS(WP, "extent")[0];
    // EMUs: 12700 to a point.
    const w = Number(extent?.getAttribute("cx") ?? 0) / 12700;
    const h = Number(extent?.getAttribute("cy") ?? 0) / 12700;
    const size = w > 0 && h > 0 ? ` style="width:${w.toFixed(1)}pt;height:${h.toFixed(1)}pt"` : "";
    return `<img src="${src}"${size}>`;
  }

  private table(tbl: Element): string {
    const tblPr = kid(tbl, "tblPr");
    const styleId = val(kid(tblPr, "tblStyle")) ?? "";
    const bordered = kid(tblPr, "tblBorders") != null || /grid|table/i.test(styleId);
    let html = `<table class="${bordered ? "grid" : ""}">`;
    for (const tr of kids(tbl, "tr")) {
      html += "<tr>";
      for (const tc of kids(tr, "tc")) {
        const tcPr = kid(tc, "tcPr");
        const merge = kid(tcPr, "vMerge");
        // A cell merged into the one above it: kept empty, its line under the first.
        const cont = merge != null && val(merge) !== "restart";
        const span = Number(val(kid(tcPr, "gridSpan")) ?? 1);
        const fill = hex(kid(tcPr, "shd")?.getAttributeNS(W, "fill"));
        const width = kid(tcPr, "tcW");
        const css: string[] = [];
        if (fill) css.push(`background:${fill}`);
        if (width?.getAttributeNS(W, "type") === "dxa") css.push(`width:${pt(width.getAttributeNS(W, "w"))}pt`);
        if (cont) css.push("border-top:none");
        html += `<td${span > 1 ? ` colspan="${span}"` : ""}${css.length ? ` style="${esc(css.join(";"))}"` : ""}>${cont ? "" : this.blocks(tc)}</td>`;
      }
      html += "</tr>";
    }
    return html + "</table>";
  }
}

/** The page's size and margins from the document's last section, as an @page rule. */
function pageRule(body: Element): string {
  const sect = kid(body, "sectPr");
  const size = kid(sect, "pgSz");
  const mar = kid(sect, "pgMar");
  const w = pt(size?.getAttributeNS(W, "w") ?? null) ?? 595.3;
  const h = pt(size?.getAttributeNS(W, "h") ?? null) ?? 841.9;
  const m = (side: string, fallback: number) => pt(mar?.getAttributeNS(W, side) ?? null) ?? fallback;
  return `@page{size:${w}pt ${h}pt;margin:${m("top", 72)}pt ${m("right", 72)}pt ${m("bottom", 72)}pt ${m("left", 72)}pt}`;
}

const BASE_CSS =
  "body{margin:0;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
  "p,h1,h2,h3,h4,h5,h6{margin:0;white-space:pre-wrap;overflow-wrap:break-word}" +
  "h1,h2,h3,h4,h5,h6{font-weight:normal;color:#2f5496;break-after:avoid}" +
  "h1{font-size:16pt;margin-top:12pt}h2{font-size:13pt;margin-top:2pt}h3{font-size:12pt;margin-top:2pt}" +
  ".mk{display:inline-block;min-width:18pt;text-indent:0}.tab{display:inline-block;min-width:36pt}" +
  ".pb{display:block;break-after:page}" +
  "table{border-collapse:collapse;margin:0 0 8pt}td{vertical-align:top;padding:0 5.4pt}" +
  "table.grid td{border:0.5pt solid #000}img{max-width:100%}";

/** A .docx as the body of an HTML page (its <style> first), ready to print. */
export async function docxToHtml(buf: ArrayBuffer): Promise<string> {
  const zip = unzip(buf);
  const doc = await xml(zip, "word/document.xml");
  const body = doc && kid(doc.documentElement, "body");
  if (!body) throw new Error("not a .docx");
  const rels = new Map<string, string>();
  const relsDoc = await xml(zip, "word/_rels/document.xml.rels");
  for (const rel of Array.from(relsDoc?.documentElement.children ?? [])) {
    rels.set(rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? "");
  }
  const styles = new Styles(await xml(zip, "word/styles.xml"));
  const converter = new Converter(zip, rels, styles, new Numbering(await xml(zip, "word/numbering.xml")));
  await converter.loadImages(body);
  const run = styles.defaultRun;
  const para = styles.resolve(null).para;
  const bodyCss =
    `body{font-family:${fontStack(run.font ?? "Calibri")};font-size:${run.size ?? 11}pt;` +
    `line-height:${((para.line ?? 1.08) * 1.17).toFixed(3)}}p{margin-bottom:${para.after ?? 8}pt}`;
  return `<style>${pageRule(body)}${BASE_CSS}${bodyCss}</style>${converter.blocks(body)}`;
}

/** Plain text on A4, as it was written: lines and spaces kept. */
export function textToHtml(text: string): string {
  return (
    "<style>@page{size:A4;margin:56pt}body{margin:0;font:11pt/1.4 Calibri,Arial,sans-serif;color:#000}" +
    `pre{margin:0;white-space:pre-wrap;overflow-wrap:break-word;font:inherit}</style><pre>${esc(text)}</pre>`
  );
}
