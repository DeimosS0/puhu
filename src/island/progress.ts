// The island's side of Puhu's progress: each Pomodoro phase that runs to its end
// goes into the progress log (src-tauri/src/progress.rs) as a fact, and the state
// is replayed from the whole log (src/core/progress.ts). What a fact changed (the
// day's flame, the goal, a level, a badge) goes to the island to celebrate; a badge
// earned is written to the log too (core/badges.ts). Only while focus play is on;
// off, or not asked yet, nothing is recorded and nothing shows.

import { newBadges } from "../core/badges";
import { Bridge, onEvent } from "../core/bridge";
import { Pomodoro, type PomodoroDone } from "../core/pomodoro";
import { emberDue, moments, nextChange, replay, type Moment, type ProgressState } from "../core/progress";
import { State } from "../core/state";

/** What the island does with progress. */
export interface ProgressHost {
  celebrate(moments: Moment[]): void;
  /** Puhu's reaction to a surprise (core/secrets.ts). */
  surprise(id: string): void;
}

export const progress = {
  state: replay([], Date.now()) as ProgressState,
  /** Someone changed the log by hand (progress.rs notices). */
  edited: false,
  /** The evening ember's time has come: the island says it once (emberDue). */
  ember: false,
  get on(): boolean {
    return State.settings.focusGame === true;
  },
};

/** The last day a shield kept the streak that the island has told about. A convenience of this install. */
const SHIELD_SEEN_KEY = "puhu.progress.shieldSeen";

/** The log as read at launch, plus what this session added: read whole only once. */
let events: unknown[] = [];
let host: ProgressHost | null = null;
let timer: number | null = null;

export async function loadProgress() {
  const log = await Bridge.progressRead();
  if (!log) return;
  events = log.events;
  progress.edited = log.edited;
  refresh();
  // A badge new to this version may already be earned by what was done before.
  const earned = await awardBadges();
  if (earned.length > 0) host?.celebrate(earned);
  // Someone was at the log: he noticed.
  if (progress.edited && progress.on) host?.surprise("caught");
}

/**
 * The state as of now, and the next moment it changes by itself (the day turning,
 * the reminder): one timer, nothing ticking in between. Also called when Puhu wakes
 * and when the settings change, since a sleeping computer holds timers back.
 */
export function refresh() {
  const now = Date.now();
  progress.state = replay(events, now);
  progress.ember = progress.on && emberDue(progress.state, now, State.settings.focusReminder);
  if (timer != null) window.clearTimeout(timer);
  // Only for the island that registered: nothing else waits for the day to turn.
  if (host) timer = window.setTimeout(refresh, nextChange(now, State.settings.focusReminder) - now + 1000);
  State.notify();
}

/** Into the log and into this session's list; false when the log refused it. */
async function append(event: object): Promise<boolean> {
  try {
    await Bridge.progressAdd(event);
  } catch (err) {
    console.error("[puhu] progress_add failed", err);
    return false;
  }
  events.push(event);
  return true;
}

async function record(event: object) {
  if (!(await append(event))) return;
  const before = progress.state;
  refresh();
  const changed = moments(before, progress.state, shieldSeen());
  if (changed.some((m) => m.kind === "shield")) markShieldSeen(Math.max(...progress.state.shielded));
  changed.push(...(await awardBadges()));
  if (changed.length > 0) host?.celebrate(changed);
}

/** The badges the history now reaches, written to the log as facts of their own. */
async function awardBadges(): Promise<Moment[]> {
  if (!progress.on) return [];
  const out: Moment[] = [];
  for (const { id, tier } of newBadges(progress.state)) {
    if (await append({ v: 1, kind: "badge", at: Date.now(), id, tier })) out.push({ kind: "badge", id, tier });
  }
  if (out.length > 0) refresh();
  return out;
}

/**
 * Claude Code finished a turn: written down only while today has Claude's quest open,
 * and only as many as it asks. Claude's work earns nothing else (docs/gamification.md).
 */
export function claudeFinished() {
  if (!progress.on) return;
  const quest = progress.state.today.quests.find((q) => q.id === "claude");
  if (quest && !quest.done) void record({ v: 1, kind: "claude", at: Date.now() });
}

/** Surprises being written down, so a quick second one does not write it twice. */
const secretsWriting = new Set<string>();

/** A surprise found (core/secrets.ts): its secret badge, once, while focus play is on. */
export async function awardSecret(id: string) {
  const badge = `secret.${id}`;
  if (!progress.on || secretsWriting.has(id) || progress.state.badges.some((b) => b.id === badge)) return;
  secretsWriting.add(id);
  if (await append({ v: 1, kind: "badge", at: Date.now(), id: badge, tier: 1 })) {
    refresh();
    host?.celebrate([{ kind: "badge", id: badge, tier: 1 }]);
  }
  secretsWriting.delete(id);
}

/** The daily goal from now on (the days before keep theirs). */
export function chooseGoal(rounds: number) {
  return record({ v: 1, kind: "goal", at: Date.now(), rounds });
}

function fact(done: PomodoroDone) {
  return done.phase === "focus"
    ? { v: 1, kind: "focus", at: done.end, start: done.start, minutes: done.minutes, ran: Math.round(done.ran) }
    : { v: 1, kind: "break", at: done.end, minutes: done.minutes };
}

function shieldSeen(): number {
  try {
    return Number(window.localStorage?.getItem(SHIELD_SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markShieldSeen(day: number) {
  try {
    window.localStorage?.setItem(SHIELD_SEEN_KEY, String(day));
  } catch {
    // Told again at most once more.
  }
}

export function registerProgress(island: ProgressHost) {
  host = island;
  // The Nest bought something: the log changed under this window.
  void onEvent("progress-changed", () => void loadProgress());
  Pomodoro.onComplete((done) => {
    if (!progress.on) return;
    void record(fact(done));
  });
  void loadProgress();
}
