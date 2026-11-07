// Who uses the camera or the microphone, for the island's privacy dot. Windows keeps it
// under the capability access manager's consent store: an app that has the device open
// has a LastUsedTimeStop of 0. Windows also tells us when anything there changes
// (RegNotifyChangeKeyValue on the two keys), so nothing polls. Linux has no dot yet.

#[cfg(windows)]
pub use imp::start;

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle) {}

#[cfg(windows)]
mod imp {
    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegNotifyChangeKeyValue, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_NOTIFY, KEY_READ, REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_CHANGE_NAME,
    };
    use windows::Win32::System::Threading::{CreateEventW, WaitForMultipleObjects, INFINITE};

    use crate::island::WINDOW_LABEL;

    const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\";

    #[derive(Serialize, Clone, PartialEq, Default)]
    struct InUse {
        /// The apps that have the microphone open, by a short name.
        mic: Vec<String>,
        camera: Vec<String>,
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn open(parent: HKEY, path: &str, access: windows::Win32::System::Registry::REG_SAM_FLAGS) -> Option<HKEY> {
        let mut key = HKEY::default();
        let p = wide(path);
        (unsafe { RegOpenKeyExW(parent, PCWSTR(p.as_ptr()), None, access, &mut key) } == ERROR_SUCCESS).then_some(key)
    }

    unsafe fn subkeys(key: HKEY) -> Vec<String> {
        let mut out = Vec::new();
        let mut i = 0;
        loop {
            let mut name = [0u16; 512];
            let mut len = name.len() as u32;
            if unsafe { RegEnumKeyExW(key, i, Some(windows::core::PWSTR(name.as_mut_ptr())), &mut len, None, None, None, None) } != ERROR_SUCCESS {
                break;
            }
            out.push(String::from_utf16_lossy(&name[..len as usize]));
            i += 1;
        }
        out
    }

    /// The app behind a key holds the device right now: started, and not stopped since.
    unsafe fn in_use(key: HKEY) -> bool {
        let qword = |name: PCWSTR| -> Option<u64> {
            let mut value = 0u64;
            let mut size = 8u32;
            (unsafe { RegQueryValueExW(key, name, None, None, Some(&mut value as *mut u64 as *mut u8), Some(&mut size)) } == ERROR_SUCCESS)
                .then_some(value)
        };
        qword(w!("LastUsedTimeStop")) == Some(0) && qword(w!("LastUsedTimeStart")).unwrap_or(0) > 0
    }

    /// "C:#Program Files#Zoom#bin#Zoom.exe" → "Zoom"; "Microsoft.WindowsCamera_8wekyb3d8bbwe" → "WindowsCamera".
    fn short_name(key: &str) -> String {
        if key.contains('#') {
            let file = key.rsplit('#').next().unwrap_or(key);
            return file.rsplit_once('.').map_or(file, |(stem, _)| stem).to_string();
        }
        let family = key.split('_').next().unwrap_or(key);
        family.rsplit('.').next().unwrap_or(family).to_string()
    }

    unsafe fn users(device: &str) -> Vec<String> {
        let mut out = Vec::new();
        let Some(root) = (unsafe { open(HKEY_CURRENT_USER, &format!("{STORE}{device}"), KEY_READ) }) else { return out };
        for name in unsafe { subkeys(root) } {
            let Some(app) = (unsafe { open(root, &name, KEY_READ) }) else { continue };
            if name == "NonPackaged" {
                for exe in unsafe { subkeys(app) } {
                    if let Some(k) = unsafe { open(app, &exe, KEY_READ) } {
                        if unsafe { in_use(k) } {
                            out.push(short_name(&exe));
                        }
                        let _ = unsafe { RegCloseKey(k) };
                    }
                }
            } else if unsafe { in_use(app) } {
                out.push(short_name(&name));
            }
            let _ = unsafe { RegCloseKey(app) };
        }
        let _ = unsafe { RegCloseKey(root) };
        out.sort();
        out.dedup();
        out
    }

    pub fn start(app: &AppHandle) {
        let app = app.clone();
        // A thread that only waits: for either key to change.
        let _ = std::thread::Builder::new().name("puhu-privacy".into()).spawn(move || unsafe {
            let devices = ["microphone", "webcam"];
            let keys: Vec<HKEY> = devices.iter().filter_map(|d| open(HKEY_CURRENT_USER, &format!("{STORE}{d}"), KEY_NOTIFY)).collect();
            if keys.len() != devices.len() {
                return;
            }
            let events: Vec<HANDLE> = keys.iter().filter_map(|_| CreateEventW(None, false, false, PCWSTR::null()).ok()).collect();
            if events.len() != keys.len() {
                return;
            }
            let mut last = InUse::default();
            loop {
                for (k, e) in keys.iter().zip(&events) {
                    let _ = RegNotifyChangeKeyValue(*k, true, REG_NOTIFY_CHANGE_LAST_SET | REG_NOTIFY_CHANGE_NAME, Some(*e), true);
                }
                let now = InUse { mic: users("microphone"), camera: users("webcam") };
                if now != last {
                    let _ = app.emit_to(WINDOW_LABEL, "privacy", now.clone());
                    last = now;
                }
                let woke = WaitForMultipleObjects(&events, false, INFINITE);
                if woke.0 >= WAIT_OBJECT_0.0 + events.len() as u32 {
                    break;
                }
            }
            for e in events {
                let _ = CloseHandle(e);
            }
            for k in keys {
                let _ = RegCloseKey(k);
            }
        });
    }

    #[cfg(test)]
    mod tests {
        use super::short_name;

        #[test]
        fn apps_get_a_short_name() {
            assert_eq!(short_name("C:#Program Files#Zoom#bin#Zoom.exe"), "Zoom");
            assert_eq!(short_name("Microsoft.WindowsCamera_8wekyb3d8bbwe"), "WindowsCamera");
            assert_eq!(short_name("Discord"), "Discord");
        }
    }
}
