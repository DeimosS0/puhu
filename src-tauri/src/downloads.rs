// Downloads that finish, for the island: a file arriving in the Downloads folder under
// its final name. A browser renames its .crdownload or .part once done; a save writes the
// file itself, and is told once it has stopped growing. Windows tells us (a thread that
// only waits on ReadDirectoryChangesW); nothing polls. The island shows the name, and a
// click on it shows the file in its folder. Linux has no indicator yet.

#[cfg(windows)]
pub use imp::{downloads_dir, start};

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle) {}

/// The download the island last showed, in its folder.
#[tauri::command]
pub fn reveal_last_download() {
    #[cfg(windows)]
    imp::reveal_last();
}

/// Still being written, or not a download at all.
#[cfg_attr(not(windows), allow(dead_code))]
fn partial(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with('.')
        || lower.starts_with('~')
        || lower == "desktop.ini"
        || [".crdownload", ".part", ".partial", ".download", ".opdownload", ".tmp"].iter().any(|e| lower.ends_with(e))
}

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, ReadDirectoryChangesW, FILE_ACTION_ADDED, FILE_ACTION_RENAMED_NEW_NAME, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_LIST_DIRECTORY, FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_INFORMATION, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    use crate::island::WINDOW_LABEL;

    #[derive(Serialize, Clone)]
    struct Download {
        name: String,
    }

    /// The last one shown: what a click reveals (the page never hands us a path), and
    /// when, so one file is not told twice (a rename right after its placeholder).
    static LAST: Mutex<Option<(PathBuf, Instant)>> = Mutex::new(None);

    pub fn downloads_dir() -> Option<PathBuf> {
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG};
        unsafe {
            let path = SHGetKnownFolderPath(&FOLDERID_Downloads, KNOWN_FOLDER_FLAG(0), None).ok()?;
            let dir = path.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(path.0 as _));
            dir
        }
    }

    fn finished(app: &AppHandle, path: &Path) {
        // A file Puhu made from a drop (a PDF beside a downloaded photo) is no download.
        if crate::convert::is_made(path) {
            return;
        }
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else { return };
        {
            let mut last = LAST.lock().unwrap();
            if last.as_ref().is_some_and(|(p, at)| p == path && at.elapsed() < Duration::from_secs(5)) {
                return;
            }
            *last = Some((path.to_path_buf(), Instant::now()));
        }
        if crate::platform::presenting() {
            return;
        }
        let _ = app.emit_to(WINDOW_LABEL, "download", Download { name });
    }

    /// A file written in place: told once it has stopped growing (a placeholder of 0
    /// bytes, as Firefox leaves while the .part downloads, never is).
    fn when_settled(app: AppHandle, path: PathBuf) {
        std::thread::spawn(move || {
            let mut size = None;
            for _ in 0..40 {
                std::thread::sleep(Duration::from_millis(750));
                let Ok(now) = std::fs::metadata(&path).map(|m| m.len()) else { return };
                if now > 0 && size == Some(now) {
                    return finished(&app, &path);
                }
                size = Some(now);
            }
        });
    }

    pub fn start(app: &AppHandle) {
        let Some(dir) = downloads_dir() else { return };
        let app = app.clone();
        let _ = std::thread::Builder::new().name("puhu-downloads".into()).spawn(move || unsafe {
            let wide: Vec<u16> = dir.as_os_str().encode_wide_null();
            let Ok(handle) = CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_LIST_DIRECTORY.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                None,
            ) else {
                return;
            };
            // u32s, so every record starts aligned as Windows writes it.
            let mut buf = vec![0u32; 16 * 1024];
            loop {
                let mut got = 0u32;
                let read = ReadDirectoryChangesW(
                    handle,
                    buf.as_mut_ptr().cast(),
                    (buf.len() * 4) as u32,
                    false,
                    FILE_NOTIFY_CHANGE_FILE_NAME,
                    Some(&mut got),
                    None,
                    None,
                );
                if read.is_err() {
                    break;
                }
                let mut offset = 0usize;
                while got > 0 {
                    let info = &*(buf.as_ptr().cast::<u8>().add(offset) as *const FILE_NOTIFY_INFORMATION);
                    let name = String::from_utf16_lossy(std::slice::from_raw_parts(
                        info.FileName.as_ptr(),
                        info.FileNameLength as usize / 2,
                    ));
                    if !super::partial(&name) {
                        let path = dir.join(&name);
                        if info.Action == FILE_ACTION_RENAMED_NEW_NAME && path.is_file() {
                            finished(&app, &path);
                        } else if info.Action == FILE_ACTION_ADDED && path.is_file() {
                            when_settled(app.clone(), path);
                        }
                    }
                    if info.NextEntryOffset == 0 {
                        break;
                    }
                    offset += info.NextEntryOffset as usize;
                }
            }
            let _ = CloseHandle(handle);
        });
    }

    pub fn reveal_last() {
        let last = LAST.lock().unwrap().as_ref().map(|(p, _)| p.clone());
        if let Some(path) = last.filter(|p| p.exists()) {
            crate::platform::reveal_file(&path);
        }
    }

    trait WideNull {
        fn encode_wide_null(&self) -> Vec<u16>;
    }

    impl WideNull for std::ffi::OsStr {
        fn encode_wide_null(&self) -> Vec<u16> {
            use std::os::windows::ffi::OsStrExt;
            self.encode_wide().chain(std::iter::once(0)).collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::partial;

    #[test]
    fn only_finished_files_count() {
        for name in ["Unconfirmed 1234.crdownload", "song.mp3.part", "x.tmp", ".hidden", "~$doc.docx", "desktop.ini"] {
            assert!(partial(name), "{name}");
        }
        for name in ["song.mp3", "report.pdf", "setup.exe", "archive.zip"] {
            assert!(!partial(name), "{name}");
        }
    }
}
