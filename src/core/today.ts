// Today: the day's things to do, as Puhu keeps them. Written as it comes ("yarın 14:00
// diş hekimi", "cuma rapor"), each lands on a day and maybe a time; what is not done
// by the end of its day comes along to the next one, counting the days it has waited.
// Pure: no DOM, no Tauri. The island keeps the list in localStorage (TODAY_KEY) and
// draws it in views/today.ts.

export interface TodayTask {
  id: string;
  text: string;
  /** The day it is for, YYYY-MM-DD in local time. */
  day: string;
  /** A time that day, HH:MM, or none. */
  time?: string;
  /** When it was written, and when it was done (ms). */
  created: number;
  doneAt?: number;
}

/** Stored key: never rename it. */
export const TODAY_KEY = "puhu.today";
/** Done things are kept this long (for the day's count and, later, the history). */
const KEEP_DONE_DAYS = 14;

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

/** Whole days from `from` to `to` (YYYY-MM-DD), by the calendar. */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((k) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

// Day words in Turkish and English, with the Turkish endings a day takes ("yarına",
// "cumadan") and no others: "pazarlama" is not a Sunday. Longer names first, so
// "cumartesi" is not read as "cuma".
const WEEKDAYS: [RegExp, number][] = [
  [/pazartesi|monday/, 1],
  [/salı|tuesday/, 2],
  [/çarşamba|wednesday/, 3],
  [/perşembe|thursday/, 4],
  [/cumartesi|saturday/, 6],
  [/cuma|friday/, 5],
  [/pazar|sunday/, 0],
];
const WORD = (core: string) => new RegExp(`(?<!\\p{L})(?:${core})(?:'?(?:y?[ae]|[dt][ae]n?|ki))?(?!\\p{L})`, "iu");

/**
 * What was written, read: the day ("bugün", "yarın", a weekday: the next one, today
 * included) and the time ("14:00", "9.30"), taken out of the text. Nothing said, today.
 */
export function parseTask(input: string, now: Date): { text: string; day: string; time?: string } {
  let text = ` ${input.trim()} `;
  let day = dayKey(now);
  let time: string | undefined;

  const take = (re: RegExp): boolean => {
    const m = re.exec(text);
    if (!m) return false;
    text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
    return true;
  };

  const clock = /(?<![\d:.])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d:.])(?:'?[\p{L}]*)?/u.exec(text);
  if (clock) {
    time = `${clock[1].padStart(2, "0")}:${clock[2]}`;
    text = text.slice(0, clock.index) + " " + text.slice(clock.index + clock[0].length);
  }

  if (take(WORD("yarın|tomorrow"))) {
    day = dayKey(addDays(now, 1));
  } else if (take(WORD("bugün|today"))) {
    day = dayKey(now);
  } else {
    for (const [name, wd] of WEEKDAYS) {
      if (take(WORD(name.source))) {
        day = dayKey(addDays(now, (wd - now.getDay() + 7) % 7));
        break;
      }
    }
  }

  const clean = text.replace(/\s+/g, " ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  return { text: clean || input.trim(), day, time };
}

/**
 * Today's list, in the order to do it: what waited from earlier days first (oldest
 * first), then today's in the order written, then today's with a time, by the time.
 * Done ones are left out.
 */
export function todayList(tasks: readonly TodayTask[], now: Date): TodayTask[] {
  const today = dayKey(now);
  const rank = (t: TodayTask) => (t.day < today ? 0 : t.time ? 2 : 1);
  return tasks
    .filter((t) => !t.doneAt && t.day <= today)
    .sort((a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? a.day.localeCompare(b.day) : 0) ||
      (rank(a) === 2 ? (a.time ?? "").localeCompare(b.time ?? "") : 0) ||
      a.created - b.created);
}

/** Days a task has waited past its own (0 for today's). */
export function waited(task: TodayTask, now: Date): number {
  return Math.max(0, daysBetween(task.day, dayKey(now)));
}

/** Done today, and still to do today: the day's count. */
export function dayCount(tasks: readonly TodayTask[], now: Date): { done: number; total: number } {
  const today = dayKey(now);
  const done = tasks.filter((t) => t.doneAt && dayKey(new Date(t.doneAt)) === today).length;
  return { done, total: done + todayList(tasks, now).length };
}

/** The stored list, read leniently: anything malformed is left out. */
export function readTasks(raw: string | null): TodayTask[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((t): t is TodayTask =>
      t && typeof t.id === "string" && typeof t.text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.day) &&
      typeof t.created === "number");
  } catch {
    return [];
  }
}

/** The list to store: done things older than KEEP_DONE_DAYS go. */
export function prune(tasks: readonly TodayTask[], now: Date): TodayTask[] {
  const today = dayKey(now);
  return tasks.filter((t) => !t.doneAt || daysBetween(dayKey(new Date(t.doneAt)), today) <= KEEP_DONE_DAYS);
}

/** One thing on a day of the week's view: done there, or still to do (and how long it waited). */
export interface DayItem {
  task: TodayTask;
  done: boolean;
  waited: number;
}

/**
 * A day as the week shows it. Before today: what was done that day (what was not came
 * along to today). Today: today's list, then what is done today. After: what is for it.
 */
export function dayItems(tasks: readonly TodayTask[], day: string, now: Date): DayItem[] {
  const today = dayKey(now);
  const doneOn = (t: TodayTask) => t.doneAt != null && dayKey(new Date(t.doneAt)) === day;
  const done = tasks.filter(doneOn).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0)).map((task) => ({ task, done: true, waited: 0 }));
  if (day < today) return done;
  const open = day === today
    ? todayList(tasks, now)
    : tasks.filter((t) => !t.doneAt && t.day === day).sort((a, b) => (a.time ?? "~").localeCompare(b.time ?? "~") || a.created - b.created);
  return [...open.map((task) => ({ task, done: false, waited: waited(task, now) })), ...done];
}

/** The Monday of the week `offset` weeks from the one `now` is in. */
export function weekStart(now: Date, offset = 0): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}
