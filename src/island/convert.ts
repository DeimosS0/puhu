// Dropped files made into what they are wanted as (src-tauri/src/convert.rs): the choose
// card's "Make a PDF", "Make it smaller" and "Make a JPG". The island shows it being made
// and what came out (views/convert.ts). A Word document or plain text becomes HTML here
// first (core/docx.ts, loaded only then) and Edge prints it.

import { Bridge, type Converted } from "../core/bridge";
import { State, type Converting } from "../core/state";

const PICTURE = /\.(jpe?g|jfif|png|gif|bmp|webp|heic|heif|tiff?)$/i;
const JPEG = /\.(jpe?g|jfif)$/i;
const DOCX = /\.docx$/i;
const TEXT = /\.(txt|md|markdown|csv|log)$/i;
/** However quick the work, the pages take this long to land beside Puhu (a photo, to be wrung out). */
const MIN_SHOW_MS: Record<Converting["kind"], number> = { pdf: 1100, small: 1600, jpg: 1100 };

export type ConvertKind = Converting["kind"];

export interface ConvertHost {
  /** The making view comes up. */
  show(): void;
  /** It is made: Puhu's moment. */
  made(): void;
  failed(): void;
}

/** What the dropped files can be made into: the choose card's buttons, in their order. */
export function offers(paths: readonly string[]): ConvertKind[] {
  if (paths.length === 0) return [];
  if (paths.every((p) => PICTURE.test(p))) {
    if (paths.length > 1) return ["pdf"];
    return JPEG.test(paths[0]) ? ["pdf", "small"] : ["pdf", "small", "jpg"];
  }
  return paths.length === 1 && (DOCX.test(paths[0]) || TEXT.test(paths[0])) ? ["pdf"] : [];
}

/** One picture dropped: Copy text is offered beside what it can be made into. */
export function onePicture(paths: readonly string[]): boolean {
  return paths.length === 1 && PICTURE.test(paths[0]);
}

let runs = 0;

/** A new drop: whatever was being made is forgotten (its result still lands on disk). */
export function forgetConverting() {
  runs++;
  State.converting = null;
}

export async function convert(kind: ConvertKind, host: ConvertHost) {
  const run = ++runs;
  const paths = [...State.droppedPaths];
  const pictures = paths.length > 0 && paths.every((p) => PICTURE.test(p));
  State.converting = { kind, pages: pictures ? paths.length : 0, done: null, error: null };
  host.show();
  const started = performance.now();
  let done: Converted | null = null;
  let error: string | null = null;
  try {
    done =
      kind !== "pdf" ? await Bridge.convertImage(paths[0], kind)
      : pictures ? await Bridge.convertImagesPdf(paths)
      : await documentPdf(paths[0]);
    await new Promise((r) => window.setTimeout(r, Math.max(0, MIN_SHOW_MS[kind] - (performance.now() - started))));
  } catch (err) {
    error = String(err).replace(/^Error:\s*/, "");
  }
  if (run !== runs || !State.converting) return;
  State.converting = { ...State.converting, done, error, pages: done?.pages || State.converting.pages };
  if (done) host.made();
  else host.failed();
  State.notify();
}

async function documentPdf(path: string): Promise<Converted> {
  const { docxToHtml, textToHtml } = await import("../core/docx");
  const bytes = await Bridge.convertRead(path);
  const html = DOCX.test(path) ? await docxToHtml(bytes) : textToHtml(new TextDecoder().decode(bytes));
  return Bridge.convertHtmlPdf(path, html);
}
