// What the user is busy with, from the program in front, for the prop Puhu takes up
// (a mug while coding, a beret while drawing, a pencil while writing). Only the
// program's name is looked at, never a window's title or what is in it, and nothing
// leaves the computer. It is told once that program has stayed in front a while, so
// switching around changes nothing; the foreground hook (platform::keep_on_top) wakes
// the worker, which otherwise sleeps.
//
// Working time for the weekly sky (docs/weekly-card.md), only once the user said yes
// (settings `countWork`): while a coding, design or writing program is in front, once a
// minute the worker asks Windows how long since the last key or mouse input; under two
// minutes, that minute counts for that kind, in its half hour. Locked, asleep, in game
// mode or away, nothing counts; no program in front of those kinds, the worker sleeps.
// Kept: minutes per half hour and kind, in activity.json, for 14 days. Never a program's
// name, a title, a key or a file.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// The island and the desktop window hear of each change.
pub const EVENT: &str = "puhu-activity";
/// How long a program stays in front before Puhu takes up its prop.
const SETTLE: Duration = Duration::from_secs(30);
/// Working time: a minute at a time, counted when the last input is this recent.
const MINUTE: Duration = Duration::from_secs(60);
const AWAY_AFTER: Duration = Duration::from_secs(120);
/// A half hour, and how long one is kept.
const SLOT_SECS: i64 = 30 * 60;
const KEEP_SECS: i64 = 14 * 86_400;

/// The user said yes to counting working time.
static COUNTING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    Code,
    Design,
    Writing,
}

const CODE: &[&str] = &[
    "code", "code - insiders", "cursor", "windsurf", "zed", "devenv", "idea64", "pycharm64", "webstorm64",
    "clion64", "rider64", "goland64", "rustrover64", "phpstorm64", "datagrip64", "studio64", "sublime_text",
    "notepad++", "windowsterminal", "cmd", "powershell", "pwsh", "alacritty", "wezterm-gui", "mintty", "neovide",
    "rstudio", "spyder",
];
const DESIGN: &[&str] = &[
    "figma", "photoshop", "illustrator", "afterfx", "indesign", "blender", "krita", "gimp", "gimp-2.10", "inkscape",
    "clipstudiopaint", "aseprite", "designer", "photo", "paintdotnet", "lightroom", "resolve", "adobe premiere pro",
];
const WRITING: &[&str] =
    &["winword", "notion", "obsidian", "typora", "soffice.bin", "scrivener", "onenote", "logseq", "joplin", "wps"];

/// The activity a program (lower case, no ".exe") stands for, if any.
pub fn kind_of(program: &str) -> Option<Activity> {
    if CODE.contains(&program) {
        Some(Activity::Code)
    } else if DESIGN.contains(&program) {
        Some(Activity::Design)
    } else if WRITING.contains(&program) {
        Some(Activity::Writing)
    } else {
        None
    }
}

static WORKER: OnceLock<Sender<()>> = OnceLock::new();

/// Starts the worker; the foreground hook feeds it.
pub fn start(app: AppHandle) {
    let (tx, rx) = channel::<()>();
    if WORKER.set(tx).is_err() {
        return;
    }
    let spawned = std::thread::Builder::new().name("puhu-activity".into()).spawn(move || {
        let mut told: Option<Activity> = None;
        let mut due: Option<Instant> = None;
        // The next minute of working time, while one is being counted.
        let mut tick: Option<Instant> = None;
        loop {
            let next = [due, tick].into_iter().flatten().min();
            let msg = match next {
                Some(at) => rx.recv_timeout(at.saturating_duration_since(Instant::now())),
                None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match msg {
                // Another program came to the front: it is looked at once it has stayed there.
                Ok(()) => {
                    due = Some(Instant::now() + SETTLE);
                    continue;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            let now = Instant::now();
            if tick.is_some_and(|at| at <= now) {
                tick = None;
                if let Some(kind) = told {
                    if COUNTING.load(Ordering::Relaxed) && at_work() {
                        add_minute(kind, unix_now());
                    }
                }
            }
            if due.is_some_and(|at| at <= now) {
                due = None;
                let front = crate::flow::os::foreground_app().and_then(|(id, _)| kind_of(&id));
                if front != told {
                    told = front;
                    let _ = app.emit(EVENT, front);
                }
            }
            if told.is_none() || !COUNTING.load(Ordering::Relaxed) {
                tick = None;
            } else if tick.is_none() {
                tick = Some(now + MINUTE);
            }
        }
    });
    if spawned.is_err() {
        crate::log::line("activity: its thread could not start");
    }
    front_changed();
}

/// A new window came to the front (the foreground hook).
pub fn front_changed() {
    if let Some(tx) = WORKER.get() {
        let _ = tx.send(());
    }
}

/// Settings → Count my working time: on or off (at launch, and when it changes).
pub fn set_counting(on: bool) {
    if COUNTING.swap(on, Ordering::Relaxed) != on {
        front_changed();
    }
}

/// Someone is at the keyboard: an input in the last two minutes, and no game in front.
fn at_work() -> bool {
    crate::platform::idle().is_some_and(|idle| idle < AWAY_AFTER) && !crate::game::active()
}

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Minutes per half hour (its start, Unix seconds): [coding, design, writing].
#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
struct WorkTime {
    slots: BTreeMap<i64, [u16; 3]>,
}

/// One write at a time: the worker adds, Settings clears.
static FILE: Mutex<()> = Mutex::new(());

fn work_path() -> std::path::PathBuf {
    crate::settings::local_dir().join("activity.json")
}

fn read_work() -> WorkTime {
    std::fs::read_to_string(work_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// A minute of `kind` at `now`, into its half hour; what is past 14 days goes.
fn add_minute(kind: Activity, now: i64) {
    let _turn = FILE.lock().unwrap_or_else(PoisonError::into_inner);
    let mut work = read_work();
    add_to(&mut work, kind, now);
    if crate::platform::ensure_private_dir(&crate::settings::local_dir()).is_ok() {
        if let Ok(text) = serde_json::to_string(&work) {
            let _ = std::fs::write(work_path(), text);
        }
    }
}

fn add_to(work: &mut WorkTime, kind: Activity, now: i64) {
    let slot = now - now.rem_euclid(SLOT_SECS);
    let index = match kind {
        Activity::Code => 0,
        Activity::Design => 1,
        Activity::Writing => 2,
    };
    let minutes = work.slots.entry(slot).or_default();
    minutes[index] = (minutes[index] + 1).min(30);
    work.slots.retain(|start, _| *start >= now - KEEP_SECS);
}

/// The half hours from `since` (Unix seconds), for the weekly sky.
#[tauri::command]
pub fn work_slots(since: i64) -> Vec<(i64, [u16; 3])> {
    let _turn = FILE.lock().unwrap_or_else(PoisonError::into_inner);
    read_work().slots.into_iter().filter(|(start, _)| *start >= since).collect()
}

/// Settings → What Puhu keeps → Clear.
#[tauri::command]
pub fn work_clear() {
    let _turn = FILE.lock().unwrap_or_else(PoisonError::into_inner);
    let _ = std::fs::remove_file(work_path());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn programs_are_known_by_what_they_are_for() {
        assert_eq!(kind_of("code"), Some(Activity::Code));
        assert_eq!(kind_of("windowsterminal"), Some(Activity::Code));
        assert_eq!(kind_of("figma"), Some(Activity::Design));
        assert_eq!(kind_of("winword"), Some(Activity::Writing));
        assert_eq!(kind_of("chrome"), None);
        assert_eq!(serde_json::to_string(&Some(Activity::Design)).unwrap(), "\"design\"");
    }

    #[test]
    fn working_minutes_go_into_their_half_hour_and_go_after_two_weeks() {
        let mut work = WorkTime::default();
        let t = 1_800_000_000; // a multiple of 30 minutes
        add_to(&mut work, Activity::Code, t + 10);
        add_to(&mut work, Activity::Code, t + 70);
        add_to(&mut work, Activity::Writing, t + 1799);
        add_to(&mut work, Activity::Design, t + 1800);
        assert_eq!(work.slots[&t], [2, 0, 1]);
        assert_eq!(work.slots[&(t + 1800)], [0, 1, 0]);
        // A half hour never holds more than thirty minutes.
        for _ in 0..40 {
            add_to(&mut work, Activity::Code, t + 5);
        }
        assert_eq!(work.slots[&t][0], 30);
        // Two weeks later the old half hours are gone.
        add_to(&mut work, Activity::Code, t + KEEP_SECS + 2 * SLOT_SECS);
        assert!(!work.slots.contains_key(&t));
        assert_eq!(work.slots.len(), 1);
    }
}
