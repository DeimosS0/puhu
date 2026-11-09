// Puhu's progress log: what happened, as facts (a focus round finished, a break
// finished, the daily goal changed, a badge earned), one per line in progress.log
// under platform::config_dir() (%APPDATA%\Puhu on Windows). The island replays it
// into points, the level and the streak (src/core/progress.ts), so a rule can
// change without touching what was recorded. Nothing in it leaves the machine.
//
// Lines are only ever appended. Each is "<signature> <event JSON>", the signature
// an HMAC-SHA256 over the previous line's signature and this event, with a key
// kept in the OS keystore. Changing, removing or reordering a line breaks the
// chain there and the island is told the log was edited: on one's own computer
// that can't be prevented, only noticed. A missing key (another computer, a
// cleared keystore) starts a new chain with a "rekey" line instead of calling an
// honest log edited.

use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use ring::hmac;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use serde_json::{json, Value};

use crate::platform;

pub const KEY: &str = "progress-key";
/// An event is a few dozen bytes; anything near this is not one of ours.
const MAX_EVENT_BYTES: usize = 1024;
/// About 0.4 MB a year at four rounds a day, 1 MB at ten: a century fits.
const MAX_FILE_BYTES: u64 = 128 << 20;
/// A line written while the keystore was out of reach.
const UNSIGNED: &str = "-";

/// One append at a time, so two never read the same last signature.
static APPEND: Mutex<()> = Mutex::new(());

#[derive(Serialize, Debug)]
pub struct ProgressLog {
    events: Vec<Value>,
    /// A line was changed, removed or reordered by hand.
    edited: bool,
}

fn path() -> PathBuf {
    platform::config_dir().join("progress.log")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn key_from(stored: &str) -> hmac::Key {
    hmac::Key::new(hmac::HMAC_SHA256, stored.as_bytes())
}

fn stored_key() -> Option<hmac::Key> {
    crate::secrets::get_internal(KEY).map(|k| key_from(&k))
}

fn new_key() -> Option<hmac::Key> {
    let mut bytes = [0u8; 32];
    SystemRandom::new().fill(&mut bytes).ok()?;
    let stored = hex(&bytes);
    crate::secrets::set_internal(KEY, &stored).ok()?;
    Some(key_from(&stored))
}

fn sign(key: &hmac::Key, previous: &str, event: &str) -> String {
    let mut ctx = hmac::Context::with_key(key);
    ctx.update(previous.as_bytes());
    ctx.update(b" ");
    ctx.update(event.as_bytes());
    hex(ctx.sign().as_ref())
}

/// Only small objects with a kind and a time go in.
fn checked(event: &Value) -> Result<String, String> {
    let kind = event.get("kind").and_then(Value::as_str).unwrap_or_default();
    if kind.is_empty() || kind.len() > 32 || !event.get("at").is_some_and(Value::is_number) {
        return Err("not a progress event".into());
    }
    let line = serde_json::to_string(event).map_err(|e| e.to_string())?;
    if line.len() > MAX_EVENT_BYTES {
        return Err("progress event too large".into());
    }
    Ok(line)
}

/// The events in order, and whether the chain holds. Without a key nothing can be
/// checked, so nothing is called edited.
fn read_from(text: &str, key: Option<&hmac::Key>) -> ProgressLog {
    let mut events = Vec::new();
    let mut edited = false;
    let mut previous = "";
    for line in text.lines() {
        let Some((signature, body)) = line.split_once(' ') else {
            edited = true;
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(body) else {
            edited = true;
            continue;
        };
        if let Some(key) = key {
            let rekey = event.get("kind").and_then(Value::as_str) == Some("rekey");
            if rekey && signature == sign(key, "", body) {
                // A new chain begins: what came before was signed with a lost key.
                edited = false;
            } else if signature != sign(key, previous, body) {
                edited = true;
            }
        }
        previous = signature;
        events.push(event);
    }
    ProgressLog { events, edited }
}

/// The lines one event adds after `text`: a "rekey" line first when the key is new
/// and earlier lines exist.
fn lines_for(text: &str, line: &str, key: Option<&hmac::Key>, new_key: bool) -> String {
    let Some(key) = key else {
        return format!("{UNSIGNED} {line}\n");
    };
    let mut out = String::new();
    let mut previous = text.lines().last().and_then(|l| l.split_once(' ')).map_or("", |(s, _)| s).to_string();
    if new_key && !text.trim().is_empty() {
        let at = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        let rekey = json!({ "v": 1, "kind": "rekey", "at": at }).to_string();
        previous = sign(key, "", &rekey);
        out.push_str(&format!("{previous} {rekey}\n"));
    }
    out.push_str(&format!("{} {line}\n", sign(key, &previous, line)));
    out
}

fn read_text(path: &Path) -> std::io::Result<String> {
    if std::fs::metadata(path).is_ok_and(|m| m.len() > MAX_FILE_BYTES) {
        return Err(std::io::Error::new(ErrorKind::InvalidData, "progress.log is far too large"));
    }
    match std::fs::read_to_string(path) {
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(String::new()),
        other => other,
    }
}

fn append(path: &Path, event: &Value) -> Result<(), String> {
    let line = checked(event)?;
    let _one = APPEND.lock().unwrap_or_else(PoisonError::into_inner);
    let text = read_text(path).map_err(|e| e.to_string())?;
    let (key, new) = match stored_key() {
        Some(key) => (Some(key), false),
        None => (new_key(), true),
    };
    let lines = lines_for(&text, &line, key.as_ref(), new);
    if let Some(dir) = path.parent() {
        platform::ensure_private_dir(dir).map_err(|e| e.to_string())?;
    }
    std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)
        .and_then(|mut file| {
            file.write_all(lines.as_bytes())?;
            file.sync_data()
        })
        .map_err(|e| e.to_string())
}

/// A fact for the log (the island builds it; see src/core/progress.ts). Off the main
/// thread, like the read: the keystore and the disk can take a moment.
#[tauri::command(async)]
pub fn progress_add(event: Value) -> Result<(), String> {
    append(&path(), &event)
}

/// Settings → What Puhu keeps → Clear: the whole log goes, and focus play starts over.
#[tauri::command]
pub fn progress_clear() -> Result<(), String> {
    let _turn = APPEND.lock().unwrap_or_else(PoisonError::into_inner);
    match std::fs::remove_file(path()) {
        Err(err) if err.kind() != ErrorKind::NotFound => Err(err.to_string()),
        _ => Ok(()),
    }
}

/// The whole log, for the island to replay at launch (ten years of ten rounds a day:
/// 73,000 lines, read and checked in about 0.2 s).
#[tauri::command(async)]
pub fn progress_read() -> ProgressLog {
    match read_text(&path()) {
        Ok(text) => read_from(&text, stored_key().as_ref()),
        Err(err) => {
            crate::log::line(format!("can't read progress.log: {err}"));
            ProgressLog { events: Vec::new(), edited: false }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> hmac::Key {
        key_from("test-key")
    }

    fn event(minutes: u32) -> String {
        json!({ "v": 1, "kind": "focus", "at": 1_000 + minutes, "minutes": minutes }).to_string()
    }

    /// A log of three focus rounds, written the way `append` writes it.
    fn written(key: Option<&hmac::Key>) -> String {
        let mut text = String::new();
        for minutes in [25, 50, 15] {
            text += &lines_for(&text, &event(minutes), key, false);
        }
        text
    }

    fn minutes(log: &ProgressLog) -> Vec<u64> {
        log.events.iter().map(|e| e["minutes"].as_u64().unwrap()).collect()
    }

    #[test]
    fn a_log_written_here_reads_back_whole_and_unedited() {
        let log = read_from(&written(Some(&key())), Some(&key()));
        assert_eq!(minutes(&log), [25, 50, 15]);
        assert!(!log.edited);
    }

    #[test]
    fn a_changed_removed_or_reordered_line_is_noticed() {
        let text = written(Some(&key()));
        let lines: Vec<&str> = text.lines().collect();

        let changed = text.replace("\"minutes\":50", "\"minutes\":500");
        let removed = [lines[0], lines[2]].join("\n");
        let reordered = [lines[1], lines[0], lines[2]].join("\n");
        let foreign = written(Some(&key_from("another-key")));
        for edited in [changed, removed, reordered, foreign] {
            assert!(read_from(&edited, Some(&key())).edited, "{edited}");
        }
        // Still read, edited or not: nothing is thrown away.
        assert_eq!(read_from(&text.replace("\"minutes\":50", "\"minutes\":500"), Some(&key())).events.len(), 3);
    }

    #[test]
    fn without_a_key_nothing_is_signed_and_nothing_is_called_edited() {
        let text = written(None);
        assert!(text.lines().all(|l| l.starts_with("- ")));
        assert!(!read_from(&text, None).edited);
        // Once a key exists, an unsigned line is not one of its chain.
        assert!(read_from(&text, Some(&key())).edited);
    }

    #[test]
    fn a_new_key_starts_a_new_chain_after_the_old_lines() {
        let old = written(Some(&key_from("lost-key")));
        let text = old.clone() + &lines_for(&old, &event(30), Some(&key()), true);
        let log = read_from(&text, Some(&key()));
        assert!(!log.edited);
        assert_eq!(log.events.last().unwrap()["minutes"], 30);
        assert_eq!(log.events[3]["kind"], "rekey");
        // A rekey line can't be forged without the key.
        let forged = text.replace(text.lines().nth(3).unwrap().split_once(' ').unwrap().0, &"0".repeat(64));
        assert!(read_from(&forged, Some(&key())).edited);
    }

    #[test]
    fn only_small_events_with_a_kind_and_a_time_go_in() {
        assert!(checked(&json!({ "kind": "focus", "at": 1 })).is_ok());
        for bad in [json!({ "at": 1 }), json!({ "kind": "focus" }), json!({ "kind": "", "at": 1 }), json!("focus"), json!({ "kind": "x".repeat(33), "at": 1 })] {
            assert!(checked(&bad).is_err(), "{bad}");
        }
        assert!(checked(&json!({ "kind": "focus", "at": 1, "pad": "x".repeat(MAX_EVENT_BYTES) })).is_err());
    }
}
