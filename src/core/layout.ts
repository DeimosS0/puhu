// Island geometry. All values are logical pixels.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName =
  | "overview"
  | "empty"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "confused"
  | "upload"
  | "uploading"
  | "choose"
  | "convert"
  | "quick"
  | "timerDone"
  | "usb"
  | "phone"
  | "mail"
  | "prompt"
  | "searching"
  | "result"
  | "note"
  | "settings"
  | "greeting"
  | "recap"
  | "wardrobe"
  | "update"
  | "whatsNew"
  | "focusIntro"
  | "puhuCard"
  | "badgeToast"
  | "shot"
  | "today";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

export type AgentLayoutMode = "none" | "grid" | "pills" | "column";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred
  botDiameter: number;
  agentMode: AgentLayoutMode;
}

// The window is a fixed 720×320 (largest view); the island is
// drawn inside it, glued to the top edge and horizontally centred.
export const PANEL_W = 720;
export const PANEL_H = 320;

// No notch on a PC: these are the hidden/compact sizes.
export const NOTCH_W = 184;
export const NOTCH_H = 32;
export const COMPACT_W = 288; // NOTCH_W + 104
export const EXPANDED_W = 640;

export const ROUNDED_CORNER = 14; // hidden / compact
export const EXPANDED_CORNER = 22;

/** Invisible hover strip that wakes the island when hidden. */
export const WAKE_STRIP_W = 240;
export const WAKE_STRIP_H = 6;

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  overview: { height: 160, botX: 68, botY: null, botDiameter: 58, agentMode: "pills" },
  empty: { height: 160, botX: 70, botY: null, botDiameter: 62, agentMode: "none" },
  approval: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  question: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  error: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  finished: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  confused: { height: 160, botX: 76, botY: null, botDiameter: 66, agentMode: "column" },
  upload: { height: 176, botX: 140, botY: 104, botDiameter: 62, agentMode: "column" },
  // botY 103 = bar top (42 + 58) + 3, so the dot really rides the bar.
  uploading: { height: 176, botX: 46, botY: 103, botDiameter: 20, agentMode: "none" },
  choose: { height: 176, botX: 60, botY: 101, botDiameter: 52, agentMode: "column" },
  // A PDF or a smaller picture being made from the drop, then made (views/convert.ts).
  convert: { height: 176, botX: 60, botY: 101, botDiameter: 52, agentMode: "none" },
  // The line pulled down from the island: a timer or a thing to do (views/quick.ts).
  quick: { height: 150, botX: 58, botY: null, botDiameter: 50, agentMode: "none" },
  // A timer rang: Puhu holds up what is ready (views/quick.ts).
  timerDone: { height: 150, botX: 62, botY: null, botDiameter: 58, agentMode: "none" },
  // The USB drives plugged in, with Open and Eject safely (views/usb.ts).
  usb: { height: 160, botX: 58, botY: null, botDiameter: 52, agentMode: "none" },
  // Send to phone, or from it (views/phone.ts): Puhu holding up the QR code like a sign.
  phone: { height: 230, botX: 60, botY: 160, botDiameter: 50, agentMode: "none" },
  mail: { height: 240, botX: 56, botY: null, botDiameter: 46, agentMode: "column" },
  prompt: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  searching: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  result: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  note: { height: 160, botX: 60, botY: null, botDiameter: 50, agentMode: "column" },
  settings: { height: 160, botX: 54, botY: null, botDiameter: 46, agentMode: "none" },
  greeting: { height: 150, botX: 320, botY: 90, botDiameter: 0, agentMode: "none" },
  // The week's time and its bars beside the numbers and the lines with top agent,
  // project, longest session, permissions and questions.
  recap: { height: 240, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  wardrobe: { height: 160, botX: 68, botY: null, botDiameter: 58, agentMode: "none" },
  // New version: Puhu on the left, the version and Update now.
  update: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "none" },
  // After an update: what the new version brings, then "Your Puhu so far".
  // Taller than a card, for two rows of items with their line.
  whatsNew: { height: 222, botX: 62, botY: null, botDiameter: 58, agentMode: "none" },
  // Focus play's first question (island/focus-intro.ts): Puhu on the left, a little
  // taller for the row of daily goals.
  focusIntro: { height: 176, botX: 62, botY: null, botDiameter: 58, agentMode: "none" },
  // Puhu's card (views/puhucard.ts): his level, the streak, today, the badges, the goal.
  puhuCard: { height: 222, botX: 62, botY: null, botDiameter: 58, agentMode: "none" },
  // A badge or a level just earned (views/badgetoast.ts), for a few seconds.
  badgeToast: { height: 150, botX: 62, botY: null, botDiameter: 58, agentMode: "none" },
  // The screenshot viewer: island.ts sizes it to the picture and puts Puhu beside it.
  shot: { height: 292, botX: 570, botY: 42, botDiameter: 40, agentMode: "none" },
  // Today's list (views/today.ts): Puhu on the left, the day's things and the line to write one.
  today: { height: 250, botX: 62, botY: null, botDiameter: 54, agentMode: "none" },
};

// The upload views above are only the fallback geometry. Once a file is actually
// dropped the whole sequence — Puhu included — is drawn by src/upload, which
// owns its own constants (USC).

/** The question view with options to pick from: room for two rows of them. */
export const QUESTION_PICKER_H = 200;

/** Chat view grows with the conversation — IslandContainer.chatPromptHeight. */
export function chatPromptHeight(messageCount: number): number {
  return Math.min(300, 240 + messageCount * 40);
}

export function islandSize(
  mode: IslandMode,
  view: IslandViewName,
  chatCount = 0,
): { w: number; h: number } {
  switch (mode) {
    case "hidden":
      // No notch to hide inside on a PC: the island retracts to zero height and
      // slides into the top edge of the screen instead of sitting there as a bar.
      return { w: NOTCH_W, h: 0 };
    case "compact":
      return { w: COMPACT_W, h: NOTCH_H };
    case "expanded": {
      const h = view === "prompt" ? chatPromptHeight(chatCount) : VIEW_LAYOUTS[view].height;
      return { w: EXPANDED_W, h };
    }
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** IslandRootView.botPosition — cy is measured from the island's top edge. */
export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
  uploadProgress = 0,
): BotPlacement {
  switch (mode) {
    case "hidden":
      return { cx: 46, cy: 16, diameter: 6, opacity: 0 };
    case "compact":
      return { cx: 40, cy: 16, diameter: 20, opacity: 1 };
    case "expanded": {
      const layout = VIEW_LAYOUTS[view];
      if (view === "uploading") {
        return {
          cx: 36 + uploadProgress * 526,
          cy: layout.botY ?? 103,
          diameter: layout.botDiameter,
          opacity: 1,
        };
      }
      if (layout.botY != null) {
        return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: 1 };
      }
      // Centre of the fixed 84 pt card (8 pt top inset + 34 pt header → content at y = 42)
      const headerBottom = 42;
      const cardH = 84;
      const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
      return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
    }
  }
}

export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case "working":
      return "#3B9EFF";
    case "thinking":
      return "#A78BFA";
    case "searching":
      return "#6366F1";
    case "approval":
      return "#F5A524";
    case "error":
      return "#F4505E";
    case "finished":
      return "#34D399";
    case "ratelimit":
      return "#F59E0B";
    default:
      return "#FFFFFF";
  }
}

export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case "idle":
    case "sleeping":
      return 0.15;
    case "dizzy":
      return 0;
    default:
      return 0.65;
  }
}

// Project colours: the same name always gets the same one.
const PROJECT_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function colorForProject(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

// Card wash colours (CardBackground.washColor)
export type Wash = "red" | "green" | "pink" | "amber" | "cyan" | "indigo" | "soft" | null;

export function washRGBA(wash: Wash): string {
  switch (wash) {
    case "red":
      return "rgba(244,80,94,0.55)";
    case "green":
      return "rgba(52,211,153,0.5)";
    case "pink":
      return "rgba(244,114,182,0.55)";
    case "amber":
      return "rgba(245,165,36,0.42)";
    case "cyan":
      return "rgba(34,211,238,0.38)";
    case "indigo":
      return "rgba(99,102,241,0.5)";
    case "soft":
      return "rgba(255,255,255,0.08)";
    default:
      return "rgba(0,0,0,0)";
  }
}
