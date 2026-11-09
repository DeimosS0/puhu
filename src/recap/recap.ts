// Weekly recap — when the card opens, and what it shows. Port of
// AppDelegate.checkMondayRecap / openWeeklyRecap.
//
// It opens on its own once a week, on Monday from 8 am, at the first of:
//   * the launch greeting ending (the app starting that day),
//   * an agent starting work (SessionStart / UserPromptSubmit — Rust sends
//     `recap-check` when it sees one),
//   * the island waking from hidden (the user coming back to the machine).
// And any time from the tray: "Weekly recap". Nothing here runs on a timer.

import { Bridge, IS_TAURI } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { State } from "../core/state";
import {
  DEFAULT_PREFS, addDays, dayKey, mondayOf, previousWeekStart, sampleHistory, shouldAutoShow, summarize,
  type RecapPrefs, type WeeklySummary,
} from "./summary";
import { SKIES_KEY, keepSky, readSkies, trend, weekSky, type WeekSky } from "./sky";
import { focusRounds } from "../island/progress";
import { Today } from "../views/today";

/** What the recap needs from the island. */
export interface RecapHost {
  alert(view: IslandViewName): void;
}

/** Views the Monday card may replace; anything else is the user busy with something. */
const QUIET_VIEWS: ReadonlySet<IslandViewName> = new Set(["overview", "empty", "settings", "greeting"]);

/** 1.5 s, so it never lands on top of the event that triggered it. */
const SHOW_DELAY_MS = 1500;

class RecapController {
  summary: WeeklySummary | null = null;
  /** Last week's sky (recap/sky.ts), and how it compares with the weeks before. */
  sky: WeekSky | null = null;
  compare: ReturnType<typeof trend> = null;
  prefs: RecapPrefs = { ...DEFAULT_PREFS };
  /** Bumped on every load, so the view knows to rebuild (and leave share mode). */
  version = 0;
  private checking = false;

  /**
   * Reads last week, and the week before to compare with: the agents' history from
   * Rust, focus rounds, things done, working time if counted. A plain browser
   * (`npm run dev`) gets the sample week. True when there is anything to show.
   */
  async load(now = new Date()): Promise<boolean> {
    const start = previousWeekStart(now);
    const before = addDays(start, -7);
    const [history, work] = IS_TAURI
      ? await Promise.all([Bridge.recapHistory(before.getTime() / 1000), Bridge.workSlots(before.getTime() / 1000)])
      : [sampleHistory(start), []];
    this.prefs = { ...DEFAULT_PREFS, ...(history?.prefs ?? {}) };
    this.summary = history ? summarize(history, start) : null;
    const input = {
      turns: history?.turns ?? [],
      focus: focusRounds(),
      done: Today.all().map((x) => x.doneAt).filter((at): at is number => typeof at === "number"),
      work: work ?? [],
    };
    const sky = weekSky({ weekStart: start, ...input });
    const last = weekSky({ weekStart: before, ...input });
    // The week is kept (a year of them, no hour in them), and the earlier ones read.
    let kept = readSkies(read(SKIES_KEY));
    const earlier = kept.filter((s) => s.week < dayKey(start));
    const stars = (x: WeekSky) => x.timeStars + x.doneStars;
    this.compare = trend(stars(sky), stars(last), earlier);
    if (stars(sky) > 0) {
      kept = keepSky(kept, { week: dayKey(start), title: sky.title, stars: stars(sky), minutes: sky.minutes, done: sky.doneStars });
      write(SKIES_KEY, JSON.stringify(kept));
    }
    this.sky = sky;
    this.version++;
    return this.summary != null || stars(sky) > 0;
  }

  /** Tray → Weekly recap. Shows the card even for an empty week. */
  async open(host: RecapHost) {
    await this.load();
    host.alert("recap");
  }

  /** Monday ≥ 8 am, not shown yet this week, something to show, nobody interrupted. */
  async check(host: RecapHost, now = new Date()) {
    // The clock first: six days out of seven this is all that runs.
    if (this.checking || !shouldAutoShow(now, "") || !this.quiet()) return;
    this.checking = true;
    try {
      const prefs = IS_TAURI ? await Bridge.recapPrefs() : null;
      if (!prefs?.enabled || !shouldAutoShow(now, prefs.lastShownWeek)) return;
      if (!(await this.load(now))) return;
      const week = dayKey(mondayOf(now));
      window.setTimeout(() => {
        if (!this.quiet()) return;
        host.alert("recap");
        void Bridge.recapMarkShown(week);
        this.prefs.lastShownWeek = week;
      }, SHOW_DELAY_MS);
    } finally {
      this.checking = false;
    }
  }

  private quiet(): boolean {
    if (State.paused || State.pendingApproval) return false;
    return State.mode !== "expanded" || QUIET_VIEWS.has(State.view);
  }

  async setHideProjects(hide: boolean) {
    this.prefs.hideProjects = hide;
    await Bridge.recapSetHideProjects(hide);
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept for this run only.
  }
}

export const Recap = new RecapController();
