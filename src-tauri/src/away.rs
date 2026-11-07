// Guard mode: an agent works while the user is away (no keyboard or mouse for the
// absence interval, settings.json `absenceInterval`), so Puhu keeps watch. The island
// counts what happens and tells it when the user is back.
//
// Asked only when a hook arrives; while the user is away, one look a second at the
// last input until it moves. Nothing runs while nobody works.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;

/// Input this recent means the user is back.
const BACK: Duration = Duration::from_secs(2);

static AWAY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
struct Away {
    on: bool,
}

/// A hook arrived: when nobody has touched the computer for a while, the watch starts.
pub fn hook_arrived(app: &AppHandle) {
    if AWAY.load(Ordering::Relaxed) || crate::game::active() {
        return;
    }
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let after = shared.settings.lock().unwrap().absence_interval;
    let Some(idle) = crate::platform::idle() else { return };
    if idle.as_secs_f64() < after || AWAY.swap(true, Ordering::Relaxed) {
        return;
    }
    crate::log::line(format!("away for {} s: Puhu keeps watch", idle.as_secs()));
    let _ = app.emit_to(WINDOW_LABEL, "away", Away { on: true });
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("puhu-away".into()).spawn(move || {
        while crate::platform::idle().is_some_and(|idle| idle >= BACK) {
            std::thread::sleep(Duration::from_secs(1));
        }
        AWAY.store(false, Ordering::Relaxed);
        crate::log::line("back: the watch ends");
        let _ = app.emit_to(WINDOW_LABEL, "away", Away { on: false });
    });
    if spawned.is_err() {
        AWAY.store(false, Ordering::Relaxed);
    }
}
