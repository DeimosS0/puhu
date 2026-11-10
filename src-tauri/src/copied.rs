// Text copied anywhere, for the island's peek: the clipboard listener (screenshot.rs)
// hands over each change that is text and not a picture, and the island gets the
// first part of it to show for a moment. Nothing is kept. What a password manager
// marks as private (ExcludeClipboardContentFromMonitorProcessing, Clipboard Viewer
// Ignore, CanIncludeInClipboardHistory 0) is never read at all.
//
// A copied error offers "Ask Puhu": only that click reads the clipboard whole
// (`ask_copied`) and puts it in the inbox, for the chat to read like a dropped file.

#[cfg(windows)]
pub use imp::changed;

/// The island only ever shows a line or two of it.
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_CHARS: usize = 400;
/// An error asked about: a long stack trace, not a log file.
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_ASK_CHARS: usize = 20_000;

/// Text the island puts on the clipboard (Copy text's words, a sum's result), from here:
/// the island's page may not have the focus a webview needs to write it.
#[tauri::command]
pub fn copy_text(text: String) -> bool {
    arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(text)).is_ok()
}

/// "Ask Puhu" on a copied error: the clipboard's text into the inbox.
#[tauri::command]
pub async fn ask_copied() -> Result<crate::files::DroppedFile, String> {
    #[cfg(windows)]
    let text = imp::current(MAX_ASK_CHARS);
    #[cfg(not(windows))]
    let text: Option<String> = None;
    let text = text.ok_or_else(|| crate::i18n::t("The clipboard holds no text."))?;
    let dir = crate::files::inbox_dir();
    crate::platform::ensure_private_dir(&crate::settings::local_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let t = crate::platform::local_time();
    let stem = format!("error {:02}-{:02}-{:02}", t.hour, t.minute, t.second);
    let path = crate::recap::write_unique(&dir, &stem, "txt", text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(crate::files::DroppedFile {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        size: text.len() as u64,
    })
}

#[cfg(windows)]
mod imp {
    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Foundation::{HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    use crate::island::WINDOW_LABEL;

    #[derive(Serialize, Clone)]
    struct Copied {
        text: String,
    }

    /// The bytes of one clipboard format, while the clipboard is open.
    unsafe fn data(format: u32) -> Option<Vec<u8>> {
        let handle = unsafe { GetClipboardData(format) }.ok()?;
        let global = HGLOBAL(handle.0);
        let ptr = unsafe { GlobalLock(global) } as *const u8;
        if ptr.is_null() {
            return None;
        }
        let size = unsafe { GlobalSize(global) };
        let out = unsafe { std::slice::from_raw_parts(ptr, size) }.to_vec();
        let _ = unsafe { GlobalUnlock(global) };
        Some(out)
    }

    /// Marked by whoever copied it as not for clipboard watchers or history.
    unsafe fn private() -> bool {
        for name in [w!("ExcludeClipboardContentFromMonitorProcessing"), w!("Clipboard Viewer Ignore")] {
            let format = unsafe { RegisterClipboardFormatW(name) };
            if format != 0 && unsafe { IsClipboardFormatAvailable(format) }.is_ok() {
                return true;
            }
        }
        let history = unsafe { RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory")) };
        history != 0
            && unsafe { IsClipboardFormatAvailable(history) }.is_ok()
            && unsafe { data(history) }.is_some_and(|d| d.len() >= 4 && u32::from_le_bytes([d[0], d[1], d[2], d[3]]) == 0)
    }

    /// The clipboard's text, its first `limit` characters: none when it holds no
    /// text, is marked private, or another program keeps it locked.
    unsafe fn text(hwnd: Option<HWND>, limit: usize) -> Option<String> {
        // Another program may hold the clipboard for a moment.
        let mut opened = false;
        for _ in 0..5 {
            if unsafe { OpenClipboard(hwnd) }.is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if !opened {
            return None;
        }
        let text = if unsafe { private() } {
            None
        } else {
            unsafe { data(CF_UNICODETEXT.0 as u32) }.map(|bytes| {
                let units: Vec<u16> = bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).take_while(|&u| u != 0).collect();
                String::from_utf16_lossy(&units).chars().take(limit).collect::<String>()
            })
        };
        let _ = unsafe { CloseClipboard() };
        text.filter(|t| !t.trim().is_empty())
    }

    /// The clipboard changed and holds text: its beginning, to the island.
    pub unsafe fn changed(hwnd: HWND, app: &AppHandle) {
        if crate::platform::presenting() {
            return;
        }
        if let Some(text) = unsafe { text(Some(hwnd), super::MAX_CHARS) } {
            let _ = app.emit_to(WINDOW_LABEL, "copied", Copied { text });
        }
    }

    /// The clipboard's text now, for a question about it.
    pub fn current(limit: usize) -> Option<String> {
        unsafe { text(None, limit) }
    }
}
