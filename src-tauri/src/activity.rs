// What the user is busy with, from the program in front, for the prop Puhu takes up
// (a mug while coding, a beret while drawing, a pencil while writing). Only the
// program's name is looked at, never a window's title or what is in it, and nothing
// leaves the computer. It is told once that program has stayed in front a while, so
// switching around changes nothing; the foreground hook (platform::keep_on_top) wakes
// the worker, which otherwise sleeps.

use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// The island and the desktop window hear of each change.
pub const EVENT: &str = "puhu-activity";
/// How long a program stays in front before Puhu takes up its prop.
const SETTLE: Duration = Duration::from_secs(30);

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
        loop {
            let msg = match due {
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
            due = None;
            let now = crate::flow::os::foreground_app().and_then(|(id, _)| kind_of(&id));
            if now != told {
                told = now;
                let _ = app.emit(EVENT, now);
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
}
