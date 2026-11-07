// The charger, for the island's battery indicator: when the computer is plugged in or
// unplugged, the island hears `power` with the battery's level, and again when the
// battery runs low (20 %, then 10 %) or is full on the charger. Windows calls us (power
// setting notifications); nothing polls. A desktop without a battery is never told
// anything. Linux has no indicator yet. The screen coming back on after it went off
// is told too (`display-on`): someone is back, for the morning's look at today's list.

#[cfg(windows)]
pub use imp::start;

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle) {}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::sync::{Mutex, OnceLock};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Power::{
        GetSystemPowerStatus, PowerSettingRegisterNotification, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS,
        POWERBROADCAST_SETTING, SYSTEM_POWER_STATUS,
    };
    use windows::Win32::System::SystemServices::{
        GUID_ACDC_POWER_SOURCE, GUID_BATTERY_PERCENTAGE_REMAINING, GUID_CONSOLE_DISPLAY_STATE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DEVICE_NOTIFY_CALLBACK, PBT_POWERSETTINGCHANGE};

    use crate::island::WINDOW_LABEL;

    #[derive(Serialize, Clone, Copy)]
    struct Power {
        charging: bool,
        /// The battery, 0…100.
        level: u8,
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// Plugged in at the last notification: Windows tells the current state as soon as
    /// we register, and that one is not a change.
    static PLUGGED: Mutex<Option<bool>> = Mutex::new(None);
    /// The battery level at the last notification, to tell a threshold being crossed.
    static LEVEL: Mutex<Option<u8>> = Mutex::new(None);
    /// The screen at the last notification (0 off, 1 on, 2 dimmed).
    static DISPLAY: Mutex<Option<u32>> = Mutex::new(None);

    /// Worth a word as the level moves from `was` to `now`: low on the battery, full on the charger.
    fn crossed(was: u8, now: u8, charging: bool) -> bool {
        if charging {
            return was < 100 && now >= 100;
        }
        [20, 10].iter().any(|&t| was > t && now <= t)
    }

    unsafe extern "system" fn on_power(_context: *const c_void, kind: u32, setting: *const c_void) -> u32 {
        let Some(s) = (unsafe { (setting as *const POWERBROADCAST_SETTING).as_ref() }) else { return 0 };
        if kind != PBT_POWERSETTINGCHANGE || s.DataLength < 4 {
            return 0;
        }
        if s.PowerSetting == GUID_CONSOLE_DISPLAY_STATE {
            let state = unsafe { std::ptr::read_unaligned(s.Data.as_ptr() as *const u32) };
            let was = DISPLAY.lock().unwrap().replace(state);
            if was == Some(0) && state == 1 {
                if let Some(app) = APP.get() {
                    let _ = app.emit_to(WINDOW_LABEL, "display-on", ());
                }
            }
            return 0;
        }
        if s.PowerSetting == GUID_BATTERY_PERCENTAGE_REMAINING {
            let level = unsafe { std::ptr::read_unaligned(s.Data.as_ptr() as *const u32) }.min(100) as u8;
            let was = LEVEL.lock().unwrap().replace(level);
            let charging = PLUGGED.lock().unwrap().unwrap_or(false);
            if was.is_some_and(|was| crossed(was, level, charging)) {
                if let Some(app) = APP.get() {
                    let _ = app.emit_to(WINDOW_LABEL, "power", Power { charging, level });
                }
            }
            return 0;
        }
        if s.PowerSetting != GUID_ACDC_POWER_SOURCE {
            return 0;
        }
        // 0: on the charger; 1: on the battery; 2: a short-term source (a UPS).
        let source = unsafe { std::ptr::read_unaligned(s.Data.as_ptr() as *const u32) };
        let plugged = source == 0;
        let was = PLUGGED.lock().unwrap().replace(plugged);
        if was.is_none() || was == Some(plugged) {
            return 0;
        }
        let mut status = SYSTEM_POWER_STATUS::default();
        let known = unsafe { GetSystemPowerStatus(&mut status) }.is_ok();
        // 128: no battery at all; 255: the level is not known.
        if !known || status.BatteryFlag == 128 || status.BatteryLifePercent > 100 {
            return 0;
        }
        if let Some(app) = APP.get() {
            let _ = app.emit_to(WINDOW_LABEL, "power", Power { charging: plugged, level: status.BatteryLifePercent });
        }
        0
    }

    pub fn start(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        // Windows keeps the pointer for as long as the registration lives: the app's life.
        let params: &'static mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS =
            Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS { Callback: Some(on_power), Context: std::ptr::null_mut() }));
        for setting in [GUID_ACDC_POWER_SOURCE, GUID_BATTERY_PERCENTAGE_REMAINING, GUID_CONSOLE_DISPLAY_STATE] {
            let mut registration: *mut c_void = std::ptr::null_mut();
            unsafe {
                let _ = PowerSettingRegisterNotification(
                    &setting,
                    DEVICE_NOTIFY_CALLBACK,
                    HANDLE(params as *mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS as *mut c_void),
                    &mut registration,
                );
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::crossed;

        #[test]
        fn low_on_the_battery_and_full_on_the_charger() {
            assert!(crossed(21, 20, false));
            assert!(crossed(11, 10, false));
            assert!(!crossed(20, 19, false), "once per threshold");
            assert!(!crossed(15, 16, true));
            assert!(crossed(99, 100, true));
            assert!(!crossed(100, 100, true));
            assert!(!crossed(99, 100, false), "full only counts on the charger");
        }
    }
}
