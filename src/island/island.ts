// The island: DOM shell, sizing animation, Puhu placement, mouse handling.

import { Ease, Tracked, Spring, clamp } from "../core/anim";
import { Bridge, IS_TAURI, onDragDrop, onEvent } from "../core/bridge";
import {
  CLOSED_BOT_D, CLOSED_H, closedContent, closedFigure, closedIsland, closedWidth, type ClosedContent,
} from "../core/closed";
import {
  COMPACT_W, EXPANDED_CORNER, EXPANDED_W, NOTCH_W, PANEL_H, PANEL_W,
  ROUNDED_CORNER, VIEW_LAYOUTS, botGlowColor, botGlowOpacity, botPosition, chatPromptHeight,
  islandSize,
  QUESTION_PICKER_H,
  type BotEmoteName, type IslandMode, type IslandViewName,
} from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { HOST_OS } from "../core/pills";
import { NOWPLAYING_ID, NowPlaying, SPOTIFY_ID, Spotify, currentArtwork, islandDances, type Player } from "../core/spotify";
import { songs } from "./spotify";
import { BotEngine, hexToRGB } from "../puhu/engine";
import { MusicPulse } from "../core/beat";
import { CoverColor } from "../core/cover-color";
import { POMODORO_ID, Pomodoro, formatRemaining, type PomodoroPhase } from "../core/pomodoro";
import { FocusIntro } from "./focus-intro";
import { awardSecret, progress } from "./progress";
import { Toast } from "./toast";
import { KONAMI_LENGTH, copiedSecret, konamiStep } from "../core/secrets";
import { flameTier, type Moment } from "../core/progress";
import { QUESTS } from "../core/quests";
import { eggText } from "../views/puhucard";
import { EGG_ICON, FEATHER_ICON, FLAME_COLOR, SHIELD_ICON, flame } from "../views/flame";
import { POMODORO_COLOR } from "../views/pomodoro";
import { readCopied, type CopiedKind } from "../core/copied";
import { Greeting } from "../puhu/greeting";
import { createMiniBot, pruneMiniBots, syncMiniBotStates, tickMiniBots } from "../puhu/minibots";
import { UploadCanvas } from "../upload/canvas";
import { USC, UploadSeq } from "../upload/sequence";
import { dominantPct, planColor } from "../core/plan";
import { language, t, tl, tn } from "../i18n/i18n";
import { claudeCompactPillVisible, closePlanCard } from "../views/usage";
import { buildHeader, buildViews, type ViewActions, type ViewHost } from "../views/views";
import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { IslandStateMachine } from "./fsm";
import { refreshHookPills } from "./integrations";
import { restoreAlertFocus } from "./hooks";
import { DesktopLink } from "./desktop";
import type { ViewCommand } from "./shortcuts";
import { DRAG_THRESHOLD } from "../puhu/desktop-logic";
import { Today } from "../views/today";
import { dayKey } from "../core/today";
import { Updates } from "./update";
import { UPDATE_BLUE, showsUpdateHint } from "../whats-new/whats-new";

const BOT_OVERHANG = 40;
/** The music bars' canvas, CSS pixels. */
const BARS_W = 30;
const BARS_H = 15;
/** Each beat's shape across the six bars, taken in turn. */
const BAR_CONTOURS = [
  [0.5, 0.85, 1, 0.7, 0.45, 0.3],
  [0.3, 0.55, 0.8, 1, 0.75, 0.45],
  [0.45, 0.9, 0.6, 0.85, 1, 0.5],
  [0.6, 1, 0.75, 0.55, 0.8, 0.4],
] as const;
/** Folded, the waves are all that moves: 12 frames a second still read as a wave, and each frame costs (the whole window is composited again). */
const CLOSED_MUSIC_FRAME_MS = 1000 / 12;
/** How long the volume indicator stays after the last change, seconds. */
const VOLUME_SECONDS = 1.6;
/** A new song's moment in the island. */
const SONG_SECONDS = 3;
/** And the battery indicator, after the charger is plugged in or out. */
const POWER_SECONDS = 2.6;
/** The screenshot peek: the picture's largest size, the black around it, how long it stays. */
const SHOT_W = 260;
const SHOT_H = 146;
const SHOT_PAD = 10;
const SHOT_SECONDS = 4.5;
/** The viewer a click on the peek opens: the picture's largest size, the column beside it. */
const VIEW_IMG_W = 476;
const VIEW_IMG_H = 268;
const VIEW_SIDE = 140;
const VIEW_PAD = 12;
const VIEW_MIN_W = 400;
const VIEW_MIN_H = 176;
const SAVE_ICON = "M12 3a1 1 0 0 1 1 1v8.6l2.8-2.8a1 1 0 1 1 1.4 1.4l-4.5 4.5a1 1 0 0 1-1.4 0l-4.5-4.5a1 1 0 1 1 1.4-1.4L11 12.6V4a1 1 0 0 1 1-1zM5 15a1 1 0 0 1 1 1v2.5c0 .3.2.5.5.5h11c.3 0 .5-.2.5-.5V16a1 1 0 1 1 2 0v2.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5V16a1 1 0 0 1 1-1z";
/** What may come over a card waiting for its answer: a permission or a question (an agent waits on it), and a file being dropped (its own scene). */
const OVER_WAITING: ReadonlySet<IslandViewName> = new Set(["approval", "question", "upload", "uploading", "choose"]);
/** How much wider the compact island grows for each indicator. */
const HUD_EXTRA_W = { volume: 44, power: 40, pomodoro: 70, shot: 0 } as const;
/** The indicators' boxes, CSS pixels (style.css gives them these sizes). */
const VOLUME_HUD_W = 138;
const POWER_HUD_W = 76;
/** The running Pomodoro in the compact island; wider with the streak's flame beside it. */
const POMODORO_W = 72;
const POMODORO_STREAK_W = 30;
/** Focus play's moments (Island.celebrate): each one's time in the island. They come
 *  as soon as the peek before them (the Pomodoro's phase, the volume, Caps Lock…) is
 *  over; a little later while the island is open, a question waits for its answer, or
 *  a full-screen app or a presentation is up. */
const MOMENT_SECONDS = 2.8;
const MOMENT_POLL_MS = 250;
const MOMENT_RETRY_MS = 1200;
const MOMENT_PRESENTING_MS = 4000;
/** A badge or a level opens the island on it for this long (views/badgetoast.ts). */
const TOAST_SECONDS = 4.2;
const STAR_ICON = "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z";
const SHIELD_COLOR = "#8fd3ff";
/** Holding Puhu opens his card: a press longer than a tap starts a ring round him, and
 *  the card opens once it is full. */
const HOLD_DELAY_MS = 220;
const HOLD_FILL_MS = 520;
/**
 * What a surprise shows in the island itself, each time it happens (core/secrets.ts): a
 * line in its colour, with its own little move. The volume, Caps Lock, a screenshot and
 * a dizzy Puhu show theirs where they already are.
 */
const SPARKLE_ICON = "M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5z";
const HEART_ICON = "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z";
const SURPRISE_PEEKS: Record<string, { icon: string; line: () => string; color: string; move: string }> = {
  friend: { icon: HEART_ICON, line: () => t("A thousand pokes! Friends now"), color: "#ff8fb1", move: "love" },
  noticed: { icon: HEART_ICON, line: () => t("That's me!"), color: "#ff8fb1", move: "love" },
  missed: { icon: HEART_ICON, line: () => t("I missed you!"), color: "#ff8fb1", move: "love" },
  hello: { icon: SPARKLE_ICON, line: () => t("Hello to you too!"), color: "#7ee0a1", move: "pop" },
  danger: { icon: "M12 4l9 16H3L12 4zM12 10v4M12 17v.5", line: () => t("Careful with that one!"), color: "#ff6b6b", move: "shake" },
  mirror: { icon: SPARKLE_ICON, line: () => t("Is that me?"), color: "#c7cbd3", move: "pop" },
  wish: { icon: SPARKLE_ICON, line: () => t("11:11, make a wish"), color: "#ffd166", move: "glow" },
  leet: { icon: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12", line: () => t("13:37, elite hour"), color: "#7ee0a1", move: "glow" },
  moon: { icon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z", line: () => t("A full moon tonight"), color: "#e8e3c8", move: "glow" },
  konami: { icon: "M6 9h12a3 3 0 0 1 3 3v2a3 3 0 0 1-5.2 2L14 14h-4l-1.8 2A3 3 0 0 1 3 14v-2a3 3 0 0 1 3-3zM7.5 11v3M6 12.5h3", line: () => `↑↑↓↓←→←→BA · ${t("Old school!")}`, color: "#7ee0a1", move: "pop" },
  intime: { icon: "M13 3L5 13h6l-1 8 8-10h-6l1-8z", line: () => t("Just in time!"), color: "#ffb340", move: "pop" },
  tinkerer: { icon: "M14.5 5.5a4 4 0 0 0-5 5L4 16v4h4l5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5 2.5-2.5z", line: () => t("Settings again?"), color: "#c7cbd3", move: "pop" },
  caught: { icon: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", line: () => t("I saw that"), color: "#c084fc", move: "swap" },
  april: { icon: SPARKLE_ICON, line: () => t("Happy April Fools'!"), color: "#ffd166", move: "flip" },
  newyear: { icon: SPARKLE_ICON, line: () => t("Happy New Year!"), color: "#ffd166", move: "glow" },
  programmer: { icon: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12", line: () => t("Happy Programmer's Day!"), color: "#7ee0a1", move: "glow" },
};
/** Pokes kept across launches, for the thousandth (a convenience of this install). */
const POKES_KEY = "puhu.pokes";
/** Caps Lock turned over this many times this quickly is shouting. */
const SHOUT_TOGGLES = 6;
const SHOUT_MS = 4000;
const POMODORO_HUD_W = 168;
const HUD_H = 18;
/** Folded, an indicator stretches the closed island round itself, this tall, with this much room on each side. */
const CLOSED_PEEK_H = 30;
const CLOSED_PEEK_PAD = 14;
/** The privacy dot's colours, and the icons of the notes. */
const CAMERA_COLOR = "#6ccb5f";
const MIC_COLOR = "#ffb340";
const MIC_ICON = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm-6.5 8.5a.9.9 0 0 1 1.8 0 4.7 4.7 0 0 0 9.4 0 .9.9 0 0 1 1.8 0 6.5 6.5 0 0 1-5.6 6.43V20h2.4a.9.9 0 0 1 0 1.8H8.7a.9.9 0 0 1 0-1.8h2.4v-2.07A6.5 6.5 0 0 1 5.5 11.5z";
// Caps Lock's key, the network and a download: drawn with a stroke (svg(…, { stroke })).
const GAMEPAD_ICON = "M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8l-1.1-1.3h-5l-1.1 1.3A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4zM7.5 10.5v3M6 12h3M15.5 11.5h.01M17.5 13h.01";
/** How long Puhu waves "Have a good game!" before stepping aside. */
const GAME_WAVE_S = 1.8;
const GAME_COLOR = "#a78bfa";
/** Guard mode's welcome back: a shield. */
const GUARD_ICON = "M12 3.5 5 6.5v5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9v-5zM9 12l2.2 2.2L15.5 10";
const GUARD_COLOR = "#7dd3fc";
/** On guard the closed island is his lane, this wide; he turns this far from its ends. */
const GUARD_W = 168;
const GUARD_END = 16;
/** One walk down the lane, and the wait for it to open before the first. */
const GUARD_LEG_MS = 4600;
const GUARD_FIRST_MS = 1200;
/**
 * Nobody watches while he is on guard, so he walks now and then, not all the time: one
 * walk, then he stands this long; and only while agents work and this long after the
 * last hook, then he stands at his post. A frame of the island costs the most in
 * WebView2's GPU process: walking all the time was a quarter of a core.
 */
const GUARD_STAND_MS = 20_000;
const GUARD_LINGER_MS = 2 * 60_000;
const GUARD_FRAME_MS = 1000 / 24;
/** Someone is back: how long he stands startled, his lantern flashing, before he knows them. */
const GUARD_ALERT_MS = 750;
/** The morning's peek, once a day: what there is to do today. */
const MORNING_KEY = "puhu.todayMorning";
const MORNING_S = 4.5;
const TODAY_COLOR = "#ffd166";
/** The evening's word on the day, once, from this hour: how it went, what goes to tomorrow. */
const EVENING_KEY = "puhu.todayEvening";
const EVENING_HOUR = 18;
/** Hidden away (Settings → the closed island: hidden), the island is a drop this wide at the top edge. */
const DROP_W = 34;
/** Coming out, the drop swells round this wide for this long before it spreads. */
const DROP_BEAD_W = 46;
const DROP_BEAD_MS = 130;
/** Narrower than this, a drop shows nothing of what it holds. */
const DROP_NARROW_W = 170;
/** The evening ember's word: once a day, from the reminder's time, while the streak waits. */
const EMBER_KEY = "puhu.emberTold";
const CAPS_ICON = "M12 4 4.5 11.5H8.5V16h7v-4.5h4zM8.5 19.5h7";
const ONLINE_ICON = "M2.8 9a13.5 13.5 0 0 1 18.4 0M5.8 12.3a9 9 0 0 1 12.4 0M8.9 15.6a4.6 4.6 0 0 1 6.2 0M12 19.2h.01";
const OFFLINE_ICON = "M5.8 12.3a9 9 0 0 1 5-2.4M15.3 10.3a9 9 0 0 1 2.9 2M8.9 15.6a4.6 4.6 0 0 1 6.2 0M12 19.2h.01M2.8 9a13.5 13.5 0 0 1 4-2.6M4 4l16 16";
// What was copied: a link, an address, several lines, a secret, any other text.
const COPIED_ICONS: Record<Exclude<CopiedKind, "color">, string> = {
  link: "M10.2 13.8a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M13.8 10.2a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1",
  email: "M4 6.5h16v11H4zM4.5 7.5l7.5 5.5 7.5-5.5",
  error: "M12 4.5 3.5 19h17zM12 10v4.2M12 16.6v.4",
  multiline: "M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5.5l-3 13",
  secret: "M7.5 11V8.5a4.5 4.5 0 0 1 9 0V11M5.5 11h13v9h-13z",
  text: "M9 9h10.5v10.5H9zM5 15V4.5h10.5",
};
const DOWNLOAD_ICON = "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14";
const NETWORK_COLOR = { online: "#6ccb5f", offline: "#ff99a4" } as const;
/** Lost for this long before the island says so: a blip says nothing. */
const OFFLINE_AFTER_MS = 3000;
const CAMERA_ICON = "M4.5 6.5h9a2 2 0 0 1 2 2v1.6l3.6-2.4c.7-.5 1.4 0 1.4.8v7c0 .8-.7 1.3-1.4.8l-3.6-2.4v1.6a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z";
const HEADPHONES_ICON = "M12 3.5a8.5 8.5 0 0 0-8.5 8.5v5.5a2.5 2.5 0 0 0 2.5 2.5h1a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 7 13H5.3v-1a6.7 6.7 0 0 1 13.4 0v1H17a1.5 1.5 0 0 0-1.5 1.5v4A1.5 1.5 0 0 0 17 20h1a2.5 2.5 0 0 0 2.5-2.5V12A8.5 8.5 0 0 0 12 3.5z";
const RING = 2 * Math.PI * 7.2;

/** `v` CSS pixels, moved to the nearest whole device pixel. */
function snapPx(v: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(v * dpr) / dpr;
}

/** Plays a class's CSS animation again, even while the class is already on. */
function replay(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
/** Frame pacing while only Puhu's own loops play (breathing, blinks, mini Puhus):
 *  no faster than a 60 Hz screen, 10 % short. A
 *  144–240 Hz screen drew the resting island 2–4 times as often for the same motion;
 *  folding, opening and Puhu moving keep the display's rate. */
const AMBIENT_FRAME_MS = (1000 / 60) * 0.9;
/** Puhu doing nothing but breathe and blink: no faster than a 30 Hz screen. */
const RESTING_FRAME_MS = (1000 / 30) * 0.9;
const UPDATE_BLUE_RGB = hexToRGB(UPDATE_BLUE);
const CLAUDE_DESKTOP_ID = "agent_claude-desktop";
/** Extra canvas on each side of Puhu, for the witch hat's brim and the Santa hat's tip. */
const BOT_SIDE = 24;
/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
const HIT_MARGIN = 14;

/** The three views the drop sequence owns; leaving them stops the engine. */
const UPLOAD_VIEWS: ReadonlySet<IslandViewName> = new Set(["upload", "uploading", "choose"]);

/** Seconds between the drop and the moment the progress bar starts filling. */
const PRE_PROGRESS = USC.T_PROG_START - USC.T_DROP;
/** How long the choose card waits for an answer, with the pointer away, before it folds. */
const CHOOSE_WAIT_S = 8;
/** A file dragged out of the island and not back within this: put down elsewhere. */
const DRAG_GONE_MS = 1200;

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

export class Island {
  readonly fsm = new IslandStateMachine();
  /** Puhu on the desktop: his life cycle and the drag out of the island. */
  readonly desktop: DesktopLink;

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private clipEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  /** The music's bars in the compact island while Puhu dances, in the cover's colour. */
  private musicBars!: HTMLCanvasElement;
  /** The volume indicator in the compact island, for a moment after the volume changes. */
  private volumeHud!: HTMLElement;
  private volumeFill!: HTMLElement;
  private volumeWaves: SVGElement[] = [];
  private volumeMute!: SVGElement;
  /** The battery indicator, for a moment after the charger is plugged in or out. */
  private powerHud!: HTMLElement;
  private powerText!: HTMLElement;
  private hudTimer: number | null = null;
  /** Game mode's wave, before the island steps aside. */
  private gameTimer: number | null = null;
  /** Ask the screen called Puhu in from a game: game mode resumes when the island closes. */
  private gameHeld = false;
  /** The indicator on show, if any: the compact island stretches to make room for it. */
  private hudKind: "volume" | "power" | "pomodoro" | "info" | "shot" | null = null;
  /** The note in the compact island (Island.showInfo) and how wide its line is. */
  private infoHud!: HTMLElement;
  private infoIcon!: HTMLElement;
  private infoText!: HTMLElement;
  private infoW = 0;
  private musicWas = false;
  /** The cover of the song on show, one image for all of them. */
  private coverImg = h("img", { class: "cover", alt: "" });
  private coverTimer: number | null = null;
  private songAt = 0;
  /** What a click on the note does while it shows (a download: its folder). */
  private infoAction: (() => void) | null = null;
  /** Focus play's moments waiting for their turn, and the timer of the next one. */
  private moments: Moment[] = [];
  private momentTimer: number | null = null;
  /** The streak's flame beside the running Pomodoro, redrawn only when it changes. */
  private pomodoroStreak!: HTMLElement;
  private pomodoroStreakKey = "";
  private pomodoroW = POMODORO_W;
  /** A press on Puhu with focus play on: a tap pokes him on release, a hold opens his card. */
  private hold: { timer: number; filling: boolean } | null = null;
  private holdRing!: SVGSVGElement;
  /** What the surprises listen for (core/secrets.ts): the volume last shown, Caps Lock's
   *  last turns, how far into the Konami code the keys are. */
  private lastVolume = -1;
  private volumeSpark!: HTMLElement;
  private toastTimer: number | null = null;
  private capsTurns: number[] = [];
  private konami = 0;
  private offlineTimer: number | null = null;
  private offlineShown = false;
  /** Whose song the note shows, while it does. */
  private songShown: Player | null = null;
  /** The privacy dot, and who had the camera and the microphone at the last report. */
  private privacyDot!: HTMLElement;
  private privacyApps: { mic: string[]; camera: string[] } = { mic: [], camera: [] };
  /** The screenshot peek: the picture, its kept file, its size on screen. */
  private shotEl!: HTMLElement;
  private shotImg!: HTMLImageElement;
  private shotName = "";
  private shotSize = { w: SHOT_W, h: SHOT_H };
  private shotThumb = "";
  private shotPx = { w: 0, h: 0 };
  private shotSaved = false;
  /** The viewer: its size, the picture's place in it, and the peek it grows from. */
  private viewSize = { w: VIEW_MIN_W, h: VIEW_MIN_H, img: { left: 0, top: 0, w: 0, h: 0 } };
  private viewFrom = { left: 0, top: 0, w: 0, h: 0, islandH: 0 };
  private viewSide!: HTMLElement;
  private viewMeta!: HTMLElement;
  private viewSave!: HTMLButtonElement;
  private wasViewing = false;
  /** A running Pomodoro in the compact island: its ring and what is left. */
  private pomodoroEl!: HTMLElement;
  private pomodoroRing!: SVGElement;
  private pomodoroTime!: HTMLElement;
  /** The phase change, for a moment: what begins and how long it lasts. */
  private pomodoroHud!: HTMLElement;
  private pomodoroHudText!: HTMLElement;
  private barLevels = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2];
  private barVels = [0, 0, 0, 0, 0, 0];
  /** Each band's recent level: a bar rises when its part of the music does. */
  private barAvgs = [0, 0, 0, 0, 0, 0];
  private barsAt = 0;
  /** The folded window is growing back: the island waits out of sight (see updateWindowCollapsed). */
  private growing = false;
  private pendingOpen = false;
  private greetingCanvas!: HTMLCanvasElement;
  private miniGrid!: HTMLElement;
  private clockEl!: HTMLElement;
  private clockTimer?: number;
  /** The closed island's one line (core/closed.ts), and what it last showed. */
  private closedEl!: HTMLElement;
  private closedDot!: HTMLElement;
  private closedText!: HTMLElement;
  private closedKey = "";
  /** Width of the closed island for what it shows now. */
  private closedW = 120;
  /** Puhu's little life in the closed island: where he looks, and until when
   *  the loop runs for what he is doing (a blink, a glance). */
  private closedLook = { x: 0, y: 0 };
  private closedAwakeUntil = 0;
  private closedLife: number | null = null;
  /**
   * Guard mode's patrol (setAway): the lane is out; where he is along it (0…1); the walk
   * he is on, or until when he stands; the last agent hook.
   */
  private guardLane = false;
  private guard = { pos: 0.5, leg: null as { from: number; to: number; at: number } | null, until: 0, seen: 0 };
  private guardTimer: number | null = null;
  /** Caught by surprise: his lantern flashes until then. */
  private guardFlashUntil = 0;
  /** A headphone just connected: he wears a pair until then. */
  private phonesUntil = 0;
  /** Bumped by every move of the island's size: a drop's spread waiting for it is called off. */
  private dropToken = 0;
  /** The size the window was last folded to, so a new one is only sent on a change. */
  private collapsedTo = { w: 0, h: 0 };
  private countdown!: HTMLElement;
  private compactPlan!: HTMLElement;
  private compactPlanDot!: HTMLElement;
  private compactPlanLabel!: HTMLElement;
  private wakeStrip!: HTMLElement;

  private header!: ViewHost;
  private views!: Map<IslandViewName, ViewHost>;
  private uploadCanvas!: UploadCanvas;

  private width = new Tracked(NOTCH_W);
  private height = new Tracked(0);
  private radius = new Tracked(ROUNDED_CORNER);
  private botCx = new Spring(46);
  /** The closed island's middle he was last carried to, once he sits there. */
  private closedCentre: { x: number; y: number } | null = null;
  private botCy = new Spring(16);
  private botSize = new Spring(10);

  private engine = new BotEngine();
  private greeting = new Greeting();
  private greetingShown = false;

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;
  /** The pixel ratio Puhu's bitmap was sized for: it changes with the monitor. */
  private canvasDpr = 0;

  // Rust starts the window at full size so the launch greeting has room.
  private collapsed = false;
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  private dragGone: number | null = null;
  /** A reply is being typed in a card (WhatsApp): the island stays open. */
  private holdingOpen = false;
  /** Last shape handed to Rust for the click-through test. */
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };

  // Bot hover → love (IslandWindowController.botHoverIn)
  private botHovering = false;
  private botHoverTimer: number | null = null;
  private lastLoveTime = 0;
  private botHoverStart = { x: 0, y: 0 };

  private confusedRecovery: number | null = null;
  private prevViewBeforeConfused: IslandViewName = "overview";
  private lastSyncedView: IslandViewName | null = null;

  /** The launch greeting ended, or the island came out of hidden — two of the
   *  moments the Monday recap may open (see src/recap/recap.ts). */
  onGreetingDone: (() => void) | null = null;
  onWake: (() => void) | null = null;

  /** Where a press on Puhu started: moving past DRAG_THRESHOLD drags him out. */
  private botPress: { x: number; y: number } | null = null;

  /** The next reveal from hidden makes no peek (music starting). */
  private silentReveal = false;

  /** Drop sequence bookkeeping: last tick played, and whether the ✓ has fired. */
  private uploadTens = 0;
  private uploadDone = false;

  constructor(root: HTMLElement) {
    this.root = root;
    // At the top of the screen he dances low: a sway and a small hop, never a jump.
    this.engine.danceHop = 0.35;
    this.desktop = new DesktopLink({
      reveal: () => this.reveal(),
      wardrobeFromDesktop: () => this.wardrobeFromDesktop(),
      dizzyFromDesktop: () => this.handleDizzy(),
    });
    this.build();
    this.wireFsm();
    this.wireInput();
    this.scheduleIdleLife();
    this.engine.onDizzy = () => this.handleDizzy();
    this.greeting.onComplete = () => {
      this.fsm.greetComplete();
      this.onGreetingDone?.();
    };
    State.subscribe(() => {
      this.dirty = true;
      this.ensureRunning();
    });
    this.scheduleEvening();
  }

  /** The evening's word, at EVENING_HOUR: one timer for the day, nothing polls. */
  private scheduleEvening() {
    const now = new Date();
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), EVENING_HOUR);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    window.setTimeout(() => {
      this.evening();
      this.scheduleEvening();
    }, at.getTime() - now.getTime() + 1000);
  }

  /**
   * Once an evening, when someone is at the computer (the hour coming, the screen back on,
   * back from away, the island woken): how the day went. All done, Puhu is proud; otherwise
   * he yawns and says what goes along to tomorrow. A click opens the list.
   */
  evening() {
    const now = new Date();
    const today = dayKey(now);
    let shown: string | null = null;
    try {
      shown = localStorage.getItem(EVENING_KEY);
    } catch {
      // Said again, at worst.
    }
    const { done, total } = Today.count();
    if (now.getHours() < EVENING_HOUR || shown === today || total === 0) return;
    if (State.paused || State.inGame || State.away || State.mode === "expanded" || this.hudKind) return;
    void Bridge.presenting().then((busy) => {
      if (busy || State.mode === "expanded" || this.hudKind) return;
      try {
        localStorage.setItem(EVENING_KEY, today);
      } catch {
        // As above.
      }
      const all = done === total;
      const text = all
        ? t("All done today!")
        : [t("Today {done}/{total}", { done, total }), t("For tomorrow: {count}", { count: total - done })].join(" · ");
      this.showInfo(svg(ICONS.checklist, 16, { stroke: 2 }), text, all ? "#6ccb5f" : TODAY_COLOR, 4.5);
      replay(this.infoHud, "unroll");
      this.infoAction = () => this.alert("today");
      if (all) {
        this.engine.triggerEmote("proud");
        this.engine.hopFlight();
      } else {
        this.engine.triggerEmote("yawn");
      }
      this.ensureRunning();
    });
  }

  /** The request has its answer: the card goes and the session carries on. */
  private closeApproval() {
    State.endApproval();
    if (State.pendingApproval) {
      const view = State.pendingApproval.questions ? "question" : "approval";
      this.setView(view);
      Sound.play(view);
      return;
    }
    // A question still waiting under it (focus play's first) keeps the island held.
    State.isPinned = this.fsm.pinned = State.waitingCard != null;
    this.setView(State.defaultView());
  }

  /**
   * Folds a card that is waiting for an answer down to the compact island,
   * without answering it. Nothing is decided: the request keeps
   * waiting, the island stays on screen, and opening it shows the card again.
   */
  foldApproval() {
    if ((!State.pendingApproval && !State.waitingCard) || State.mode !== "expanded") return;
    State.isPinned = true;
    this.fsm.pinned = true;
    this.fsm.forcePetit();
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    const actions: ViewActions = {
      setView: (v) => this.setView(v),
      cancelDrop: () => this.discardDrop(),
      collapse: () => this.collapse(),
      foldApproval: () => this.foldApproval(),
      setFocus: (id) => {
        State.setFocus(id);
        Sound.play("blip");
        // A pill with a waiting request opens on its card: going back to it
        // after looking at another pill brings the card up again.
        const req = State.pendingApproval;
        if (req?.pillId === id) this.setView(req.questions ? "question" : "approval");
      },
      openTerminal: () => {
        const task = State.focusTask;
        // Sessions from the Claude desktop app live there, not in a terminal.
        if (task?.id === CLAUDE_DESKTOP_ID) void Bridge.openClaudeDesktop();
        else void Bridge.openSession(task?.sessionId ?? null, task?.sessionCwd ?? null);
      },
      // The ↗ button.
      openTarget: () => {
        const task = State.focusTask;
        if (!task) return;
        const urls: Record<string, string> = {
          integration_resend: "https://resend.com/emails",
          integration_vercel: "https://vercel.com/dashboard",
          integration_github: "https://github.com/pulls",
          integration_stripe: "https://dashboard.stripe.com/payments",
          integration_notion: "https://notion.so",
          integration_calcom: "https://app.cal.com/bookings",
          // No WhatsApp app to bring forward here: WhatsApp Web, in the browser.
          integration_whatsapp: "https://web.whatsapp.com",
        };
        if (task.id === CLAUDE_DESKTOP_ID) void Bridge.openClaudeDesktop();
        else if (task.id === "integration_claude" || task.sessionId) {
          void Bridge.openSession(task.sessionId ?? null, task.sessionCwd ?? null);
        } else if (task.id === "integration_n8n") void Bridge.openN8n();
        else if (task.id === "integration_gitea") void Bridge.openGitea();
        else if (task.id === SPOTIFY_ID) void Bridge.spotifyOpen();
        else if (task.id === NOWPLAYING_ID) void Bridge.nowPlayingOpen();
        else if (urls[task.id]) void Bridge.openUrl(urls[task.id]);
      },
      openUrl: (url) => {
        if (url) void Bridge.openUrl(url);
      },
      decide: (d) => {
        const req = State.pendingApproval;
        void Bridge.log(`decide ${d} req=${req?.requestId ?? "none"}`);
        if (!req) return;
        Sound.play(d === "deny" ? "blip" : "approve");
        void Bridge.approvalDecision(req.requestId, d);
        this.closeApproval();
      },
      answer: (answers) => {
        const req = State.pendingApproval;
        if (!req) return;
        Sound.play("approve");
        void Bridge.approvalAnswer(req.requestId, answers);
        this.closeApproval();
      },
      answerInTerminal: () => {
        const req = State.pendingApproval;
        if (!req) return;
        Sound.play("blip");
        void Bridge.approvalDecline(req.requestId);
        this.closeApproval();
      },
      toggleSound: () => {
        State.settings.soundEnabled = !State.settings.soundEnabled;
        Sound.setEnabled(State.settings.soundEnabled);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      setVolume: (v) => {
        State.settings.soundVolume = v;
        Sound.setVolume(v);
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      setAutoClose: (s) => {
        State.settings.autoCloseInterval = s;
        this.fsm.homeToPetitDelay = s;
        void Bridge.saveSettings(State.settings);
        State.notify();
      },
      openSettingsWindow: () => {
        void Bridge.openSettingsWindow();
        let visits = 0;
        try {
          visits = (Number(localStorage.getItem("puhu.settingsVisits")) || 0) + 1;
          localStorage.setItem("puhu.settingsVisits", String(visits));
        } catch {
          // Not counted.
        }
        if (visits === 20) this.surprise("tinkerer");
      },
      blip: () => Sound.play("blip"),
      keyboard: (on) => {
        // The chat view manages the keyboard on its own.
        if (on) void Bridge.focusWindow(true);
        else if (State.view !== "prompt" && State.mode === "expanded") void Bridge.focusWindow(false);
      },
      holdOpen: (on) => {
        if (this.holdingOpen === on) return;
        this.holdingOpen = on;
        if (on) {
          this.fsm.pinned = true;
          this.fsm.cancelTimers();
        } else {
          this.fsm.pinned = State.isPinned || State.pendingApproval != null;
          if (!this.fsm.pinned && !this.wasInIsland && this.fsm.state === "home") this.fsm.mouseLeft();
        }
      },
      puhuAt: () => {
        const r = this.botCanvas.getBoundingClientRect();
        return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + BOT_OVERHANG / 2 + (r.height - BOT_OVERHANG) / 2 } : null;
      },
      todayReact: (kind) => this.todayReact(kind),
    };

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.closedDot = h("span", { class: "dot" });
    this.closedText = h("span", { class: "text" });
    this.closedEl = h("div", { id: "island-closed" }, this.closedDot, this.closedText);
    this.holdRing = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.holdRing.id = "hold-ring";
    this.holdRing.append(document.createElementNS("http://www.w3.org/2000/svg", "circle"));
    this.botGlow = h("div", { id: "bot-glow" });
    this.musicBars = h("canvas", { id: "music-bars" }) as HTMLCanvasElement;
    this.buildVolumeHud();
    this.buildPowerHud();
    this.buildPomodoro();
    this.buildInfoHud();
    this.shotImg = h("img", { alt: "" }) as HTMLImageElement;
    this.shotEl = h("div", { id: "shot" }, this.shotImg, h("div", { class: "flash" }));
    this.buildViewer();
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.miniGrid = h("div", { id: "mini-grid" });
    this.clockEl = h("div", { id: "island-clock" });
    this.countdown = h("div", { id: "countdown" });
    this.compactPlanDot = h("i", { class: "compact-plan-dot" });
    this.compactPlanLabel = h("span", { class: "compact-plan-label" });
    this.compactPlan = h(
      "button",
      {
        id: "compact-plan",
        title: tl("Claude plan usage"),
        onmousedown: (e) => {
          e.stopPropagation();
        },
        onclick: (e) => {
          e.stopPropagation();
          const me = e as MouseEvent;
          if (me.button === 0) this.openClaudePlan();
        },
      },
      this.compactPlanDot,
      this.compactPlanLabel,
    );

    this.header = buildHeader(actions);
    this.views = buildViews(actions, () => this.animateGeometry(false));
    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);

    // The drop sequence draws the card, the bar and its own Puhu. It sits under
    // the header, which stays visible on top of it.
    this.uploadCanvas = new UploadCanvas({
      ask: () => {
        State.promptContext = State.droppedFile
          ? { kind: "file", name: State.droppedFile.name, path: State.droppedFile.path }
          : null;
        this.setView("prompt");
      },
      cancel: () => this.discardDrop(),
    });

    this.clipEl = h(
      "div",
      { id: "island-clip" },
      this.greetingCanvas,
      // The drop scene too shows only inside the island: folding, it is cut, not left behind.
      h("div", { class: "upload-clip" }, this.uploadCanvas.el),
      this.contentEl,
      this.shotEl,
      this.viewSide,
    );
    this.islandEl = h(
      "div",
      { id: "island" },
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.miniGrid,
      this.musicBars,
      this.pomodoroEl,
      // The indicators show only inside the island: stretching, it uncovers them.
      h("div", { class: "hud-clip" }, this.volumeHud, this.powerHud, this.pomodoroHud, this.infoHud),
      this.privacyDot,
      this.compactPlan,
      this.clockEl,
      this.closedEl,
      this.holdRing as unknown as HTMLElement,
      this.countdown,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
    this.greetingCanvas.height = Math.round(150 * dpr);
    this.greetingCanvas.style.width = `${EXPANDED_W}px`;
    this.greetingCanvas.style.height = "150px";

    this.root.append(this.wakeStrip, this.islandEl);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.petitToHiddenDelay = State.settings.compactCloseInterval;
    this.fsm.openOnHover = State.settings.openOnHover;
    this.fsm.onTransition = (from, to) => {
      // The greeting is over, however it ended: back to his desktop spot.
      if (from === "puhu" && to !== "puhu") this.desktop.launch();
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "puhu") this.greeting.interrupt();
          else if (from === "hidden" && !this.silentReveal) Sound.play("peek");
          this.setMode("compact");
          if (from === "puhu") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(this.openingView());
          if (!this.wasInIsland) this.fsm.mouseLeft();
          // Hooks may have been installed in a terminal since: the idle cards
          // say so on the next open, without polling while the island is shut.
          void refreshHookPills();
          break;
        case "puhu":
          this.expand("greeting");
          this.greeting.start();
          break;
      }
      State.notify();
      if (from === "hidden") this.onWake?.();
    };
  }

  launch() {
    this.fsm.launch();
  }

  // ── Mode / view ─────────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    if (mode === "expanded") Sound.play("open");
    if (prev === "expanded") {
      Sound.play("close");
      // A folded card is still waiting: it keeps the island pinned.
      if (!State.pendingApproval && !State.waitingCard) State.isPinned = false;
      void Bridge.focusWindow(false);
      // Another pill's alert borrowed the front: the pill you had comes back.
      restoreAlertFocus();
      this.forgetTemporary();
      if (this.gameHeld) {
        this.gameHeld = false;
        void Bridge.gameResume();
      }
    }
    if (mode !== "expanded") {
      if (State.view === "shot") State.view = State.defaultView();
      closePlanCard();
      // Leaving the drop scene, his own Puhu is simply in his place as the island
      // folds round him: no flight across from where the scene's Puhu was.
      if (UploadSeq.isActive && UPLOAD_VIEWS.has(State.view)) {
        this.updateBotTargets();
        this.botCx.set(this.botCx.target);
        this.botCy.set(this.botCy.target);
        this.botSize.set(this.botSize.target);
      }
      // Nothing can be seen of the sequence once the island is shut, and leaving
      // it running would keep the frame loop awake — the island must cost
      // nothing while hidden.
      UploadSeq.deactivate();
    }
    // Folding all the way: the closed island's width for what it will show.
    if (mode === "hidden") this.updateClosed();
    else this.closedEl.classList.remove("on");
    this.scheduleClosedLife();
    // An indicator belongs to the compact island: opening or folding ends it.
    if (mode !== "compact") this.endHud();
    this.syncPomodoro();
    this.updateWindowCollapsed();
    // Open, a click anywhere else closes it (Rust watches the presses only then).
    if ((mode === "expanded") !== (prev === "expanded")) void Bridge.watchOutside(mode === "expanded");
    // Growing out of the folded window, the island opens once the window has grown.
    if (this.growing) this.pendingOpen = true;
    else this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    State.notify();
  }

  /** True while the drop sequence owns the island body. */
  private get uploadActive(): boolean {
    return State.mode === "expanded" && UploadSeq.isActive && UPLOAD_VIEWS.has(State.view);
  }

  /** Navigating out of the drop flow ends the sequence. */
  private stopSequenceIfLeaving(view: IslandViewName) {
    if (UploadSeq.isActive && !UPLOAD_VIEWS.has(view)) UploadSeq.deactivate();
  }

  /** Click on compact plan gauge: opens the Claude plan card on the overview. */
  openClaudePlan() {
    Sound.resume();
    State.lastActivity = performance.now();
    this.fsm.userInteracted();
    State.planDetailIsCodex = false;
    State.showingPlanDetail = true;
    this.fsm.forceHome();
    this.expand("overview");
    State.notify();
  }

  /** A card waits for its answer: nothing else takes its place (see OVER_WAITING). */
  private heldByWaiting(view: IslandViewName): boolean {
    return State.waitingCard != null && view !== State.waitingCard && !OVER_WAITING.has(view);
  }

  expand(view: IslandViewName) {
    if (this.heldByWaiting(view)) return;
    this.stopSequenceIfLeaving(view);
    if (view !== "overview") closePlanCard();
    State.view = view;
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    State.lastActivity = performance.now();
    State.notify();
  }

  setView(view: IslandViewName) {
    if (this.heldByWaiting(view)) return;
    this.stopSequenceIfLeaving(view);
    if (view !== "overview") closePlanCard();
    if (State.mode !== "expanded") {
      this.fsm.forceHome();
      State.view = view;
      this.animateGeometry(false);
      State.notify();
      return;
    }
    const grew = VIEW_LAYOUTS[view].height >= VIEW_LAYOUTS[State.view].height;
    State.view = view;
    State.lastActivity = performance.now();
    this.animateGeometry(!grew);
    State.notify();
  }

  collapse() {
    // A waiting card is only ever folded, never dropped by a close.
    if (State.pendingApproval || State.waitingCard) {
      this.foldApproval();
      return;
    }
    State.isPinned = false;
    this.fsm.pinned = false;
    // Drive the state machine rather than the mode: setting the mode behind its
    // back left it thinking the island was still open, and a click on the compact
    // island then did nothing — the island could never be reopened.
    this.fsm.forcePetit();
  }

  /** Alert from the hook server: open on this view. Pinned alerts never auto-close. */
  alert(view: IslandViewName) {
    // In a game nothing opens (hooks.ts counts what came for the welcome back).
    if (State.inGame) return;
    // Not even opened for it: the waiting card stays folded where it was put.
    if (this.heldByWaiting(view)) return;
    this.fsm.pinned = State.isPinned;
    this.fsm.forceHome();
    this.expand(view);
  }

  /** A new version waits and Puhu has nothing else to say (he is blue). */
  private updateHintOn(): boolean {
    return !State.paused && showsUpdateHint(Updates.waiting(), State.effectiveState, State.pendingApproval != null);
  }

  /**
   * What a click or a hover opens on: while Puhu is blue, the new version
   * ("Puhu X is out", Update now); otherwise the usual view. A waiting
   * permission or question always comes first.
   */
  private openingView(): IslandViewName {
    return this.updateHintOn() ? "update" : State.defaultView();
  }

  reveal() {
    if (State.inGame) return;
    this.fsm.reveal();
  }

  /** Music started playing: the compact island, without the peek sound (musicReveal). */
  revealSilently() {
    if (State.inGame) return;
    this.silentReveal = true;
    this.fsm.reveal();
    this.silentReveal = false;
  }

  /** Focus play's first question: Puhu's answer to a daily goal (island/focus-intro.ts). */
  reactToGoal(rounds: number) {
    Sound.play("pop");
    this.engine.triggerEmote(rounds <= 1 ? "wink" : rounds <= 2 ? "happy" : "proud");
    if (rounds >= 6) this.engine.raiseWing();
  }

  /** Right-click on Puhu: wardrobe open ↔ back to the usual view. */
  toggleWardrobe() {
    if (State.paused || State.mode === "hidden") return;
    // The greeting and the drop sequence draw a Puhu of their own.
    if (State.mode === "expanded" && (State.view === "greeting" || this.uploadActive)) return;
    if (State.mode === "expanded" && State.view === "wardrobe") this.setView(State.defaultView());
    else this.setView("wardrobe");
  }

  /**
   * Right-click on the desktop Puhu: opens the
   * wardrobe from any state, or goes back if it is already open.
   */
  wardrobeFromDesktop() {
    this.wardrobeAnywhere();
  }

  /**
   * The wardrobe from any state — compact or hidden island included — or back
   * to the usual view if it is already open. The desktop Puhu's right-click
   * and the wardrobe shortcut (`open-wardrobe`) both land here.
   */
  wardrobeAnywhere() {
    if (State.mode === "expanded" && State.view === "wardrobe") {
      this.setView(State.defaultView());
      return;
    }
    if (State.paused) return;
    this.alert("wardrobe");
  }

  /** An alert stopped waiting for an answer: let the island auto-close again. */
  dropPin() {
    this.fsm.pinned = false;
    // The countdown the pin held back starts now, if the mouse is elsewhere.
    if (!this.wasInIsland) this.fsm.mouseLeft();
  }

  // ── Keyboard shortcuts (island/shortcuts.ts) ────────────────────────────────

  emote(name: BotEmoteName) {
    this.engine.triggerEmote(name);
    this.ensureRunning();
  }

  /** Ctrl+P: keep the open island from folding away, or let it fold again. */
  setPinned(on: boolean) {
    State.isPinned = on;
    this.fsm.pinned = on;
    if (on) {
      // The countdown bar reads the state machine's deadline, cleared with it.
      this.fsm.cancelTimers();
    } else if (!this.wasInIsland && this.fsm.state === "home") {
      this.fsm.mouseLeft();
    }
    State.notify();
  }

  /** The island takes the keyboard, so its own shortcuts work.
   *  It gives it back when it closes, or when the chat is left. */
  takeKeyboard() {
    void Bridge.focusWindow(true);
  }

  /** The desktop shortcut needs a desktop Puhu: none on GNOME's Wayland. */
  canLeaveIsland(): boolean {
    return this.desktop.supported;
  }

  /** The desktop shortcut. */
  flyOutOrHome() {
    // The greeting and the drop sequence draw a Puhu of their own: he stays
    // for them, as he does for a drag (canDragOut).
    const busy = State.mode === "expanded" && (State.view === "greeting" || this.uploadActive);
    if (busy && !State.puhuOnDesktop) return;
    this.desktop.flyOutOrHome();
  }

  /** Ctrl+O / Ctrl+E go to the view on screen. */
  viewCommand(command: ViewCommand) {
    this.views.get(State.view)?.command?.(command);
  }

  /**
   * Ask the screen (docs/game-mode.md): Rust takes the screen under the pointer into the
   * inbox, and the chat opens on it, a new conversation, with its quick questions.
   */
  askScreen() {
    // Not while an answer is on its way: it would land in the new chat.
    if (State.stateOverride === "thinking") return;
    void Bridge.askScreen()
      .then((shot) => {
        // Called in from a game: game mode has ended quietly (game.rs step_out) and
        // waits for the island to close.
        if (shot.game) this.gameHeld = true;
        if (State.inGame || this.gameTimer != null) this.setGame(false, true);
        this.chatOn({ name: shot.name, path: shot.path, thumb: shot.thumb, temporary: true });
      })
      .catch((err) => this.askFailed(err));
  }

  /** "Ask Puhu" on a copied error: the chat opens on it and asks what it means. */
  private askCopied() {
    if (State.stateOverride === "thinking") return;
    void Bridge.askCopied()
      .then((file) => this.chatOn({ name: file.name, path: file.path, temporary: true }, t("Explain this error")))
      .catch((err) => this.askFailed(err));
  }

  /** A new chat about `file`, with `ask` sent at once when given. */
  private chatOn(file: NonNullable<typeof State.droppedFile>, ask: string | null = null) {
    if (State.droppedFile) void Bridge.forgetDropped(State.droppedFile.path);
    State.droppedFile = file;
    State.promptContext = { kind: "file", name: file.name, path: file.path };
    State.chatHistory = [];
    State.pendingAsk = ask;
    void Bridge.chatReset();
    this.alert("prompt");
  }

  private askFailed(err: unknown) {
    State.noteMessage = String(err).replace(/^Error:\s*/, "");
    this.alert("note");
    Sound.play("error");
  }

  /** A copy made for a question (the screen, a copied error) goes when the island closes, not while it is being read. */
  private forgetTemporary() {
    if (!State.droppedFile?.temporary || State.stateOverride === "thinking") return;
    void Bridge.forgetDropped(State.droppedFile.path);
    State.droppedFile = null;
    State.promptContext = null;
  }

  // ── File drop ───────────────────────────────────────────────────────────────

  private onDragDrop(e: { type: string; paths?: string[] }) {
    if (e.type !== "over") void Bridge.log(`drag ${e.type} ${e.paths?.length ?? 0} file(s)`);
    if (State.paused) return;
    switch (e.type) {
      case "enter":
      case "over": {
        if (this.dragGone != null) window.clearTimeout(this.dragGone);
        this.dragGone = null;
        if (State.fileDragOver) return;
        State.fileDragOver = true;
        // enterZone must run before the island expands, so the sequence is
        // already active by the time the view becomes `upload`.
        UploadSeq.enterZone(State.mouseInIsland.x, State.mouseInIsland.y);
        this.alert("upload");
        // Opened from folded or compact, the island passes through its usual view
        // first, and leaving the drop views ends the sequence: the bar then never
        // moved on a first drop. Started again, it runs.
        if (!UploadSeq.isActive) UploadSeq.enterZone(State.mouseInIsland.x, State.mouseInIsland.y);
        break;
      }
      case "leave": {
        if (!State.fileDragOver) return;
        State.fileDragOver = false;
        // The drag may come back; if it does not (the file was put down somewhere
        // else), the drop zone stops waiting and folds.
        UploadSeq.exitZone();
        this.dragGone = window.setTimeout(() => {
          this.dragGone = null;
          if (!State.fileDragOver && State.view === "upload" && !UploadSeq.dropped) this.collapse();
        }, DRAG_GONE_MS);
        State.notify();
        break;
      }
      case "drop": {
        State.fileDragOver = false;
        const path = e.paths?.[0];
        if (!path) {
          this.setView(State.defaultView());
          return;
        }
        this.catchFile(path);
        break;
      }
    }
  }

  /**
   * Puhu catches the file (upload/canvas.ts draws it). Nothing here waits on the
   * file system: the copy into the inbox runs in the background and swaps the path
   * in when it lands, so a slow disk can never stall the animation.
   */
  private catchFile(path: string) {
    const name = path.split(/[\\/]/).pop() || "file";
    State.droppedFile = { name, path };
    State.promptContext = { kind: "file", name, path };
    State.chatHistory = [];
    void Bridge.chatReset();

    UploadSeq.performDrop(State.uploadDuration);
    this.uploadTens = 0;
    this.uploadDone = false;

    Sound.play("approve");
    this.engine.triggerEmote("happy");

    State.uploadProgress = 0;
    this.setView("uploading");
    this.ensureRunning();

    void Bridge.ingestFile(path)
      .then((file) => {
        // Cancelled (or replaced by another drop) while the copy was running.
        if (State.droppedFile?.path !== path) return;
        State.droppedFile = { name: file.name, path: file.path };
        State.promptContext = { kind: "file", name: file.name, path: file.path };
        State.notify();
      })
      .catch((err) => {
        if (State.droppedFile?.path !== path) return;
        UploadSeq.deactivate();
        State.noteMessage = String(err).replace(/^Error:\s*/, "");
        this.setView("note");
        Sound.play("error");
        window.setTimeout(() => this.setView(State.defaultView()), 2400);
      });
  }

  /** "Cancel" on the dropped file: forget it, so the chat does not pick it up, and its copy goes. */
  private discardDrop() {
    if (State.droppedFile) void Bridge.forgetDropped(State.droppedFile.path);
    State.droppedFile = null;
    State.promptContext = null;
    this.setView(State.defaultView());
  }

  /**
   * Sounds and view changes hung off the canvas timeline: a `tick` every 10 %,
   * the ✓ chime when the bar completes, then `choose` once Puhu has grown back.
   */
  private stepSequence() {
    const since = UploadSeq.sinceDrop();
    if (since == null) return;
    const dur = State.uploadDuration;
    const p = Math.max(0, Math.min(1, (since - PRE_PROGRESS) / dur));

    const tens = Math.floor(p * 10);
    if (tens > this.uploadTens && tens < 10) {
      this.uploadTens = tens;
      Sound.play("tick");
    }

    if (!this.uploadDone && since >= PRE_PROGRESS + dur) {
      this.uploadDone = true;
      Sound.play("approve");
      this.engine.triggerEmote("happy");
    }
    // The extra second is the grow-back, after which the choose card is up.
    if (since >= PRE_PROGRESS + dur + 1 && State.view === "uploading") {
      this.setView("choose");
    }
    // Left alone (no answer, the pointer away), he keeps the file for the chat and the
    // island folds again, rather than waiting on screen.
    if (State.view === "choose" && since >= PRE_PROGRESS + dur + 1 + CHOOSE_WAIT_S && !this.wasInIsland) {
      this.collapse();
    }
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  /** The closed island stays on screen (anything but "hidden"), except in a game. */
  private get closedShows(): boolean {
    if (State.inGame) return false;
    return closedIsland(State.settings.closedIsland) !== "hidden" || Pomodoro.running || this.guarding;
  }

  /** Guard mode: the closed island is Puhu's lane, whatever it shows otherwise (he is in it). */
  private get guarding(): boolean {
    return this.guardLane && !State.inGame && !Pomodoro.running && !State.puhuOnDesktop;
  }

  /** What the closed island holds besides its line: Puhu, the music's waves in his place, or nothing. */
  private get closedHolds(): "puhu" | "waves" | null {
    if (State.inGame) return null;
    if (this.guarding) return "puhu";
    return closedFigure(closedIsland(State.settings.closedIsland), {
      pomodoro: Pomodoro.running,
      music: this.musicOn,
      closedMusic: State.settings.closedMusic !== false,
    });
  }

  /** Music plays, or stopped a moment ago between two songs. */
  private get musicOn(): boolean {
    return State.spotifyPlaying || songs.between(Date.now());
  }

  /** Puhu in the closed island. */
  private get closedPuhu(): boolean {
    return this.closedHolds === "puhu";
  }

  /** The island is folded and the music's waves have it. */
  private get closedWaves(): boolean {
    return State.mode === "hidden" && this.closedHolds === "waves";
  }

  private targetSize(): { w: number; h: number; r: number } {
    if (this.viewing) return { w: this.viewSize.w, h: this.viewSize.h, r: EXPANDED_CORNER };
    // Hidden away: a drop drawn up into the top edge.
    if (State.mode === "hidden" && !this.closedShows) return { w: DROP_W, h: 0, r: DROP_W / 2 };
    // The screenshot peek: the compact island opens around the picture.
    if (State.mode === "compact" && this.hudKind === "shot") {
      return { w: Math.max(COMPACT_W, this.shotSize.w + 2 * SHOT_PAD), h: this.shotSize.h + 2 * SHOT_PAD, r: 20 };
    }
    if (State.mode === "hidden" && this.closedShows) {
      const hud = this.hudKind && this.hudKind !== "shot" ? this.hudWidth(this.hudKind) : 0;
      if (hud > 0) return { w: Math.max(this.closedW, hud + 2 * CLOSED_PEEK_PAD), h: CLOSED_PEEK_H, r: CLOSED_PEEK_H / 2 };
      return { w: this.closedW, h: CLOSED_H, r: 10 };
    }
    let { w, h } = islandSize(State.mode, State.view, State.chatHistory.length);
    if (State.mode === "compact" && this.hudKind) {
      w += this.hudKind === "info" ? Math.max(24, this.infoW - 120) : HUD_EXTRA_W[this.hudKind];
    }
    if (State.mode === "expanded" && State.view === "question" && State.pendingApproval?.questions) {
      h = QUESTION_PICKER_H;
    }
    const r = State.mode === "expanded" ? EXPANDED_CORNER : ROUNDED_CORNER;
    return { w, h, r };
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h, r } = this.targetSize();
    // A drop still swelling spreads only if nothing has moved the island on since.
    const token = ++this.dropToken;
    // Out of nothing (hidden away) or back into it: like a drop of water at the top edge.
    // Coming, it swells down first, a little past its height, and spreads after; going,
    // it draws in to a drop first and is taken up. What is inside shows only within it.
    if (!this.closedShows && (State.mode === "hidden" || this.height.value < 2)) {
      const coming = State.mode !== "hidden";
      this.islandEl.classList.add("dropping");
      this.height.springTo(h, coming ? 0.32 : 0.52, coming ? 0.52 : 0.92);
      this.radius.springTo(r, 0.4, 0.85);
      if (coming) {
        this.width.springTo(DROP_BEAD_W, 0.3, 0.8);
        window.setTimeout(() => {
          if (token !== this.dropToken || State.mode === "hidden") return;
          this.width.springTo(this.targetSize().w, 0.5, 0.72);
          this.ensureRunning();
        }, DROP_BEAD_MS);
      } else {
        this.width.springTo(w, 0.3, 0.92);
      }
      this.ensureRunning();
      return;
    }
    // Elastic both ways: opening overshoots a little and settles, folding gives softly.
    const [response, damping] = shrinking ? [0.42, 0.8] : [0.5, 0.66];
    this.width.springTo(w, response, damping);
    this.height.springTo(h, response, damping);
    this.radius.springTo(r, response, damping);
    this.ensureRunning();
  }

  private applyGeometry() {
    const w = this.width.value;
    const hh = this.height.value;
    const r = this.radius.value;
    // On whole device pixels, both edges: a fractional offset made everything inside the
    // island (the volume level most visibly) shimmer while it springs.
    const viewW = window.innerWidth > 0 ? window.innerWidth : PANEL_W;
    const left = snapPx((viewW - w) / 2);
    const islandW = snapPx((viewW + w) / 2) - left;
    const islandH = snapPx(hh);
    this.islandEl.style.left = `${left}px`;
    this.islandEl.style.width = `${islandW}px`;
    this.islandEl.style.height = `${islandH}px`;
    this.islandEl.style.borderRadius = `0 0 ${r}px ${r}px`;
    // A drop still narrow keeps what it holds out of sight (style.css #island.dropping.narrow).
    this.islandEl.classList.toggle("narrow", w < DROP_NARROW_W);
    for (const [hud, hw] of [[this.volumeHud, VOLUME_HUD_W], [this.powerHud, POWER_HUD_W], [this.pomodoroEl, this.pomodoroW], [this.pomodoroHud, POMODORO_HUD_W], [this.infoHud, this.infoW]] as const) {
      hud.style.left = `${snapPx((islandW - hw) / 2)}px`;
      hud.style.top = `${snapPx((islandH - HUD_H) / 2)}px`;
    }
    if (this.viewing) {
      // The picture grows with the island, from the peek to its place in the viewer.
      const f = this.viewFrom;
      const t = this.viewSize.img;
      const span = this.viewSize.h - f.islandH;
      const p = Math.abs(span) > 1 ? (hh - f.islandH) / span : 1;
      const at = (a: number, b: number) => snapPx(a + (b - a) * p);
      this.shotEl.style.left = `${at(f.left, t.left)}px`;
      this.shotEl.style.top = `${at(f.top, t.top)}px`;
      this.shotImg.style.width = `${at(f.w, t.w)}px`;
      this.shotImg.style.height = `${at(f.h, t.h)}px`;
      // Its column rides beside it, ending at the island's right edge.
      this.viewSide.style.left = `${at(f.left + f.w + VIEW_PAD, this.viewSize.w - VIEW_PAD - VIEW_SIDE)}px`;
    } else if (this.hudKind === "shot") {
      this.shotEl.style.left = `${snapPx((islandW - this.shotSize.w) / 2)}px`;
      this.shotEl.style.top = `${snapPx(SHOT_PAD)}px`;
    }
    this.privacyDot.style.left = `${snapPx(islandW - 11)}px`;
    this.privacyDot.style.top = `${snapPx(islandH / 2 - 3)}px`;
    // These follow the island as it resizes, so they belong here rather than in
    // the state-driven DOM sync.
    this.miniGrid.style.left = `${w - 40 - 14.5}px`;
    this.miniGrid.style.top = `${hh / 2 - 14.5}px`;
    this.clockEl.style.height = `${hh}px`;
    this.greetingCanvas.style.left = `${(w - EXPANDED_W) / 2}px`;
    this.uploadCanvas.el.style.left = `${(w - EXPANDED_W) / 2}px`;

    const viewportW = window.innerWidth > 0 ? window.innerWidth : PANEL_W;
    const rect = { x: (viewportW - w) / 2, y: 0, w, h: hh };
    const p = this.pushedRect;
    if (Math.abs(p.x - rect.x) > 0.5 || Math.abs(p.w - rect.w) > 0.5 || Math.abs(p.h - rect.h) > 0.5) {
      this.pushedRect = rect;
      void Bridge.setIslandRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  /** Island rect in window coordinates (origin top-left of the 720×320 window). */
  private islandRect(): { x: number; y: number; w: number; h: number } {
    const w = this.width.value;
    const hh = this.height.value;
    const viewportW = window.innerWidth > 0 ? window.innerWidth : PANEL_W;
    return { x: (viewportW - w) / 2, y: 0, w, h: hh };
  }

  // ── Window collapse (hidden → tiny wake strip, zero polling) ────────────────

  private updateWindowCollapsed() {
    if (this.collapseTimer != null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (State.mode === "hidden") {
      // On Windows the window keeps the panel's size. Shrinking it to the closed island
      // and growing it back moves the window under the page, and what WebView2 shows in
      // between (an island in the wrong place, or none) was seen as a flash or a blink.
      // The cursor poll that goes on running is a GetCursorPos 20 times a second.
      if (HOST_OS === "windows") return;
      // Let the island finish folding, then shrink the window to it — to the
      // closed island, or to the wake strip when that shows nothing: from
      // there nothing polls the cursor at all.
      this.collapseTimer = window.setTimeout(() => {
        this.collapseTimer = null;
        if (State.mode !== "hidden") return;
        this.collapsed = true;
        this.sendCollapsedSize(true);
      }, 420);
    } else if (this.collapsed) {
      // Grow the window back before the island animates open, and keep the island out
      // of sight until the page is laid out at the new size: right after a resize
      // WebView2 still shows the old frame, whose island — centred on the small
      // window — flashed to the left of where it belongs.
      this.collapsed = false;
      this.collapsedTo = { w: 0, h: 0 };
      this.growing = true;
      this.islandEl.style.visibility = "hidden";
      // The hidden island has to reach the screen before the window grows, or the
      // old frame is still the one with the island in it.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (this.collapsed) return;
        void Bridge.setCollapsed(false).then(() => this.whenGrown());
      }));
    }
  }

  /** The window is back to the panel's size: two frames at it, then the island shows and opens. */
  private whenGrown() {
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      removeEventListener("resize", onResize);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.growing = false;
        this.islandEl.style.visibility = "";
        if (this.pendingOpen) {
          this.pendingOpen = false;
          this.animateGeometry(false);
        }
      }));
    };
    const onResize = () => {
      if (window.innerWidth >= PANEL_W - 1) show();
    };
    addEventListener("resize", onResize);
    onResize();
    window.setTimeout(show, 250);
  }

  /**
   * Puhu in the closed island now and then blinks or glances around:
   * a few frames every few seconds, the loop
   * asleep in between. Nothing runs for the other closed islands.
   */
  private scheduleClosedLife() {
    if (this.closedLife != null) window.clearTimeout(this.closedLife);
    this.closedLife = null;
    if (State.mode !== "hidden" || !this.closedPuhu) {
      this.closedLook = { x: 0, y: 0 };
      return;
    }
    this.closedLife = window.setTimeout(() => {
      this.closedLife = null;
      if (State.mode !== "hidden" || State.paused || !this.closedPuhu) return this.scheduleClosedLife();
      const r = Math.random();
      if (r < 0.4) {
        this.engine.blink();
      } else if (r < 0.58) {
        this.engine.slowBlink();
      } else {
        this.closedLook = { x: (Math.random() * 2 - 1) * 0.8, y: (Math.random() * 2 - 1) * 0.3 };
      }
      this.closedAwakeUntil = performance.now() + 700;
      this.ensureRunning();
      this.scheduleClosedLife();
    }, 2500 + Math.random() * 3500);
  }

  /** Puhu at rest in the compact or open island: one of his small habits every few seconds. */
  private scheduleIdleLife() {
    window.setTimeout(() => {
      if (!State.paused && State.mode !== "hidden" && !this.hudKind) {
        this.engine.fidget();
        this.ensureRunning();
      }
      this.scheduleIdleLife();
    }, 7000 + Math.random() * 9000);
  }

  /** A click outside the open island (Rust's `outside-click`): it closes. */
  clickedOutside() {
    if (State.mode === "expanded") this.collapse();
  }

  /** The pointer is on the folded window (Rust's `closed-hover`): the island wakes. */
  wakeFromClosed() {
    if (State.mode !== "hidden" || State.inGame) return;
    Sound.resume();
    this.fsm.mouseEntered();
  }

  /** Tells Rust the folded window's size: the closed island's, or none (the strip). */
  private sendCollapsedSize(force = false) {
    const size = this.closedShows ? { w: this.closedW, h: CLOSED_H } : { w: 0, h: 0 };
    if (!force && size.w === this.collapsedTo.w && size.h === this.collapsedTo.h) return;
    this.collapsedTo = size;
    if (size.w > 0) void Bridge.setCollapsed(true, size.w, size.h);
    else void Bridge.setCollapsed(true);
  }

  /**
   * What the closed island shows, redrawn when it changes (the minute, the
   * song, the plan): a new width animates the island and, once folded,
   * resizes the window to it.
   */
  private updateClosed() {
    this.tellEmber();
    const style = closedIsland(State.settings.closedIsland);
    // The song of whichever player plays: Spotify's pill, else Now Playing's app.
    const track = (Spotify.state.playing ? Spotify.state.track : null) ?? NowPlaying.state.track;
    let content: ClosedContent | null = (State.mode === "hidden" || this.collapsed) && !this.guarding
      ? closedContent(style, {
        now: new Date(),
        locale: language(),
        planUsage: State.planUsage,
        music: State.spotifyPlaying && track ? { title: track.title, artist: track.artist } : null,
      })
      : null;
    // A running Pomodoro takes the closed island: its colour and what is left, turning
    // over once a second. Folded, the island costs a repaint a second, nothing more.
    if ((State.mode === "hidden" || this.collapsed) && Pomodoro.phase) {
      content = { text: formatRemaining(Pomodoro.remaining()), dot: POMODORO_COLOR[Pomodoro.phase], note: false };
    }
    const waves = this.closedWaves;
    const key = (content ? `${style}|${content.text}|${content.dot ?? ""}|${content.note}` : style) + (waves ? "|waves" : "") +
      (this.guarding ? "|guard" : "");
    const shown = State.mode === "hidden" && this.closedShows;
    // The note before the song takes the cover's colour.
    this.closedEl.style.setProperty("--note", CoverColor.css(1, "#1ed760"));
    this.closedEl.classList.toggle("on", shown && content != null);
    if (key === this.closedKey) return;
    this.closedKey = key;
    // Puhu or the waves: his idle life follows, and either has to move into place.
    this.scheduleClosedLife();
    this.ensureRunning();
    this.closedText.textContent = content?.text ?? "";
    this.closedEl.classList.toggle("note", content?.note === true);
    this.closedDot.style.display = content?.dot ? "" : "none";
    if (content?.dot) this.closedDot.style.background = content.dot;
    // Measured as drawn: the font and the language decide the width.
    const extras = (content?.dot ? 12 : 0) + (content?.note ? 16 : 0);
    const w = this.guarding ? GUARD_W : closedWidth(content ? this.closedText.scrollWidth : 0, extras);
    if (w !== this.closedW) {
      this.closedW = w;
      if (State.mode === "hidden") {
        this.animateGeometry(w < this.width.value);
        if (this.collapsed) this.sendCollapsedSize();
      }
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    // Folded, the window is only the closed island (or the wake strip): the
    // pointer coming onto it is all there is to hear, and it wakes the island.
    const wake = () => {
      Sound.resume();
      if (State.mode === "hidden" && !State.inGame) this.fsm.mouseEntered();
    };
    this.wakeStrip.addEventListener("mouseenter", wake);
    this.root.addEventListener("mouseover", () => {
      if (this.collapsed) wake();
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      State.lastActivity = performance.now();
      // A click makes a hover-opened island an ordinary open one.
      this.fsm.userInteracted();
      // A press on Puhu may become a drag out to the desktop.
      if (e.button === 0 && this.isBotHit(e.clientX, e.clientY)) {
        this.botPress = { x: e.clientX, y: e.clientY };
      }
      // Right-click on Puhu opens the wardrobe, and closes it again.
      if (e.button === 2 && this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.toggleWardrobe();
        return;
      }
      if (State.mode !== "expanded" && this.hudKind === "shot" && this.shotName) {
        this.openViewer();
        return;
      }
      if (State.mode !== "expanded" && this.hudKind === "info" && this.infoAction) {
        this.infoAction();
        this.endHud();
        if (State.mode === "compact") this.animateGeometry(true);
        return;
      }
      if (State.mode !== "expanded") {
        // A click on the running Pomodoro opens its card.
        if (State.mode === "compact" && Pomodoro.running && State.tasks.some((t) => t.id === POMODORO_ID)) {
          State.setFocus(POMODORO_ID);
        }
        this.fsm.click();
        return;
      }
      if (this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        // With focus play on, his card is a hold away: the poke waits for the release.
        if (progress.on && e.button === 0 && State.view !== "puhuCard") this.startHold();
        else this.poke();
      }
    });

    // No browser menu over Puhu: his right-click is the wardrobe. Everywhere
    // else (the chat field) the webview keeps its own menu.
    this.islandEl.addEventListener("contextmenu", (e) => {
      if (this.isBotHit(e.clientX, e.clientY)) e.preventDefault();
    });

    // Dragging Puhu out of the island puts him on the desktop.
    window.addEventListener("mousemove", (e) => {
      if (this.desktop.carrying) {
        this.desktop.carry(e.clientX, e.clientY);
        return;
      }
      const press = this.botPress;
      if (!press) return;
      if (!(e.buttons & 1)) {
        this.botPress = null;
        return;
      }
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= DRAG_THRESHOLD) return;
      this.botPress = null;
      this.endHold(false);
      if (!this.canDragOut()) return;
      this.cancelBotHover();
      this.desktop.pickUp(e.clientX, e.clientY);
    });
    window.addEventListener("mouseup", (e) => {
      this.botPress = null;
      this.endHold(true);
      if (this.desktop.carrying) this.desktop.carryEnd(e.clientX, e.clientY);
    });

    // Only keys typed into the island itself land here, never Escape typed in
    // a terminal — so it may fold a waiting card away.
    window.addEventListener("keydown", (e) => {
      this.konami = konamiStep(this.konami, e.key);
      if (this.konami === KONAMI_LENGTH) {
        this.konami = 0;
        this.surprise("konami");
      }
      if (e.key === "Escape" && State.mode === "expanded") {
        if (State.pendingApproval || State.waitingCard) this.foldApproval();
        else if (!State.isPinned) this.collapse();
      }
      State.lastActivity = performance.now();
    });

    void onDragDrop((e) => this.onDragDrop(e));
    // Folded and still, the waves start moving again with the music's first pulse.
    void onEvent("music-pulse", () => {
      if (this.closedWaves) this.ensureRunning();
    });

    // Outside Tauri (plain browser) drive the cursor from DOM events so the
    // island can be inspected with `npm run dev`.
    if (!IS_TAURI) this.followPageCursor();
  }

  /**
   * Takes the cursor from the page's own mouse events instead of Rust's poll.
   * Used where the OS has no global cursor position (Wayland): the events only
   * fire while the pointer is over the island, so leaving the window is
   * reported as a cursor far away, which is what the poll would have said.
   */
  followPageCursor() {
    window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    window.addEventListener("mouseout", (e) => {
      if (e.relatedTarget == null) this.onCursor(-10_000, -10_000);
    });
  }

  /**
   * Pointer on/off the island as the compositor sees it (Linux only). Null
   * until the first report, so a platform that never sends it is not gated.
   */
  private pointerInside: boolean | null = null;

  setPointerInside(inside: boolean) {
    this.pointerInside = inside;
  }

  /** Cursor in window-logical coordinates. */
  onCursor(x: number, y: number) {
    // WebKitGTK can deliver a mousemove after the pointer has left the layer
    // surface; trusting it re-enters the island and the auto-close never runs.
    if (this.pointerInside === false) {
      x = -10_000;
      y = -10_000;
    }
    State.mouse = { x, y };
    const rect = this.islandRect();
    State.mouseInIsland = { x: x - rect.x, y: y - rect.y };

    // Windows sends no cursor position with an OLE drag, so the drop sequence is
    // fed from the Win32 cursor poll instead — it runs throughout the drag.
    if (UploadSeq.isActive && !UploadSeq.dropped) {
      UploadSeq.updateCursor(State.mouseInIsland.x, State.mouseInIsland.y);
    }

    const inIsland =
      x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN &&
      y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;

    // Recorded before the state machine hears of it: a transition it makes
    // right away (open on hover) reads where the pointer is, and must not see
    // the pointer as still outside.
    const wasIn = this.wasInIsland;
    this.wasInIsland = inIsland;
    if (inIsland && !wasIn && !State.inGame) {
      if (this.fsm.state === "puhu") this.greeting.hover();
      this.fsm.mouseEntered();
    }
    if (!inIsland && wasIn) {
      this.fsm.mouseLeft();
    }

    // Bot hover → love
    const overBot = State.mode === "expanded" && State.stateOverride == null && this.isBotHit(x, y);
    if (overBot && !this.botHovering) this.botHoverIn(x, y);
    if (!overBot && this.botHovering) this.cancelBotHover();
    this.botHovering = overBot;
    if (this.botHovering) {
      const d = Math.hypot(x - this.botHoverStart.x, y - this.botHoverStart.y);
      if (d > 40) {
        this.botHoverStart = { x, y };
        this.scheduleLove();
      }
    }

    this.ensureRunning();
  }

  /** The greeting and the drop sequence draw a Puhu of their own: not that one. */
  private canDragOut(): boolean {
    if (State.mode === "hidden" || !this.desktop.canPickUp()) return false;
    return !(State.mode === "expanded" && (State.view === "greeting" || this.uploadActive));
  }

  private isBotHit(x: number, y: number): boolean {
    // Out on the desktop, the island's Puhu is invisible: nothing to hit.
    if (State.puhuOnDesktop) return false;
    const rect = this.islandRect();
    const cx = rect.x + this.botCx.value;
    const cy = rect.y + this.botCy.value;
    const radius = this.botSize.value / 2;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }

  private botHoverIn(x: number, y: number) {
    if (performance.now() / 1000 - this.lastLoveTime < 6) return;
    this.botHoverStart = { x, y };
    this.engine.blink();
    this.engine.tgEs = 1.08;
    Sound.play("hover");
    this.scheduleLove();
  }

  private scheduleLove() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = window.setTimeout(() => {
      this.botHoverTimer = null;
      if (!this.botHovering || State.stateOverride != null) return;
      if (performance.now() / 1000 - this.lastLoveTime < 6) return;
      this.lastLoveTime = performance.now() / 1000;
      this.engine.triggerEmote("love");
      Sound.play("love");
    }, 1900);
  }

  private cancelBotHover() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = null;
    this.engine.tgEs = 1;
  }

  /** Three slaps → dizzy + confused view for 3.3 s, then back. */
  handleDizzy() {
    void awardSecret("dizzy");
    this.prevViewBeforeConfused = State.view;
    State.stateOverride = "dizzy";
    this.engine.setState("dizzy");
    Sound.play("dizzy");
    this.alert("confused");
    if (this.confusedRecovery != null) window.clearTimeout(this.confusedRecovery);
    this.confusedRecovery = window.setTimeout(() => {
      this.confusedRecovery = null;
      State.stateOverride = null;
      this.engine.setState(State.effectiveState);
      if (State.view === "confused") {
        const fallback = State.defaultView();
        this.setView(this.prevViewBeforeConfused === "confused" ? fallback : this.prevViewBeforeConfused);
      }
      this.engine.triggerEmote("happy");
    }, 3300);
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    // Folded, frames come 12 a second: a smaller cap ran his springs slow, so a glance
    // was still under way when the loop slept and finished at the next one, a twitch.
    const dt = Math.min(0.1, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
    this.applyGeometry();

    if (this.dirty) {
      this.dirty = false;
      this.syncDom();
    }

    this.patrol(nowMs);
    this.updateBotTargets();
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    if (greetingActive) {
      const gctx = this.greetingCanvas.getContext("2d");
      if (gctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (this.greetingCanvas.width !== Math.round(EXPANDED_W * dpr)) {
          this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
          this.greetingCanvas.height = Math.round(150 * dpr);
        }
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.draw(gctx);
      }
    } else {
      // Kept running even while the drop canvas is up, so the island's own Puhu
      // is already in the right place the moment the canvas fades out.
      this.drawBot(dt);
    }

    const uploadActive = this.uploadActive;
    if (uploadActive) this.uploadCanvas.draw(UploadSeq.frame(), nowMs / 1000);
    this.uploadCanvas.el.classList.toggle("on", uploadActive);
    this.viewsEl.classList.toggle("hidden-by-upload", uploadActive);

    tickMiniBots(dt);
    // A ticker scroll that loses its frames freezes mid-way, rows overlapping.
    const viewAnimating = this.views.get(State.view)?.tick?.(nowMs) === true;
    if (UploadSeq.isActive) this.stepSequence();
    this.updateCountdown(nowMs);

    // Nothing is drawn while the island is hidden, so nothing may keep the loop
    // alive either. This used to read `... || this.engine.busy || State.mode !==
    // "hidden"`, and engine.busy is permanently true for any state with a
    // looping animation — breathing, ratelimit sweat, sleeping z's, the search
    // sweep — so a hidden island went on burning frames in exactly the states it
    // spends most of its life in. Geometry still has to finish retracting.
    const settling =
      this.width.animating || this.height.animating || this.radius.animating;
    if (!settling) this.islandEl.classList.remove("dropping");
    const botMoving = !this.botCx.settled || !this.botCy.settled || !this.botSize.settled;
    // Closed, only the folding — and Puhu reaching his place in the closed island.
    const busy = State.mode === "hidden"
      ? settling || (this.closedWaves && this.wavesMoving()) || (this.closedPuhu &&
        (botMoving || nowMs < this.closedAwakeUntil)) || this.guard.leg != null
      : settling ||
        !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
        greetingActive || this.engine.busy || UploadSeq.isActive || viewAnimating;

    if (busy) {
      const ambient = !settling && !botMoving && !greetingActive && !UploadSeq.isActive && !viewAnimating;
      // Puhu only breathing or blinking: half the pace; dancing keeps the full one. On
      // guard the closed island is his lane, walked at 24 frames a second.
      const pace = State.mode === "hidden"
        ? (this.guarding ? GUARD_FRAME_MS : CLOSED_MUSIC_FRAME_MS)
        : this.engine.dancingLevel > 0.001 ? AMBIENT_FRAME_MS : RESTING_FRAME_MS;
      const due = this.lastFrame + pace - performance.now();
      if (ambient && due > 0) window.setTimeout(() => requestAnimationFrame(this.frame), due);
      else requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private updateBotTargets() {
    let p = botPosition(State.mode, State.view, this.height.value, State.uploadProgress);
    // The closed island with Puhu in it.
    if (State.mode === "hidden" && this.closedPuhu) {
      // Its centre once folded: aiming at the shrinking island's middle sent him past
      // its edge and back.
      p = { cx: this.targetSize().w / 2, cy: this.height.value / 2, diameter: CLOSED_BOT_D, opacity: 1 };
    }
    // He makes way for the waves, or for an indicator in the folded island: shrinks into
    // the middle and pops back out after. Once small, he is not shown at all.
    if (State.mode === "hidden" && (this.closedWaves || (this.closedPuhu && this.hudKind))) {
      p = { cx: this.targetSize().w / 2, cy: this.height.value / 2, diameter: 0, opacity: this.botSize.value > 3 ? 1 : 0 };
    }
    // Once he sits in the closed island, its middle moving (an indicator stretching it, then
    // letting go) carries him along at once: a spring chasing it overshot, a small bob.
    if (State.mode === "hidden" && (this.closedPuhu || this.closedWaves)) {
      const centre = { x: this.width.value / 2, y: this.height.value / 2 };
      if (this.closedCentre) {
        this.botCx.value += centre.x - this.closedCentre.x;
        this.botCy.value += centre.y - this.closedCentre.y;
        p = { ...p, cx: centre.x, cy: centre.y };
        this.closedCentre = centre;
      } else if (this.botCx.settled && this.botCy.settled) {
        this.closedCentre = centre;
      }
    } else {
      this.closedCentre = null;
    }
    // On guard, his place along the lane; walking, exactly there.
    const onLane = State.mode === "hidden" && this.guarding && !this.hudKind;
    if (onLane) {
      const x = GUARD_END + this.guard.pos * (this.width.value - 2 * GUARD_END);
      if (this.guard.leg) this.botCx.set(x);
      p = { ...p, cx: x };
    }
    if (this.viewing) p = this.viewBot();
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    this.botSize.target = p.diameter / 0.6;

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    // The drop canvas draws its own Puhu; two of them would overlap. Out on the
    // desktop, he isn't here at all.
    const away = State.puhuOnDesktop;
    const visible = p.opacity > 0 && !greetingActive && !this.uploadActive && !away;
    this.botCanvas.style.opacity = visible ? "1" : "0";

    if (State.mode === "expanded" && State.view !== "uploading" && !greetingActive && !this.uploadActive && !away) {
      const d = p.diameter;
      const color = botGlowColor(State.effectiveState);
      this.botGlow.style.display = "block";
      this.botGlow.style.width = `${d * 2.2}px`;
      this.botGlow.style.height = `${d * 2.2}px`;
      this.botGlow.style.left = `${this.botCx.value - d * 1.1}px`;
      this.botGlow.style.top = `${this.botCy.value - d * 1.1}px`;
      this.botGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
      this.botGlow.style.opacity = String(botGlowOpacity(State.effectiveState));
      this.botGlow.style.clipPath = "";
    } else if (onLane && !away) {
      // A lantern's light goes along the lane with him, cut to its shape; caught by surprise, it flashes.
      const d = CLOSED_BOT_D * 2.4;
      const left = this.botCx.value - d / 2;
      const top = this.botCy.value - d / 2;
      const flash = performance.now() < this.guardFlashUntil;
      const r = this.radius.value;
      this.botGlow.style.display = "block";
      this.botGlow.style.width = `${d}px`;
      this.botGlow.style.height = `${d}px`;
      this.botGlow.style.left = `${left}px`;
      this.botGlow.style.top = `${top}px`;
      this.botGlow.style.clipPath =
        `inset(${-top}px ${left + d - this.width.value}px ${top + d - this.height.value}px ${-left}px round 0 0 ${r}px ${r}px)`;
      this.botGlow.style.background = `radial-gradient(circle, ${flash ? "#ffb340" : GUARD_COLOR} 0%, transparent 62%)`;
      this.botGlow.style.opacity = flash ? "0.9" : "0.42";
    } else {
      this.botGlow.style.display = "none";
    }
  }

  /**
   * The music's waveform, as the Dynamic Island draws it: six bars in the cover's two
   * colours, rising and falling smoothly with the music, a slow wave running through
   * them so they flow rather than jump. In the middle of the compact island (beside the
   * agents when the clock is there), moving only while Puhu dances there, when the
   * frame loop runs anyway. Drawn on a canvas in whole device pixels.
   */
  private updateMusicBars(on: boolean) {
    this.musicBars.classList.toggle("on", on);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = this.musicBars;
    // Placed even while they fade out: left where they were, the folding island's
    // edge would carry them off to the right.
    const w = this.width.value;
    const left = State.settings.showClock && State.mode !== "hidden" ? w - 54.5 - 10 - BARS_W : (w - BARS_W) / 2;
    c.style.left = `${snapPx(left)}px`;
    c.style.top = `${snapPx(this.height.value / 2 - BARS_H / 2)}px`;
    if (!on) return;
    const W = Math.round(BARS_W * dpr);
    const H = Math.round(BARS_H * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
      c.style.width = `${W / dpr}px`;
      c.style.height = `${H / dpr}px`;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const bands = MusicPulse.bands;
    const loud = MusicPulse.loud();
    const t = performance.now() / 1000;
    // On the beat a kick, on a different contour each beat so it never lifts all six alike.
    const beat = MusicPulse.beat();
    const kick = MusicPulse.sure() * Math.exp(-(beat % 1) * 4);
    const contour = BAR_CONTOURS[Math.floor(beat) % BAR_CONTOURS.length];
    // Their own clock: folded, frames come 12 a second, past the island's 50 ms step.
    const nowMs = performance.now();
    const dt = Math.min(0.12, (nowMs - this.barsAt) / 1000);
    this.barsAt = nowMs;
    const steps = Math.max(1, Math.ceil(dt * 60));
    const h = dt / steps;
    ctx.clearRect(0, 0, W, H);
    const [from, to] = CoverColor.pair();
    const fill = ctx.createLinearGradient(0, 0, W, 0);
    fill.addColorStop(0, from);
    fill.addColorStop(1, to);
    ctx.fillStyle = fill;
    const bw = Math.max(2, Math.round(3 * dpr));
    const gap = Math.max(2, Math.round(2 * dpr));
    let x = Math.round((W - (6 * bw + 5 * gap)) / 2);
    for (let i = 0; i < 6; i++) {
      const band = bands[i] ?? 0;
      this.barAvgs[i] += (band - this.barAvgs[i]) * (1 - Math.exp(-dt / 1.5));
      const lift = Math.max(0, band - this.barAvgs[i]) * 2.5;
      // Resting low, a slow sway with the loudness, up with the kick and its own band.
      const sway = 0.5 + 0.5 * Math.sin(t * 1.3 + i * 1.1);
      const target = 0.18 + 0.82 * Math.min(1, loud * (0.2 + 0.15 * sway) + 0.55 * kick * contour[i] + 0.6 * lift);
      // A soft spring: up quickly, back more slowly, a little give; small steps keep it steady at 12 fps.
      const w = target > this.barLevels[i] ? 14 : 7;
      for (let k = 0; k < steps; k++) {
        this.barVels[i] += (w * w * (target - this.barLevels[i]) - 1.5 * w * this.barVels[i]) * h;
        this.barLevels[i] += this.barVels[i] * h;
      }
      this.barLevels[i] = Math.max(0.12, Math.min(1, this.barLevels[i]));
      const bh = Math.max(bw, Math.round(this.barLevels[i] * H));
      ctx.beginPath();
      ctx.roundRect(x, Math.round((H - bh) / 2), bw, bh, bw / 2);
      ctx.fill();
      x += bw + gap;
    }
  }

  private buildVolumeHud() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = (d: string, stroke: boolean) => {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      if (stroke) {
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", "currentColor");
        p.setAttribute("stroke-width", "2");
        p.setAttribute("stroke-linecap", "round");
      } else {
        p.setAttribute("fill", "currentColor");
      }
      svg.append(p);
      return p;
    };
    path("M3 9.5v5h3.5L11 19V5L6.5 9.5H3z", false);
    this.volumeWaves = [
      path("M14.5 9.5a3.5 3.5 0 0 1 0 5", true),
      path("M17 7a7 7 0 0 1 0 10", true),
      path("M19.5 4.5a10.5 10.5 0 0 1 0 15", true),
    ];
    this.volumeMute = path("M15.5 9.5l5 5M20.5 9.5l-5 5", true);
    this.volumeFill = h("div", { class: "fill" });
    this.volumeSpark = h("span", { class: "spark", text: "✦" });
    this.volumeHud = h("div", { id: "volume-hud" }, svg as unknown as HTMLElement, h("div", { class: "track" }, this.volumeFill), this.volumeSpark);
  }

  /**
   * The system volume changed (Rust's `system-volume`): the compact island shows it
   * for a moment, a speaker with its waves and the level, then folds back if it was
   * folded. An open island is left alone.
   */
  showVolume(v: { level: number; muted: boolean }) {
    const percent = v.muted ? 0 : Math.round(v.level * 100);
    if (percent !== this.lastVolume && (percent === 42 || percent === 11)) this.surprise(percent === 42 ? "answer" : "eleven");
    const was = this.lastVolume;
    this.lastVolume = percent;
    if (State.paused || State.mode === "expanded") return;
    // All the way up: wings over his ears. Muted: a wing to his beak, "shh".
    if (percent >= 98 && was < 98) {
      this.engine.coverEars(1600);
    } else if (percent === 0 && was > 0) {
      this.engine.shh(1600);
    }
    const level = Math.max(0, Math.min(1, v.level));
    const silent = v.muted || level < 0.005;
    this.volumeWaves.forEach((wave, i) => {
      wave.style.opacity = !silent && level > i / 3 ? "1" : "0";
    });
    this.volumeMute.style.opacity = silent ? "1" : "0";
    this.volumeFill.style.transform = `scaleX(${level.toFixed(3)})`;
    this.volumeHud.classList.toggle("muted", v.muted);
    // 42 and 11 are no ordinary volumes: the bar turns violet and sparkles at its end.
    const magic = percent === 42 || percent === 11;
    if (magic) this.volumeSpark.style.left = `${Math.round(25 + level * 112 - 5)}px`;
    if (magic && !this.volumeHud.classList.contains("magic")) replay(this.volumeHud, "magic");
    else this.volumeHud.classList.toggle("magic", magic);
    this.showHud("volume", VOLUME_SECONDS);
  }

  /** The battery as Windows 11 draws it: a rounded body, the level inside, the bolt over it. */
  private buildPowerHud() {
    const ns = "http://www.w3.org/2000/svg";
    const el = (tag: string, attrs: Record<string, string>) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    const svg = el("svg", { viewBox: "0 0 32 16", class: "battery" });
    svg.append(
      el("rect", { x: "0.9", y: "0.9", width: "27", height: "14.2", rx: "4.2", class: "body" }),
      el("rect", { x: "29.2", y: "5.3", width: "2.2", height: "5.4", rx: "1.1", class: "nub" }),
      el("rect", { x: "3", y: "3", width: "22.8", height: "10", rx: "2.4", class: "fill" }),
      el("path", { d: "M15.9 2.6 10.3 9.1h3.5l-1.2 4.3 5.7-6.6h-3.6l1.2-4.2z", class: "bolt" }),
    );
    this.powerText = h("span", { class: "pct" });
    this.powerHud = h("div", { id: "power-hud" }, svg as unknown as HTMLElement, this.powerText);
  }

  /**
   * The charger was plugged in or out (Rust's `power`): the island stretches, the
   * battery springs in and, plugged in, fills up in green with the bolt popping over
   * it while Puhu is glad. Unplugged, just the level (red when low).
   */
  showPower(p: { charging: boolean; level: number }) {
    if (p.charging && p.level < 5) {
      this.surprise("intime");
      return;
    }
    if (State.paused || State.mode === "expanded") return;
    const level = Math.max(0, Math.min(100, p.level));
    this.powerHud.style.setProperty("--level", String(Math.max(0.08, level / 100)));
    this.powerText.textContent = `${level}%`;
    this.powerHud.classList.toggle("charging", p.charging);
    this.powerHud.classList.toggle("low", !p.charging && level <= 20);
    // Replayed each time: the fill and the bolt animate from the start.
    this.powerHud.classList.remove("play");
    void this.powerHud.offsetWidth;
    this.powerHud.classList.add("play");
    // Plugged in, he sips from a battery-shaped juice box as the battery fills.
    this.showHud("power", POWER_SECONDS);
    if (p.charging) this.engine.sip();
  }

  /**
   * Focus play's evening reminder (core/progress.ts emberDue): once a day, from its time,
   * while the streak waits for the day's first round, a short word with the ember. Nothing
   * stays on the closed island.
   */
  private tellEmber() {
    if (!progress.ember || State.paused || State.inGame || State.mode === "expanded" || this.hudKind) return;
    const today = dayKey(new Date());
    try {
      if (localStorage.getItem(EMBER_KEY) === today) return;
      localStorage.setItem(EMBER_KEY, today);
    } catch {
      return;
    }
    this.showInfo(flame("orange", 14) as unknown as HTMLElement, t("Your streak waits: a round today?"), "#ff8a3d", 4);
  }

  /** A short note in the compact island (an output, an app at the camera…): an icon and a line. */
  private buildInfoHud() {
    this.infoText = h("span", { class: "text" });
    this.infoIcon = h("span", { class: "icon" });
    this.infoHud = h("div", { id: "info-hud" }, this.infoIcon, this.infoText);
    this.privacyDot = h("i", { id: "privacy-dot" });
  }

  /** The note for `seconds`: the island stretches as much as the line needs. */
  private showInfo(icon: string | Element, text: string, color: string, seconds: number, keepWidth = false) {
    if (State.paused || State.mode === "expanded") return;
    this.songShown = null;
    this.infoAction = null;
    // The same cover kept in place is not put in again (that would play its arrival again).
    if (icon !== this.infoIcon.firstElementChild) this.infoIcon.replaceChildren(typeof icon === "string" ? svg(icon, 16) : icon);
    this.infoText.textContent = text;
    this.infoHud.style.setProperty("--info", color);
    // Its width, read once now, keeps it on whole pixels and tells the island how much room to make;
    // kept wider for a shorter line, the line stays centred in it.
    // Measured at its own width: the folded island it sits in is narrower than the line for now.
    // offsetWidth rounds the line's width; a pixel more keeps a fraction from cutting its end.
    this.infoHud.style.width = "max-content";
    const w = Math.ceil((this.infoHud.offsetWidth + 1) / 2) * 2;
    this.infoW = keepWidth ? Math.max(this.infoW, w) : w;
    this.infoHud.style.width = `${this.infoW}px`;
    this.showHud("info", seconds);
  }

  /**
   * Focus play's moments (island/progress.ts): the day's flame lighting, the goal, a
   * level, a shield that kept the streak. One after another, after the Pomodoro's own
   * peek, never over the open island, a full-screen app or a presentation.
   */
  celebrate(moments: Moment[]) {
    this.moments.push(...moments);
    if (this.momentTimer == null) this.nextMoment(MOMENT_POLL_MS);
  }

  private nextMoment(delay: number) {
    this.momentTimer = window.setTimeout(() => {
      void Bridge.presenting().then((busy) => {
        this.momentTimer = null;
        const m = this.moments[0];
        if (!m) return;
        // Another peek first (it shows what just happened); this one right after it.
        if (this.hudKind != null) {
          this.nextMoment(MOMENT_POLL_MS);
          return;
        }
        if (busy) {
          this.nextMoment(MOMENT_PRESENTING_MS);
          return;
        }
        if (State.paused || State.mode === "expanded" || State.waitingCard) {
          this.nextMoment(MOMENT_RETRY_MS);
          return;
        }
        this.moments.shift();
        this.playMoment(m);
        if (this.moments.length > 0) this.nextMoment(MOMENT_POLL_MS);
      });
    }, delay);
  }

  private playMoment(m: Moment) {
    switch (m.kind) {
      case "shield":
        this.showInfo(svg(SHIELD_ICON, 16, { stroke: 2 }), t("A shield kept your streak"), SHIELD_COLOR, MOMENT_SECONDS);
        this.engine.triggerEmote("happy");
        Sound.play("blip");
        break;
      case "streak": {
        const tier = flameTier(m.to);
        const icon = flame(tier, 17);
        icon.classList.add("lit");
        const text = tn("{count}-day streak", "{count}-day streak", m.to);
        this.showInfo(icon as unknown as HTMLElement, text, FLAME_COLOR[tier], MOMENT_SECONDS);
        this.rollNumber(text, m.from, m.to);
        this.engine.triggerEmote(m.milestone ? "proud" : "happy");
        if (m.milestone) {
          this.engine.flutter();
          this.engine.emit("star", 8);
        }
        Sound.play(m.milestone ? "proud" : "pop");
        return;
      }
      case "goal":
        this.showInfo(this.goalIcon(), t("Today's goal: done!"), POMODORO_COLOR.focus, MOMENT_SECONDS);
        this.engine.triggerEmote("proud");
        this.engine.emit("star", 6);
        Sound.play("proud");
        return;
      case "level":
      case "badge":
        this.showToast(m);
        return;
      case "quest": {
        const def = QUESTS.find((q) => q.id === m.id);
        if (!def) return;
        const tick = h("span", { class: "medal" }, svg("M7.5 12.4l3 3 6-6.4", 12, { stroke: 2.6 }) as unknown as HTMLElement);
        tick.style.setProperty("--medal", "#ffb340");
        this.showInfo(tick, t("Quest done: {quest}", { quest: def.text(m.target) }), "#ffb340", MOMENT_SECONDS);
        this.engine.triggerEmote("happy");
        Sound.play("pop");
        break;
      }
      case "race":
        this.showInfo(svg("M5 21V4M5 4h11l-2 4 2 4H5", 16, { stroke: 2 }), t("Last week, you beat the week before!"), "#7ee0a1", MOMENT_SECONDS);
        this.engine.raiseWing();
        this.engine.emit("star", 6);
        Sound.play("proud");
        break;
      case "egg": {
        // It wobbles, cracks, and what it held comes out (the line waits for it).
        const prize = m.reward.kind === "feathers" ? FEATHER_ICON : m.reward.kind === "shield" ? SHIELD_ICON : STAR_ICON;
        const egg = h("span", { class: "egg-hatch" },
          h("span", { class: "shell" }, svg(EGG_ICON, 16, { stroke: 2 }) as unknown as HTMLElement),
          h("span", { class: "prize" }, svg(prize, 14, { stroke: 2 }) as unknown as HTMLElement),
        );
        this.showInfo(egg, t("The egg hatched: {prize}", { prize: eggText(m.reward) }), "#ffd166", MOMENT_SECONDS + 1);
        replay(this.infoHud, "hatch");
        window.setTimeout(() => {
          this.engine.triggerEmote("surprised");
          this.engine.emit("star", 6);
          Sound.play("proud");
        }, 1000);
        return;
      }
    }
    replay(this.infoHud, "pop");
  }

  /** A poke: his reaction, and the thousandth one is a friend's. */
  private poke() {
    this.engine.slap();
    let pokes = 0;
    try {
      pokes = (Number(localStorage.getItem(POKES_KEY)) || 0) + 1;
      localStorage.setItem(POKES_KEY, String(pokes));
    } catch {
      // Not counted: no thousandth.
    }
    if (pokes === 1000) this.surprise("friend");
  }

  /**
   * Something unusual happened (core/secrets.ts): Puhu's own reaction, whether or not
   * focus play is on, and its secret badge the first time while it is.
   */
  surprise(id: string) {
    const e = this.engine;
    switch (id) {
      case "friend":
      case "missed":
        e.triggerEmote("love");
        e.emit("heart", 10);
        break;
      case "answer":
        e.slowBlink();
        e.triggerEmote("proud");
        break;
      case "eleven":
      case "paparazzi":
        e.raiseWing();
        e.triggerEmote("wink");
        break;
      case "shouting":
        e.squash();
        e.triggerEmote("surprised");
        break;
      case "noticed":
        e.triggerEmote("love");
        break;
      case "hello":
      case "mirror":
        e.raiseWing();
        e.triggerEmote("happy");
        break;
      case "danger":
        e.triggerEmote("surprised");
        e.emit("sweat", 3);
        break;
      case "wish":
      case "leet":
      case "programmer":
        e.slowBlink();
        e.emit("spark", 6);
        break;
      case "moon":
        e.hoot(3);
        break;
      case "konami":
      case "april":
        e.doRoll(1100, 1);
        e.emit("star", 6);
        break;
      case "intime":
        e.emit("sweat", 2);
        e.triggerEmote("happy");
        break;
      case "tinkerer":
        e.fidget();
        break;
      case "caught":
        e.peer();
        e.triggerEmote("annoyed");
        break;
      case "newyear":
        e.hoot(2);
        e.emit("star", 12);
        break;
    }
    this.ensureRunning();
    const peek = SURPRISE_PEEKS[id];
    const show = () => {
      if (!peek) return;
      this.showInfo(svg(peek.icon, 16, { stroke: 2 }), peek.line(), peek.color, 2.4);
      replay(this.infoHud, peek.move);
    };
    // The Konami code is typed into the open island: it folds, then the line shows.
    if (id === "konami" && State.mode === "expanded") {
      this.collapse();
      window.setTimeout(show, 450);
    } else {
      show();
    }
    void awardSecret(id);
  }

  /** Puhu pressed: past a tap, a ring fills round him, and his card opens when it closes. */
  private startHold() {
    this.endHold(false);
    const timer = window.setTimeout(() => {
      const d = this.botSize.value + 14;
      const r = d / 2 - 2;
      const c = 2 * Math.PI * r;
      this.holdRing.setAttribute("width", String(d));
      this.holdRing.setAttribute("height", String(d));
      const circle = this.holdRing.firstElementChild as SVGCircleElement;
      circle.setAttribute("cx", String(d / 2));
      circle.setAttribute("cy", String(d / 2));
      circle.setAttribute("r", String(r));
      this.holdRing.style.setProperty("--c", c.toFixed(2));
      this.holdRing.style.left = `${snapPx(this.botCx.value - d / 2)}px`;
      this.holdRing.style.top = `${snapPx(this.botCy.value - d / 2)}px`;
      void this.holdRing.getBoundingClientRect();
      this.holdRing.classList.add("filling");
      this.engine.blink();
      this.hold = { timer: window.setTimeout(() => this.openPuhuCard(), HOLD_FILL_MS), filling: true };
    }, HOLD_DELAY_MS);
    this.hold = { timer, filling: false };
  }

  /** Let go, or moved away: a press too short to be a hold was a poke. */
  private endHold(poke: boolean) {
    const hold = this.hold;
    if (!hold) return;
    window.clearTimeout(hold.timer);
    this.hold = null;
    this.holdRing.classList.remove("filling");
    if (poke && !hold.filling) this.poke();
  }

  private openPuhuCard() {
    this.hold = null;
    this.holdRing.classList.remove("filling");
    Sound.play("pop");
    this.engine.triggerEmote("happy");
    this.setView("puhuCard");
  }

  /**
   * A badge or a level: the island opens on it for a few seconds (views/badgetoast.ts),
   * Puhu celebrating beside it, then folds unless the pointer is in it; a click on it
   * opens his card.
   */
  private showToast(m: Moment) {
    Toast.moment = m;
    Toast.generation++;
    this.alert("badgeToast");
    this.engine.triggerEmote("proud");
    this.engine.flutter();
    this.engine.emit("star", 10);
    Sound.play("proud");
    if (this.toastTimer != null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      if (State.mode === "expanded" && State.view === "badgeToast" && !this.wasInIsland) this.collapse();
    }, TOAST_SECONDS * 1000);
  }

  /** The streak's number turns over like a counter: the old one rolls up and out, the new one in. */
  private rollNumber(text: string, from: number, to: number) {
    const n = String(to);
    const at = text.indexOf(n);
    if (at < 0 || from === to) return;
    const roll = h("span", { class: "roll" }, h("span", { class: "old", text: String(from) }), h("span", { class: "new", text: n }));
    this.infoText.replaceChildren(text.slice(0, at), roll, text.slice(at + n.length));
  }

  /** The day's goal: a ring that closes, and a tick in it. */
  private goalIcon(): HTMLElement {
    const ns = "http://www.w3.org/2000/svg";
    const el = document.createElementNS(ns, "svg");
    el.setAttribute("viewBox", "0 0 24 24");
    el.setAttribute("width", "17");
    el.setAttribute("height", "17");
    el.setAttribute("class", "goal-icon");
    const ring = document.createElementNS(ns, "circle");
    ring.setAttribute("cx", "12");
    ring.setAttribute("cy", "12");
    ring.setAttribute("r", "9");
    ring.setAttribute("class", "ring");
    const tick = document.createElementNS(ns, "path");
    tick.setAttribute("d", "M8 12.4l2.7 2.7L16 9.8");
    tick.setAttribute("class", "tick");
    el.append(ring, tick);
    return el as unknown as HTMLElement;
  }

  /** Caps Lock on or off: its key and the case it types now, ABC or abc. */
  showCaps(on: boolean) {
    this.showInfo(svg(CAPS_ICON, 16, { stroke: 2 }), on ? "ABC" : "abc", on ? "#64b5ff" : "#ffffff", 1.4);
    replay(this.infoHud, "pop");
    if (on) this.engine.triggerEmote("surprised");
    const now = performance.now();
    this.capsTurns = [...this.capsTurns.filter((at) => now - at < SHOUT_MS), now];
    if (this.capsTurns.length >= SHOUT_TOGGLES) {
      this.capsTurns = [];
      this.showInfo(svg(CAPS_ICON, 16, { stroke: 2 }), `${t("WHY ARE WE SHOUTING")}?!`, "#ff6b6b", 2.2);
      replay(this.infoHud, "shake");
      this.surprise("shouting");
    }
  }

  /**
   * The internet lost (after a moment without it, so a blip says nothing) or back once
   * it had been said to be lost.
   */
  showNetwork(online: boolean) {
    if (this.offlineTimer != null) window.clearTimeout(this.offlineTimer);
    this.offlineTimer = null;
    if (!online) {
      this.offlineTimer = window.setTimeout(() => {
        this.offlineTimer = null;
        this.offlineShown = true;
        // He puts up an antenna and looks round for the signal.
        this.showInfo(svg(OFFLINE_ICON, 16, { stroke: 2 }), t("No internet"), NETWORK_COLOR.offline, 3);
        this.engine.searchSignal(3000);
      }, OFFLINE_AFTER_MS);
      return;
    }
    if (!this.offlineShown) return;
    this.offlineShown = false;
    // The antenna's tip lights up green, a hop, and it folds away.
    this.showInfo(svg(ONLINE_ICON, 16, { stroke: 2 }), t("Back online"), NETWORK_COLOR.online, 2.2);
    this.engine.foundSignal();
  }

  /**
   * Game mode (game.rs): a game fills the screen. Puhu wishes a good game with a wave of
   * his wing and steps aside: the island folds to nothing, nothing moves or sounds, and
   * what comes in waits. When the game is over he is back, with what happened.
   */
  setGame(on: boolean, quiet = false) {
    if (on) {
      if (State.inGame || this.gameTimer != null) return;
      State.gameNews = { done: 0, terminal: 0 };
      awardSecret("gamer");
      const wave = State.mode !== "expanded";
      if (wave) {
        this.showInfo(svg(GAMEPAD_ICON, 16, { stroke: 2 }), t("Have a good game!"), GAME_COLOR, GAME_WAVE_S);
        this.engine.triggerEmote("happy");
        this.engine.raiseWing();
      }
      this.gameTimer = window.setTimeout(() => {
        this.gameTimer = null;
        State.inGame = true;
        Sound.quiet = true;
        this.fsm.forceHidden();
        this.updateClosed();
        State.notify();
      }, wave ? GAME_WAVE_S * 1000 + 300 : 0);
      return;
    }
    // Back before he had stepped aside: nothing to tell.
    if (this.gameTimer != null) {
      window.clearTimeout(this.gameTimer);
      this.gameTimer = null;
      return;
    }
    if (!State.inGame) return;
    State.inGame = false;
    Sound.quiet = false;
    this.updateClosed();
    State.notify();
    // Called in (Ask the screen): the chat opens instead of the welcome back.
    if (quiet) return;
    const { done, terminal } = State.gameNews;
    const parts = [t("Welcome back!")];
    if (done > 0) parts.push(t("Done while you played: {count}", { count: done }));
    if (terminal > 0) parts.push(t("In the terminal: {count}", { count: terminal }));
    this.showInfo(svg(GAMEPAD_ICON, 16, { stroke: 2 }), parts.join(" · "), GAME_COLOR, parts.length > 1 ? 4 : 2.2);
    this.engine.triggerEmote("happy");
  }

  /**
   * Guard mode (away.rs): an agent works while nobody is at the computer, so Puhu keeps
   * watch. The closed island stretches into a lane and he walks up and down it, a
   * lantern's light going with him. When someone is back, like a car on guard he is
   * startled and his lantern flashes; then he knows them, and tells what happened
   * meanwhile (nothing happened, nothing said).
   */
  setAway(on: boolean) {
    if (on) {
      State.away = true;
      State.awayNews = { done: 0, asked: 0 };
      const g = this.guard;
      this.guardLane = true;
      g.pos = 0.5;
      g.leg = null;
      g.seen = performance.now();
      g.until = g.seen + GUARD_FIRST_MS;
      // The compact island folds into the lane, unless a card waits in it.
      if (State.mode === "compact" && !this.fsm.pinned && !State.isPinned && !this.hudKind) this.fsm.forceHidden();
      this.updateClosed();
      this.wakeGuard(GUARD_FIRST_MS);
      return;
    }
    if (!State.away) return;
    State.away = false;
    const { done, asked } = State.awayNews;
    const caught = State.mode === "hidden" && this.guarding && !this.hudKind;
    if (this.guardTimer != null) window.clearTimeout(this.guardTimer);
    this.guardTimer = null;
    this.guard.leg = null;
    this.engine.stride = 0;
    if (caught) {
      // Who's there? He turns to them at once, eyes wide, and the lantern flashes.
      this.engine.anim("swivel", [[0, 160, Ease.out]]);
      this.engine.triggerEmote("surprised", GUARD_ALERT_MS / 1000);
      this.closedLook = { x: 0, y: -0.6 };
      this.guardFlashUntil = performance.now() + GUARD_ALERT_MS * 0.6;
      this.closedAwakeUntil = performance.now() + GUARD_ALERT_MS;
      this.ensureRunning();
    }
    window.setTimeout(() => {
      this.guardLane = false;
      this.closedLook = { x: 0, y: 0 };
      this.updateClosed();
      if (done === 0 && asked === 0) {
        if (caught) this.engine.triggerEmote("happy");
        window.setTimeout(() => this.evening(), 1500);
        return;
      }
      // No "Welcome back!" first: beside the sessions the line has little room.
      const parts: string[] = [];
      if (done > 0) parts.push(t("Done while you were away: {count}", { count: done }));
      if (asked > 0) parts.push(t("Asked for you: {count}", { count: asked }));
      this.showInfo(svg(GUARD_ICON, 16, { stroke: 2 }), parts.join(" · "), GUARD_COLOR, 4);
      this.engine.triggerEmote("happy");
      this.engine.raiseWing();
    }, caught ? GUARD_ALERT_MS : 0);
  }

  /** Today's list: he takes the slip, catches the plane, or the whole day is done. */
  private todayReact(kind: "added" | "done" | "allDone" | "blow") {
    if (kind === "blow") {
      this.engine.blow();
      window.setTimeout(() => Sound.play("send"), 380);
    } else if (kind === "added") {
      Sound.play("pop");
      this.engine.peer();
    } else if (kind === "done") {
      Sound.play("approve");
      this.engine.squash();
      this.engine.triggerEmote("happy");
    } else {
      Sound.play("proud");
      this.engine.hopFlight();
      this.engine.triggerEmote("proud");
    }
    this.ensureRunning();
  }

  /**
   * Once a day, the first time someone is at the computer (Puhu starting, the screen
   * coming back on): a short peek at what there is to do today, unrolling like a scroll.
   * Never over the open island, a full-screen app or a game; a click opens the list.
   */
  morning() {
    const now = new Date();
    const today = dayKey(now);
    let shown: string | null = null;
    try {
      shown = localStorage.getItem(MORNING_KEY);
    } catch {
      // Shown again, at worst.
    }
    const list = Today.list();
    if (now.getHours() < 5 || shown === today || list.length === 0) return;
    if (State.paused || State.inGame || State.mode === "expanded" || this.hudKind) return;
    void Bridge.presenting().then((busy) => {
      if (busy || State.mode === "expanded" || this.hudKind) return;
      try {
        localStorage.setItem(MORNING_KEY, today);
      } catch {
        // As above.
      }
      const carried = Today.carried();
      const parts = [t("Today: {count} to do", { count: list.length })];
      if (carried > 0) parts.push(t("From before: {count}", { count: carried }));
      this.showInfo(svg(ICONS.checklist, 16, { stroke: 2 }), parts.join(" · "), TODAY_COLOR, MORNING_S);
      replay(this.infoHud, "unroll");
      this.infoAction = () => this.alert("today");
      this.engine.raiseWing();
      this.ensureRunning();
    });
  }

  /** An agent's hook while the user is away: he walks his rounds while the work goes on. */
  keepWatch() {
    this.guard.seen = performance.now();
    if (this.guardLane && !this.guard.leg && this.guardTimer == null) {
      this.wakeGuard(this.guard.until - this.guard.seen);
    }
  }

  private wakeGuard(ms: number) {
    if (this.guardTimer != null) window.clearTimeout(this.guardTimer);
    this.guardTimer = window.setTimeout(() => {
      this.guardTimer = null;
      this.ensureRunning();
    }, Math.max(0, ms));
  }

  /**
   * One frame of the patrol: a walk down the lane, eased at both ends, or a stand at its
   * end, where he looks out and round, then waits with the loop asleep. Once the work has
   * been quiet a while, he stands at his post.
   */
  private patrol(nowMs: number) {
    const g = this.guard;
    // Back (the lane still out while he is startled), or the lane not shown: no walking.
    if (!State.away || State.mode !== "hidden" || !this.guarding || this.hudKind) {
      this.engine.stride = 0;
      return;
    }
    if (!g.leg && nowMs >= g.until && this.guardTimer == null && nowMs - g.seen < GUARD_LINGER_MS) {
      g.leg = { from: g.pos, to: g.pos < 0.5 ? 1 : 0, at: nowMs };
    }
    const leg = g.leg;
    if (!leg) {
      this.engine.stride = 0;
      return;
    }
    const p = Math.min(1, (nowMs - leg.at) / GUARD_LEG_MS);
    g.pos = leg.from + ((leg.to - leg.from) * (1 - Math.cos(Math.PI * p))) / 2;
    this.engine.stride = Math.min(1, Math.sin(Math.PI * p) * 1.8);
    this.engine.strideDir = leg.to > leg.from ? 1 : -1;
    if (p < 1) return;
    g.leg = null;
    this.engine.stride = 0;
    g.until = nowMs + GUARD_STAND_MS * (1 + Math.random());
    this.closedLook = { x: (Math.random() * 2 - 1) * 0.4, y: -0.35 };
    if (Math.random() < 0.5) this.engine.lookBehind();
    else this.engine.peer();
    this.closedAwakeUntil = nowMs + 1400;
    this.wakeGuard(g.until - nowMs);
  }

  /** A download finished: its name; a click shows it in its folder. */
  showDownload(name: string) {
    this.showInfo(svg(DOWNLOAD_ICON, 16, { stroke: 2 }), name, "#64b5ff", 4);
    this.infoAction = () => void Bridge.revealLastDownload();
    replay(this.infoHud, "pop");
    this.engine.triggerEmote("proud");
  }

  /**
   * Text copied anywhere: a link by its site, a colour by a swatch of it, several lines
   * by the first; a password or a key only as dots, and Puhu shuts his eyes for it.
   */
  showCopied(text: string) {
    if (State.settings.copiedPeek === false) return;
    // Something he knows: his own line instead of the usual one.
    const secret = copiedSecret(text);
    if (secret) {
      this.surprise(secret);
      return;
    }
    const peek = readCopied(text);
    // An error: one click asks Puhu what it means.
    if (peek.kind === "error") {
      const label = State.settings.copiedText ? peek.label : t("An error");
      this.showInfo(svg(COPIED_ICONS.error, 16, { stroke: 2 }), `${label} · ${t("Ask Puhu")}`, "#ff9b8f", 5);
      this.infoAction = () => this.askCopied();
      replay(this.infoHud, "pop");
      this.engine.triggerEmote("surprised");
      return;
    }
    // Unless the text itself is wanted, only what it is: an address, so many lines or characters.
    if (!State.settings.copiedText) {
      if (peek.kind === "email") peek.label = t("An e-mail address");
      if (peek.kind === "multiline") peek.label = t("{count} lines", { count: String(peek.count) });
      if (peek.kind === "text") peek.label = t("{count} characters", { count: String(peek.count) });
    }
    const icon = peek.kind === "color"
      ? h("span", { class: "swatch", style: `background:${peek.color}` })
      : svg(COPIED_ICONS[peek.kind], 16, { stroke: 2 });
    this.showInfo(icon, peek.label, peek.kind === "secret" ? "#ffb340" : "#c7cbd3", 1.8);
    replay(this.infoHud, "pop");
    if (peek.kind === "secret") this.engine.slowBlink();
  }

  /** A new song: the island opens (or stretches) for a moment on its cover, title and artist. */
  showSong(player: Player) {
    // Not over a full-screen app or a presentation: asked first, then the song as it is by then.
    void Bridge.presenting().then((busy) => {
      if (!busy) this.showSongNow(player);
    });
  }

  private showSongNow(player: Player) {
    const track = player.state.track;
    if (!track?.title || State.paused || State.mode === "expanded") return;
    // Skipping through songs, the line changes in place and the island only grows
    // until the last one has had its moment.
    const chained = this.hudKind === "info" && this.songShown === player;
    const line = track.artist ? `${track.title} · ${track.artist}` : track.title;
    this.showInfo(this.songIcon(player, chained), line, CoverColor.css(1, "#1ed760"), SONG_SECONDS, chained);
    this.songShown = player;
    // A next song slides its line in; the same song's second report (its artist) only fills it in.
    const now = performance.now();
    if (chained && now - this.songAt > 300) replay(this.infoHud, "swap");
    this.songAt = now;
  }

  /**
   * The song on show got its cover, or a better one (a browser's own icon comes first,
   * the page's cover once loaded): it takes its place. Covers coming one after another
   * while songs are skipped are taken at most every so often, not each one in a flash.
   */
  songCover(player: Player) {
    if (this.coverTimer != null) return;
    this.coverTimer = window.setTimeout(() => {
      this.coverTimer = null;
      if (this.hudKind !== "info" || this.songShown !== player) return;
      const icon = this.songIcon(player, true);
      if (icon !== this.infoIcon.firstElementChild) this.infoIcon.replaceChildren(icon);
    }, 160);
  }

  /**
   * The song's cover in one image kept for it (its source swaps; it is not put in again),
   * else the note. Skipping songs, the last cover stays until the next one comes.
   */
  private songIcon(player: Player, keep: boolean): Element {
    const art = currentArtwork(player.state, player);
    const shown = this.infoIcon.firstElementChild;
    if (!art) return keep && shown === this.coverImg ? shown : svg(ICONS.musicNote, 16);
    if (this.coverImg.getAttribute("src") !== art) this.coverImg.setAttribute("src", art);
    return this.coverImg;
  }

  /**
   * An image landed on the clipboard (Rust's `screenshot`: Win+Shift+S, Print Screen,
   * an image copied anywhere): the island opens around a small copy of it for a few
   * seconds; a click on it opens the image.
   */
  showShot(s: { thumb: string; width: number; height: number; name: string }) {
    if (State.paused || State.mode === "expanded" || !(s.width > 0 && s.height > 0)) return;
    this.surprise("paparazzi");
    // Paparazzi: the camera's flash goes off over the picture as it lands.
    replay(this.shotEl, "flash");
    const scale = Math.min(SHOT_W / s.width, SHOT_H / s.height);
    this.shotSize = { w: Math.max(40, Math.round(s.width * scale)), h: Math.max(24, Math.round(s.height * scale)) };
    this.shotImg.style.width = `${this.shotSize.w}px`;
    this.shotImg.style.height = `${this.shotSize.h}px`;
    this.shotImg.src = s.thumb;
    this.shotThumb = s.thumb;
    this.shotName = s.name;
    this.shotPx = { w: s.width, h: s.height };
    this.shotSaved = false;
    // The viewer, should it be opened: the picture as large as it fits, never past its own size.
    const fit = Math.min(VIEW_IMG_W / s.width, VIEW_IMG_H / s.height, 1);
    const iw = Math.max(40, Math.round(s.width * fit));
    const ih = Math.max(24, Math.round(s.height * fit));
    const vw = Math.max(VIEW_MIN_W, iw + 2 * VIEW_PAD + VIEW_SIDE);
    const vh = Math.max(VIEW_MIN_H, ih + 2 * VIEW_PAD);
    this.viewSize = { w: vw, h: vh, img: { left: VIEW_PAD + (vw - 2 * VIEW_PAD - VIEW_SIDE - iw) / 2, top: (vh - ih) / 2, w: iw, h: ih } };
    Sound.play("pop");
    this.showHud("shot", SHOT_SECONDS);
  }

  /** The screenshot viewer is open. */
  private get viewing(): boolean {
    return State.mode === "expanded" && State.view === "shot";
  }

  /** The viewer's column beside the picture: its size, then Save and Open. */
  private buildViewer() {
    this.viewMeta = h("div", { class: "meta" });
    this.viewSave = h("button", { class: "btn primary", onclick: () => void this.saveShot() }) as HTMLButtonElement;
    const open = h(
      "button",
      { class: "btn secondary", onclick: () => this.openShot() },
      svg(ICONS.arrowUpRight, 13) as unknown as HTMLElement,
      h("span", { text: tl("Open") }),
    );
    this.viewSide = h("div", { id: "shot-side" }, this.viewMeta, this.viewSave, open);
    this.shotImg.addEventListener("click", () => this.openShot());
  }

  /** Puhu in the viewer: at the top of its column, beside the picture. */
  private viewBot() {
    return { cx: this.viewSize.w - VIEW_PAD - VIEW_SIDE / 2, cy: VIEW_PAD + 30, diameter: 40, opacity: 1 };
  }

  /**
   * A click on the peek: the island opens around the picture, which grows with it,
   * and offers to save it or open it. A click anywhere else closes it.
   */
  private openViewer() {
    this.viewFrom = {
      left: (this.width.value - this.shotSize.w) / 2,
      top: SHOT_PAD,
      w: this.shotSize.w,
      h: this.shotSize.h,
      islandH: this.height.value,
    };
    this.endHud();
    this.viewMeta.textContent = `${this.shotPx.w} × ${this.shotPx.h}`;
    this.syncSave();
    this.fsm.forceHome();
    this.expand("shot");
    // Hidden behind the peek until now, Puhu appears in his place rather than crossing the picture.
    const p = this.viewBot();
    this.botCx.set(p.cx);
    this.botCy.set(p.cy);
    this.botSize.set(0);
    // The peek's copy is small: a sharper one replaces it once it is decoded.
    const name = this.shotName;
    void Bridge.screenshotView(name).then(async (url) => {
      if (!url || name !== this.shotName || !this.viewing) return;
      const sharp = new Image();
      sharp.src = url;
      try {
        await sharp.decode();
      } catch {
        return;
      }
      if (name === this.shotName && this.viewing) this.shotImg.src = url;
    });
  }

  private syncSave() {
    this.viewSave.replaceChildren(
      svg(this.shotSaved ? ICONS.check : SAVE_ICON, 13) as unknown as HTMLElement,
      h("span", { text: this.shotSaved ? tl("Show in folder") : tl("Save") }),
    );
    this.viewSave.classList.toggle("primary", !this.shotSaved);
    this.viewSave.classList.toggle("secondary", this.shotSaved);
  }

  /** Save: a PNG beside Windows' own screenshots; once saved, the button shows its folder. */
  private async saveShot() {
    if (this.shotSaved) {
      void Bridge.revealSavedScreenshot();
      return;
    }
    const name = this.shotName;
    if ((await Bridge.saveScreenshot(name, t("Screenshot"))) && name === this.shotName) {
      this.shotSaved = true;
      this.syncSave();
      this.engine.triggerEmote("happy");
    }
  }

  private openShot() {
    if (!this.viewing) return;
    void Bridge.openScreenshot(this.shotName);
    this.collapse();
  }

  /**
   * The default output changed (Rust's `audio-output`): headphones put on, the island
   * says which and Puhu is glad; back to the speakers, it says that too.
   */
  showOutput(o: { name: string; headphones: boolean }) {
    // Headphones: he puts a pair on too, for as long as they are named.
    if (o.headphones) {
      this.phonesUntil = performance.now() + 2400;
    }
    this.showInfo(o.headphones ? HEADPHONES_ICON : ICONS.speakerOn, o.name, o.headphones ? "#64b5ff" : "#ffffff", 2.4);
    if (o.headphones) this.engine.triggerEmote("love");
  }

  /**
   * Who has the camera or the microphone (Rust's `privacy`): a dot at the island's
   * right edge for as long as one of them is in use, green for the camera, orange for
   * the microphone; and when an app takes one, its name for a moment.
   */
  showPrivacy(p: { mic: string[]; camera: string[] }) {
    const camera = p.camera.length > 0;
    const mic = p.mic.length > 0;
    this.privacyDot.classList.toggle("on", camera || mic);
    this.privacyDot.style.setProperty("--dot", camera ? CAMERA_COLOR : MIC_COLOR);
    const newCamera = p.camera.find((a) => !this.privacyApps.camera.includes(a));
    const newMic = p.mic.find((a) => !this.privacyApps.mic.includes(a));
    this.privacyApps = p;
    // On camera he smooths his feathers and stands up straight; a microphone, he listens.
    if (newCamera) {
      this.showInfo(CAMERA_ICON, newCamera, CAMERA_COLOR, 2.2);
      this.engine.preen();
    } else if (newMic) {
      this.showInfo(MIC_ICON, newMic, MIC_COLOR, 2.2);
      this.engine.perk(1800);
    }
  }

  /** The Pomodoro's place in the compact island (a ring and what is left) and its phase indicator. */
  private buildPomodoro() {
    const ns = "http://www.w3.org/2000/svg";
    const ring = document.createElementNS(ns, "svg");
    ring.setAttribute("viewBox", "0 0 18 18");
    const circle = (cls: string) => {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", "9");
      c.setAttribute("cy", "9");
      c.setAttribute("r", "7.2");
      c.setAttribute("class", cls);
      ring.append(c);
      return c;
    };
    circle("track");
    this.pomodoroRing = circle("ring");
    this.pomodoroRing.setAttribute("stroke-dasharray", RING.toFixed(2));
    this.pomodoroTime = h("span", { class: "time" });
    this.pomodoroStreak = h("span", { class: "pomo-streak" });
    this.pomodoroEl = h("div", { id: "pomodoro" }, ring as unknown as HTMLElement, this.pomodoroTime, this.pomodoroStreak);
    this.pomodoroHudText = h("span", { class: "label" });
    this.pomodoroHud = h("div", { id: "pomodoro-hud" }, svg(ICONS.timer, 15) as unknown as HTMLElement, this.pomodoroHudText);
    Pomodoro.onTick(() => this.syncPomodoro());
    Pomodoro.onPhase((phase) => this.pomodoroPhase(phase));
  }

  /**
   * A running Pomodoro shows where the island is, as a timer does on the Dynamic
   * Island: a ring and the time in the compact island, the time alone in the closed
   * one. Both turn over once a second; nothing animates in between.
   */
  private syncPomodoro() {
    const running = Pomodoro.running;
    if (State.mode === "hidden") {
      this.updateClosed();
      this.scheduleClosedLife();
    }
    this.islandEl.classList.toggle("pomo", running && State.mode === "compact");
    this.pomodoroEl.classList.toggle("paused", Pomodoro.paused);
    if (!running || !Pomodoro.phase) return;
    this.pomodoroEl.style.setProperty("--pomo", POMODORO_COLOR[Pomodoro.phase]);
    this.pomodoroRing.setAttribute("stroke-dashoffset", (RING * (1 - Pomodoro.progress())).toFixed(2));
    this.pomodoroTime.textContent = formatRemaining(Pomodoro.remaining());
    this.syncPomodoroStreak();
  }

  /**
   * Focus play's flame beside the running Pomodoro and the streak's days: pale until the
   * day's first round, lit after it. Redrawn only when it changes, never once a second.
   */
  private syncPomodoroStreak() {
    const s = progress.state;
    const lit = s.today.rounds > 0;
    const shown = progress.on && s.streak > 0;
    const key = shown ? `${flameTier(s.streak)}|${lit}|${s.streak}` : "";
    if (key === this.pomodoroStreakKey) return;
    this.pomodoroStreakKey = key;
    this.pomodoroStreak.replaceChildren();
    if (shown) {
      this.pomodoroStreak.append(flame(flameTier(s.streak), 12, !lit) as unknown as HTMLElement, String(s.streak));
    }
    this.pomodoroW = POMODORO_W + (shown ? POMODORO_STREAK_W : 0);
    this.pomodoroEl.style.width = `${this.pomodoroW}px`;
    this.applyGeometry();
  }

  /** A phase began on its own: a sound, Puhu, and for a moment what begins and for how long. */
  private pomodoroPhase(phase: PomodoroPhase) {
    Sound.play(phase === "focus" ? "work" : "finish");
    this.engine.triggerEmote(phase === "focus" ? "yawn" : "proud");
    if (State.mode === "expanded") return;
    const label = phase === "focus" ? tl("Focus") : phase === "long" ? tl("Long break") : tl("Break");
    this.pomodoroHudText.textContent = `${label} · ${formatRemaining(Pomodoro.length(phase))}`;
    this.pomodoroHud.style.setProperty("--pomo", POMODORO_COLOR[phase]);
    this.showHud("pomodoro", 3);
  }

  /**
   * One indicator in the middle of the compact island for `seconds`: the island
   * stretches for it with a little bounce, and gives the room back afterwards. From
   * folded, the island opens for it and folds again right after.
   */
  private showHud(kind: "volume" | "power" | "pomodoro" | "info" | "shot", seconds: number) {
    if (State.inGame) return;
    const fresh = this.hudKind !== kind;
    // Folded, the closed island stretches round the indicator by itself: no compact
    // island, no Puhu, nothing else to draw, and it springs back the same way.
    const closedPeek = State.mode === "hidden" && this.closedShows && !this.collapsed && kind !== "shot";
    this.hudKind = kind;
    this.islandEl.classList.add("hud");
    this.islandEl.dataset.hud = kind;
    if (closedPeek) {
      this.springClosed();
    } else {
      this.silentReveal = true;
      this.fsm.glance(seconds + 0.05);
      this.silentReveal = false;
    }
    if (State.mode === "compact" && !this.growing && (fresh || this.targetSize().w !== this.width.target)) {
      const { w, h, r } = this.targetSize();
      this.width.springTo(w, 0.42, 0.58);
      // The peek grows downwards too; the others keep the compact island's height.
      if (kind === "shot") {
        this.height.springTo(h, 0.45, 0.62);
        this.radius.springTo(r, 0.45, 0.7);
      }
      this.ensureRunning();
    }
    if (this.hudTimer != null) window.clearTimeout(this.hudTimer);
    this.hudTimer = window.setTimeout(() => {
      this.hudTimer = null;
      const wasCompact = State.mode === "compact";
      this.endHud();
      if (State.mode === "hidden") this.springClosed();
      else if (wasCompact) this.animateGeometry(true);
    }, seconds * 1000);
  }

  /** The waves have something to show: music is heard, or they are still settling. */
  private wavesMoving(): boolean {
    return MusicPulse.loud() > 0.01 || this.barVels.some((v) => Math.abs(v) > 0.002);
  }

  /**
   * The folded island to its size, an indicator stretching it or letting it go: firm, no
   * ringing (the indicator inside brings the bounce), so its edges stay put once there.
   */
  private springClosed() {
    const { w, h, r } = this.targetSize();
    this.width.springTo(w, 0.38, 0.9);
    this.height.springTo(h, 0.38, 0.9);
    this.radius.springTo(r, 0.38, 0.9);
    this.ensureRunning();
  }

  /** How wide an indicator is, for the island to make room for it. */
  private hudWidth(kind: "volume" | "power" | "pomodoro" | "info"): number {
    return kind === "volume" ? VOLUME_HUD_W : kind === "power" ? POWER_HUD_W : kind === "pomodoro" ? POMODORO_HUD_W : this.infoW;
  }

  private endHud() {
    if (this.hudTimer != null) window.clearTimeout(this.hudTimer);
    this.hudTimer = null;
    this.hudKind = null;
    this.songShown = null;
    this.infoAction = null;
    this.islandEl.classList.remove("hud");
    this.infoHud.classList.remove("unroll");
  }

  private drawBot(dt: number) {
    const size = this.botSize.value;
    const w = Math.max(1, Math.round(size));
    const hCss = w + BOT_OVERHANG;
    const wCss = w + BOT_SIDE * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Drawn at the current ratio, so a bitmap sized for another monitor's
    // would show Puhu too big and cut, or too small.
    if (this.canvasPx !== w || this.canvasDpr !== dpr) {
      this.canvasPx = w;
      this.canvasDpr = dpr;
      this.botCanvas.width = Math.round(wCss * dpr);
      this.botCanvas.height = Math.round(hCss * dpr);
      this.botCanvas.style.width = `${wCss}px`;
      this.botCanvas.style.height = `${hCss}px`;
    }
    // Inside the island whatever the springs do, on whole device pixels.
    const half = w * 0.3;
    const cx = Math.min(Math.max(this.botCx.value, half), Math.max(half, this.width.value - half));
    this.botCanvas.style.left = `${snapPx(cx - wCss / 2)}px`;
    this.botCanvas.style.top = `${this.botCy.value - BOT_OVERHANG / 2 - hCss / 2}px`;

    const ctx = this.botCanvas.getContext("2d");
    if (!ctx) return;

    // A new version waits: over an idle or sleeping Puhu, the blue and the arrow
    // badge (whats-new.ts). Anything Puhu has to say comes first.
    this.engine.setUpdateHint(this.updateHintOn() ? UPDATE_BLUE_RGB : null);
    // Puhu keeps his own colour whatever pill or plan card has the focus: the
    // colour is who he is; what he is doing shows in the island beside him.
    this.engine.bodyColor = this.engine.showsUpdateHint ? UPDATE_BLUE_RGB : null;
    // ...and in what he wears: headphones while music plays (and his gaming headset as
    // he wishes a good game), the focus band in the Pomodoro phase's colour, reading
    // glasses while an agent works.
    const agentBusy = ["working", "thinking", "searching"].includes(State.effectiveState);
    // Focus play's first question: he tries on the goal picked (glasses from 4 rounds, the band at 6).
    const trying = State.mode === "expanded" && State.view === "focusIntro" && FocusIntro.step === "goal" ? FocusIntro.goal : 0;
    const band = Pomodoro.phase ? hexToRGB(POMODORO_COLOR[Pomodoro.phase]) : trying >= 6 ? hexToRGB(POMODORO_COLOR.focus) : null;
    const phones = this.musicOn || this.gameTimer != null || performance.now() < this.phonesUntil;
    this.engine.setAccessories(phones, band, agentBusy || trying >= 4);
    this.engine.hideBadge = State.mode === "hidden";
    // Too small, and too few frames, in the closed island for his tufts to swing after a glance.
    this.engine.softLag = State.mode === "hidden" && !this.guarding ? 0 : 1;
    this.engine.particleOverhang = BOT_OVERHANG;
    this.engine.lookX = this.lookX();
    this.engine.lookY = this.lookY();
    // Dances while music plays: always in the compact island, expanded only on
    // the music pill's card. Asked every frame.
    const dancing = islandDances({
      music: State.spotifyPlaying,
      state: State.effectiveState,
      mode: State.mode,
      view: State.view,
      focusId: State.focusTask?.id,
    });
    this.engine.setDancing(dancing);
    // The bars stay through the gap between two songs; he stops dancing as the music does.
    const bars = State.mode === "compact" && islandDances({
      music: this.musicOn,
      state: State.effectiveState,
      mode: State.mode,
      view: State.view,
      focusId: State.focusTask?.id,
    });
    this.updateMusicBars(bars || this.closedWaves);

    // Gone into the middle for the waves or an indicator: nothing to draw until he comes back.
    if (State.mode === "hidden" && this.botSize.target === 0 && this.botSize.settled) return;
    this.engine.update(dt);
    // Cleared in device pixels, the whole canvas. At a fractional scale (150 %)
    // the canvas is a whole number of pixels but `hCss * dpr` is not: clearing
    // in CSS units left the last row half-cleared, and whatever once passed
    // through it (a hat in a roll) piled up there into a coloured bar.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.botCanvas.width, this.botCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, BOT_SIDE * dpr, 0);
    ctx.save();
    this.engine.applyDance(ctx, w, hCss);
    this.engine.draw(ctx, w, hCss);
    ctx.restore();
  }

  /** BotCanvasView.lookX / lookY — tanh of the distance to the bot. */
  private lookX(): number {
    // In the closed island the cursor isn't followed: he looks around by himself.
    if (State.mode === "hidden") return this.closedLook.x;
    const rect = this.islandRect();
    const botScreenX = rect.x + this.botCx.value;
    return Math.tanh((State.mouse.x - botScreenX) / 260);
  }

  private lookY(): number {
    if (State.mode === "hidden") return this.closedLook.y;
    return -Math.tanh((State.mouse.y - this.botCy.value) / 200);
  }

  private updateCountdown(nowMs: number) {
    // The state machine's own deadline, so the bar follows an auto-close delay
    // edited while the countdown runs.
    const dueAt = this.fsm.homeCollapseDueAt;
    if (State.mode !== "expanded" || State.isPinned || dueAt == null) {
      this.countdown.style.width = "0px";
      return;
    }
    const autoClose = this.fsm.homeToPetitDelay;
    const windowS = Math.min(10, autoClose * 0.6);
    const remaining = (dueAt - nowMs) / 1000;
    this.countdown.style.width =
      remaining < windowS ? `${Math.max(0, clamp(remaining / windowS, 0, 1) * 160)}px` : "0px";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    const expanded = State.mode === "expanded";
    // Music starting or let go (the gap after a song is over): the headphones go on or off.
    if (this.musicOn !== this.musicWas) {
      this.musicWas = this.musicOn;
      this.ensureRunning();
    }
    const greetingActive = expanded && State.view === "greeting";

    const viewing = this.viewing;
    const live = expanded && !greetingActive && !viewing;
    this.islandEl.classList.toggle("viewing", viewing);
    // The views' own animations (the ticker's shimmer) stop with the island folded.
    this.islandEl.classList.toggle("open", expanded);
    // The viewer closed: once its picture has faded, the large copy goes.
    if (this.wasViewing && !viewing) {
      window.setTimeout(() => {
        if (!this.viewing && this.hudKind !== "shot") this.shotImg.src = this.shotThumb;
      }, 400);
    }
    this.wasViewing = viewing;
    this.contentEl.style.opacity = live ? "1" : "0";
    // While the drop sequence owns the body its buttons are painted on the canvas
    // underneath, so only the header may keep taking clicks up here.
    this.contentEl.style.pointerEvents = live && !this.uploadActive ? "auto" : "none";
    this.header.el.style.pointerEvents = live ? "auto" : "none";
    this.greetingCanvas.style.display = greetingActive ? "block" : "none";

    // Leaving the greeting, however it ends, lets its sound fade out.
    if (this.greetingShown && !greetingActive) this.greeting.leave();
    this.greetingShown = greetingActive;

    this.header.sync();
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }

    // The chat and today's list open on their text field: the only times the island
    // takes the keyboard by itself. Only the open island shows a view, so a view opens
    // afresh each time the island does (the chat's field, today's list unrolling).
    const showing = State.mode === "expanded" ? State.view : null;
    if (this.lastSyncedView !== showing) {
      const typing = (v: string | null) => v === "prompt" || v === "today";
      const wasTyping = typing(this.lastSyncedView);
      this.lastSyncedView = showing;
      if (showing && typing(showing)) {
        void Bridge.focusWindow(true);
        if (showing === "prompt") window.setTimeout(() => this.views.get("prompt")?.focus?.(), 120);
        else this.views.get(showing)?.focus?.();
      } else if (wasTyping) {
        void Bridge.focusWindow(false);
      }
    }

    // Compact mini grid
    const showGrid = State.mode === "compact";
    this.miniGrid.style.opacity = showGrid ? "1" : "0";
    if (showGrid) {
      const others = State.otherTasks.slice(0, 4);
      const key = others.map((t) => t.id).join("|");
      if (this.miniGrid.dataset.key !== key) {
        this.miniGrid.dataset.key = key;
        this.miniGrid.replaceChildren();
        for (const t of others) {
          this.miniGrid.append(createMiniBot(t, 13));
        }
        pruneMiniBots();
      }
    }

    // Compact Claude plan indicator
    const showPlan = claudeCompactPillVisible();
    this.compactPlan.style.opacity = showPlan ? "1" : "0";
    this.compactPlan.style.pointerEvents = showPlan ? "auto" : "none";
    if (showPlan) {
      const others = State.otherTasks.slice(0, 4);
      this.compactPlan.style.right = others.length > 0 ? "58px" : "20px";
      const pct = dominantPct(State.planUsage);
      const color = planColor(pct);
      this.compactPlan.style.setProperty("--plan", color);
      this.compactPlanLabel.textContent = pct != null ? `${Math.round(pct)}%` : "—";
    }

    this.updateClock();

    syncMiniBotStates(State.tasks);
    this.engine.setState(State.effectiveState);
  }

  /** The clock sits in the middle of the compact island, where the notch is on a Mac. */
  private updateClock() {
    this.updateClosed();
    const on = State.mode === "compact" && State.settings.showClock;
    this.clockEl.style.opacity = on ? "1" : "0";
    if (!on) return;
    const now = new Date();
    const date = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const text = `${date}  ${time}`;
    if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
  }

  /** Applies settings coming from Rust at boot. */
  applySettings() {
    // The closed island may have changed: what it shows, or whether it shows.
    this.closedKey = "";
    this.updateClosed();
    if (State.mode === "hidden") {
      this.animateGeometry(true);
      if (this.collapsed) this.sendCollapsedSize();
    }
    this.scheduleClosedLife();
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.petitToHiddenDelay = State.settings.compactCloseInterval;
    this.fsm.openOnHover = State.settings.openOnHover;
    State.notify();
    // ponytail: one timer for the life of the window; a minute is the clock's finest tick.
    this.clockTimer ??= window.setInterval(() => this.updateClock(), 10_000);
  }

  get panelSize() {
    return { w: PANEL_W, h: PANEL_H };
  }

  get chatHeight() {
    return chatPromptHeight(State.chatHistory.length);
  }
}
