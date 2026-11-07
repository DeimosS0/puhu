// Game mode (docs/game-mode.md): while a game fills the screen, Puhu steps aside.
//
// The foreground hook Puhu already has (platform::keep_on_top) hands every change of
// the window in front to one worker thread, which looks at it a few times over the
// next seconds (games go full screen a moment after they start) and decides with the
// user's list of apps (settings.json `gameApps`, like Discord's registered games). An
// app is added to the list the first time it fills the screen: on, unless it is one
// that fills it without being a game (a browser's video, a slideshow). Leaving the
// game counts only after a few seconds away, so a quick Alt+Tab changes nothing.
//
// While it is on, `platform::presenting` is true: everything that waits for a
// full-screen app waits for the game too. Nothing here runs while nothing changes.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// How long Puhu waves before the island's window goes (island.ts GAME_WAVE_S, and a little).
const WAVE: Duration = Duration::from_millis(2300);
/// How long the game may be away from the front before game mode ends.
const GRACE: Duration = Duration::from_secs(8);
/// When the window in front is looked at again after it came to the front.
const LOOKS: [Duration; 3] = [Duration::from_millis(300), Duration::from_secs(2), Duration::from_secs(6)];

/// Apps that fill the screen without being games: listed off the first time they do.
const NOT_GAMES: &[&str] = &[
    "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc", "zen", "vlc", "mpv", "mpc-hc64", "mpc-be64",
    "potplayermini64", "wmplayer", "microsoft.media.player", "video.ui", "powerpnt", "ms-teams", "teams", "zoom",
];

static ACTIVE: AtomicBool = AtomicBool::new(false);
/// Ask the screen called Puhu in from a game: game mode stays off until the island closes.
static HELD: AtomicBool = AtomicBool::new(false);
static WORKER: OnceLock<Sender<Msg>> = OnceLock::new();
/// The app game mode is on for, as the list names it.
static CURRENT: Mutex<String> = Mutex::new(String::new());

/// One app Puhu has seen filling the screen.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GameApp {
    /// Its window's title the first time, else its program's name.
    pub name: String,
    /// Off: this app never starts game mode.
    pub on: bool,
}

impl Default for GameApp {
    fn default() -> Self {
        Self { name: String::new(), on: true }
    }
}

/// The window in front, as game mode sees it.
#[derive(Clone, Debug, Default)]
pub struct Front {
    /// The program, lower case and without ".exe" ("cs2").
    pub id: String,
    pub name: String,
    /// It covers its whole monitor and Windows reports a full-screen app.
    pub full_screen: bool,
}

/// What the island and the desktop window are told.
#[derive(Clone, Serialize)]
pub struct GameMode {
    pub on: bool,
    pub name: String,
    /// Off without the welcome back: the user called Puhu in (Ask the screen).
    pub quiet: bool,
}

enum Msg {
    Front,
    /// The list or the switch changed: decide again now, and leave at once if it says so.
    Recheck,
}

pub fn active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

/// Whether `front` is a game, and the entry to add when its app is new to the list.
pub fn decide(front: &Front, enabled: bool, apps: &BTreeMap<String, GameApp>) -> (bool, Option<GameApp>) {
    if !enabled || front.id.is_empty() || crate::flow::is_shell(&front.id) || !front.full_screen {
        return (false, None);
    }
    match apps.get(&front.id) {
        Some(app) => (app.on, None),
        None => {
            let on = !NOT_GAMES.contains(&front.id.as_str());
            (on, Some(GameApp { name: front.name.clone(), on }))
        }
    }
}

/// Starts the worker; the foreground hook feeds it.
pub fn start(app: AppHandle) {
    let (tx, rx) = channel();
    if WORKER.set(tx).is_err() {
        return;
    }
    let spawned = std::thread::Builder::new().name("puhu-game".into()).spawn(move || {
        let mut looks: Vec<Instant> = Vec::new();
        let mut leave_at: Option<Instant> = None;
        loop {
            let next = looks.iter().copied().chain(leave_at).min();
            let msg = match next {
                Some(at) => rx.recv_timeout(at.saturating_duration_since(Instant::now())),
                None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            let mut now_or_never = false;
            match msg {
                Ok(Msg::Front) => {
                    let now = Instant::now();
                    looks = LOOKS.iter().map(|d| now + *d).collect();
                }
                Ok(Msg::Recheck) => {
                    looks = vec![Instant::now()];
                    now_or_never = true;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            let now = Instant::now();
            let due = looks.first().is_some_and(|at| *at <= now);
            looks.retain(|at| *at > now);
            let leaving = leave_at.is_some_and(|at| at <= now);
            if !due && !leaving {
                continue;
            }
            let game = look(&app);
            if game {
                leave_at = None;
            } else if active() {
                if now_or_never || leaving {
                    leave_at = None;
                    set(&app, false, String::new(), false);
                } else if leave_at.is_none() {
                    leave_at = Some(now + GRACE);
                }
            }
        }
    });
    if spawned.is_err() {
        crate::log::line("game mode: its thread could not start");
    }
    // A game may already be in front at launch.
    front_changed();
}

/// A new window came to the front (the foreground hook).
pub fn front_changed() {
    if let Some(tx) = WORKER.get() {
        let _ = tx.send(Msg::Front);
    }
}

fn recheck() {
    if let Some(tx) = WORKER.get() {
        let _ = tx.send(Msg::Recheck);
    }
}

/// Looks at the window in front; true when it is a game, game mode then on.
fn look(app: &AppHandle) -> bool {
    let Some(front) = crate::platform::front_window() else { return false };
    let Some(shared) = app.try_state::<crate::Shared>() else { return false };
    let (game, new, name) = {
        let settings = shared.settings.lock().unwrap();
        let (game, new) = decide(&front, settings.game_mode, &settings.game_apps);
        let name = settings.game_apps.get(&front.id).map(|a| a.name.clone()).unwrap_or_else(|| front.name.clone());
        (game, new, name)
    };
    if let Some(entry) = new {
        crate::log::line(format!("game mode: {} fills the screen ({})", front.id, if entry.on { "a game" } else { "not a game" }));
        update(app, |apps| {
            apps.insert(front.id.clone(), entry);
        });
    }
    if game && !HELD.load(Ordering::Relaxed) && (!active() || *CURRENT.lock().unwrap() != name) {
        set(app, true, name, false);
    }
    game
}

fn set(app: &AppHandle, on: bool, name: String, quiet: bool) {
    ACTIVE.store(on, Ordering::Relaxed);
    *CURRENT.lock().unwrap() = if on { name.clone() } else { String::new() };
    crate::log::line(format!("game mode {}", if on { format!("on: {name}") } else { "off".into() }));
    crate::desktop::set_game(app, on);
    crate::flow::pill::set_game(app);
    if on {
        // Once he has waved, the island's window goes: hidden, it draws and costs nothing.
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(WAVE);
            if let (true, Some(win)) = (active(), crate::island::window(&app)) {
                crate::platform::set_shown(&win, false);
            }
        });
    } else if let Some(win) = crate::island::window(app) {
        // Back before the page hears of it, so his welcome back has a window to show in.
        crate::platform::set_shown(&win, true);
    }
    let _ = app.emit("game-mode", GameMode { on, name, quiet });
}

/// Ask the screen in a game: game mode ends without a welcome back and stays off until
/// the island closes again (`game_resume`). True when it was on.
pub fn step_out(app: &AppHandle) -> bool {
    if !active() {
        return false;
    }
    HELD.store(true, Ordering::Relaxed);
    set(app, false, String::new(), true);
    true
}

/// The island closed after Ask the screen: game mode decides again, at once.
#[tauri::command]
pub fn game_resume() {
    if HELD.swap(false, Ordering::Relaxed) {
        recheck();
    }
}

/// Changes the list, saves it, and tells the pages.
fn update(app: &AppHandle, change: impl FnOnce(&mut BTreeMap<String, GameApp>)) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let snapshot = {
        let mut s = shared.settings.lock().unwrap();
        change(&mut s.game_apps);
        s.clone()
    };
    if let Err(err) = crate::settings::save(&snapshot) {
        crate::log::line(format!("could not save settings: {err}"));
    }
    let _ = app.emit("settings-changed", snapshot);
}

/// Whether game mode is on now, and for which app.
#[tauri::command]
pub fn game_status() -> GameMode {
    GameMode { on: active(), name: CURRENT.lock().unwrap().clone(), quiet: false }
}

/// Settings → Game mode: an app turned on or off (`on`), or taken off the list (None).
#[tauri::command]
pub fn game_app_set(app: AppHandle, id: String, on: Option<bool>) {
    update(&app, |apps| match on {
        Some(on) => {
            if let Some(entry) = apps.get_mut(&id) {
                entry.on = on;
            }
        }
        None => {
            apps.remove(&id);
        }
    });
    recheck();
}

/// Settings → Game mode: the switch for all of it (`gameMode`), already saved by the page.
#[tauri::command]
pub fn game_refresh() {
    recheck();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn front(id: &str, full_screen: bool) -> Front {
        Front { id: id.into(), name: format!("{id} window"), full_screen }
    }

    #[test]
    fn a_new_app_filling_the_screen_is_a_game_and_joins_the_list() {
        let (game, new) = decide(&front("cs2", true), true, &BTreeMap::new());
        assert!(game);
        assert_eq!(new, Some(GameApp { name: "cs2 window".into(), on: true }));
    }

    #[test]
    fn a_browser_or_a_slideshow_joins_the_list_off() {
        for id in ["chrome", "msedge", "powerpnt", "vlc"] {
            let (game, new) = decide(&front(id, true), true, &BTreeMap::new());
            assert!(!game, "{id}");
            assert_eq!(new.map(|a| a.on), Some(false), "{id}");
        }
    }

    #[test]
    fn the_list_decides_for_the_apps_it_knows() {
        let mut apps = BTreeMap::new();
        apps.insert("chrome".to_string(), GameApp { name: "YouTube".into(), on: true });
        apps.insert("cs2".to_string(), GameApp { name: "Counter-Strike 2".into(), on: false });
        assert_eq!(decide(&front("chrome", true), true, &apps), (true, None));
        assert_eq!(decide(&front("cs2", true), true, &apps), (false, None));
    }

    #[test]
    fn nothing_starts_it_unless_the_screen_is_filled_and_the_switch_is_on() {
        let mut apps = BTreeMap::new();
        apps.insert("cs2".to_string(), GameApp { name: "Counter-Strike 2".into(), on: true });
        assert_eq!(decide(&front("cs2", false), true, &apps), (false, None));
        assert_eq!(decide(&front("cs2", true), false, &apps), (false, None));
        assert_eq!(decide(&front("newgame", true), false, &apps), (false, None));
    }

    #[test]
    fn the_desktop_and_puhu_himself_are_never_games() {
        for id in ["explorer", "lockapp", "puhu", ""] {
            assert_eq!(decide(&front(id, true), true, &BTreeMap::new()), (false, None), "{id}");
        }
    }
}
