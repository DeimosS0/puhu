// USB drives for the island: one plugged in is caught (its name, how much room is left;
// a click opens it), and it can be ejected safely from the island, as Explorer's Eject
// does (the USB device itself is asked to stop, and refuses while a file on it is open).
// Windows tells us when a volume comes or goes (CM_Register_Notification); a thread that
// only waits looks at the drive letters then. Only drives on the USB bus count: a card in
// a reader built into the laptop is left to Windows. Linux has none of this yet.

use serde::Serialize;

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// "E".
    pub letter: String,
    /// Its volume name; empty when it has none.
    pub label: String,
    pub free: u64,
    pub total: u64,
}

/// What the island hears (`usb`): one came, or went (taken out after an eject, or pulled).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsbNews {
    pub kind: &'static str,
    pub drive: Drive,
    pub ejected: bool,
}

#[cfg(windows)]
pub use imp::start;

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle) {}

/// The USB drives in now, for a page that (re)loads.
#[tauri::command]
pub fn usb_drives() -> Vec<Drive> {
    #[cfg(windows)]
    {
        imp::known()
    }
    #[cfg(not(windows))]
    Vec::new()
}

/// One of them, open in Explorer.
#[tauri::command]
pub fn usb_open(letter: String) {
    #[cfg(windows)]
    if imp::known().iter().any(|d| d.letter == letter) {
        crate::platform::reveal_folder(&format!("{letter}:\\"));
    }
    #[cfg(not(windows))]
    let _ = letter;
}

/// One of them, ejected safely; refused (and why) while something holds a file on it.
#[tauri::command]
pub async fn usb_eject(letter: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || imp::eject(&letter)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = letter;
        Err(crate::i18n::t("It could not be ejected."))
    }
}

#[cfg(windows)]
mod imp {
    use std::collections::BTreeMap;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Emitter};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Devices::DeviceAndDriverInstallation::{
        CM_Get_Parent, CM_Register_Notification, CM_Request_Device_EjectW, SetupDiDestroyDeviceInfoList,
        SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW, SetupDiGetDeviceInterfaceDetailW, CM_NOTIFY_ACTION,
        CM_NOTIFY_EVENT_DATA, CM_NOTIFY_FILTER, CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE, CR_SUCCESS, DIGCF_DEVICEINTERFACE,
        DIGCF_PRESENT, HCMNOTIFICATION, PNP_VETO_TYPE, SP_DEVICE_INTERFACE_DATA, SP_DEVICE_INTERFACE_DETAIL_DATA_W,
        SP_DEVINFO_DATA,
    };
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        BusTypeUsb, CreateFileW, GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
        FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::IO::DeviceIoControl;
    use windows::Win32::System::Ioctl::{
        PropertyStandardQuery, StorageDeviceProperty, GUID_DEVINTERFACE_DISK, GUID_DEVINTERFACE_VOLUME,
        IOCTL_STORAGE_GET_DEVICE_NUMBER, IOCTL_STORAGE_QUERY_PROPERTY, STORAGE_DEVICE_DESCRIPTOR,
        STORAGE_DEVICE_NUMBER, STORAGE_PROPERTY_QUERY,
    };

    use super::{Drive, UsbNews};
    use crate::island::WINDOW_LABEL;

    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    /// A drive gone this soon after Puhu ejected it was ejected, not pulled.
    const EJECTED_FOR: Duration = Duration::from_secs(30);

    static KNOWN: Mutex<BTreeMap<String, Drive>> = Mutex::new(BTreeMap::new());
    static EJECTED: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    static WAKE: OnceLock<Mutex<Sender<()>>> = OnceLock::new();

    pub fn known() -> Vec<super::Drive> {
        KNOWN.lock().unwrap().values().cloned().collect()
    }

    fn device(letter: &str) -> Option<HANDLE> {
        let path = HSTRING::from(format!("\\\\.\\{letter}:"));
        unsafe {
            CreateFileW(&path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None).ok()
        }
    }

    fn on_usb(letter: &str) -> bool {
        let Some(h) = device(letter) else { return false };
        let query = STORAGE_PROPERTY_QUERY { PropertyId: StorageDeviceProperty, QueryType: PropertyStandardQuery, AdditionalParameters: [0] };
        let mut desc = STORAGE_DEVICE_DESCRIPTOR::default();
        let ok = unsafe {
            DeviceIoControl(
                h,
                IOCTL_STORAGE_QUERY_PROPERTY,
                Some(&query as *const _ as *const _),
                std::mem::size_of::<STORAGE_PROPERTY_QUERY>() as u32,
                Some(&mut desc as *mut _ as *mut _),
                std::mem::size_of::<STORAGE_DEVICE_DESCRIPTOR>() as u32,
                None,
                None,
            )
        }
        .is_ok();
        unsafe {
            let _ = CloseHandle(h);
        }
        ok && desc.BusType == BusTypeUsb
    }

    /// The USB drives by their letters, as they are now.
    fn scan() -> BTreeMap<String, Drive> {
        let system = std::env::var("SystemDrive").unwrap_or_default().to_uppercase();
        let mask = unsafe { GetLogicalDrives() };
        let mut out = BTreeMap::new();
        for i in 0..26u8 {
            if mask & (1 << i) == 0 {
                continue;
            }
            let letter = ((b'A' + i) as char).to_string();
            if system.starts_with(&letter) {
                continue;
            }
            let root = HSTRING::from(format!("{letter}:\\"));
            let kind = unsafe { GetDriveTypeW(&root) };
            if (kind != DRIVE_REMOVABLE && kind != DRIVE_FIXED) || !on_usb(&letter) {
                continue;
            }
            let mut name = [0u16; 261];
            let label = unsafe { GetVolumeInformationW(&root, Some(&mut name), None, None, None, None) }
                .map(|_| String::from_utf16_lossy(&name[..name.iter().position(|&c| c == 0).unwrap_or(0)]))
                .unwrap_or_default();
            let (mut free, mut total) = (0u64, 0u64);
            unsafe {
                let _ = GetDiskFreeSpaceExW(&root, Some(&mut free), Some(&mut total), None);
            }
            // No medium (an empty card reader): not a drive to show.
            if total == 0 {
                continue;
            }
            out.insert(letter.clone(), Drive { letter, label, free, total });
        }
        out
    }

    /// The drive letters looked at again: what came and what went goes to the island.
    fn rescan(app: &AppHandle) {
        let now = scan();
        let mut known = KNOWN.lock().unwrap();
        for (letter, drive) in &now {
            if !known.contains_key(letter) {
                crate::log::line(format!("usb: {letter}: in"));
                let _ = app.emit_to(WINDOW_LABEL, "usb", UsbNews { kind: "in", drive: drive.clone(), ejected: false });
            }
        }
        for (letter, drive) in known.iter() {
            if !now.contains_key(letter) {
                let ejected = EJECTED.lock().unwrap().as_ref().is_some_and(|(l, at)| l == letter && at.elapsed() < EJECTED_FOR);
                crate::log::line(format!("usb: {letter}: out{}", if ejected { " (ejected)" } else { "" }));
                let _ = app.emit_to(WINDOW_LABEL, "usb", UsbNews { kind: "out", drive: drive.clone(), ejected });
            }
        }
        *known = now;
    }

    unsafe extern "system" fn changed(
        _: HCMNOTIFICATION,
        _: *const core::ffi::c_void,
        _: CM_NOTIFY_ACTION,
        _: *const CM_NOTIFY_EVENT_DATA,
        _: u32,
    ) -> u32 {
        if let Some(wake) = WAKE.get() {
            let _ = wake.lock().unwrap().send(());
        }
        0
    }

    pub fn start(app: &AppHandle) {
        let (tx, rx) = channel::<()>();
        if WAKE.set(Mutex::new(tx)).is_err() {
            return;
        }
        *KNOWN.lock().unwrap() = scan();
        let mut filter = CM_NOTIFY_FILTER {
            cbSize: std::mem::size_of::<CM_NOTIFY_FILTER>() as u32,
            FilterType: CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE,
            ..Default::default()
        };
        filter.u.DeviceInterface.ClassGuid = GUID_DEVINTERFACE_VOLUME;
        let mut handle = HCMNOTIFICATION::default();
        if unsafe { CM_Register_Notification(&filter, None, Some(changed), &mut handle) } != CR_SUCCESS {
            crate::log::line("usb: no volume notifications");
            return;
        }
        // Kept for the life of the app: the handle is never unregistered.
        let _ = handle;
        let app = app.clone();
        let _ = std::thread::Builder::new().name("puhu-usb".into()).spawn(move || {
            while rx.recv().is_ok() {
                // A burst of notifications for one drive; its letter comes a moment later.
                std::thread::sleep(Duration::from_millis(500));
                while rx.try_recv().is_ok() {}
                rescan(&app);
                std::thread::sleep(Duration::from_millis(1500));
                while rx.try_recv().is_ok() {}
                rescan(&app);
            }
        });
    }

    fn device_number(h: HANDLE) -> Option<STORAGE_DEVICE_NUMBER> {
        let mut num = STORAGE_DEVICE_NUMBER::default();
        unsafe {
            DeviceIoControl(
                h,
                IOCTL_STORAGE_GET_DEVICE_NUMBER,
                None,
                0,
                Some(&mut num as *mut _ as *mut _),
                std::mem::size_of::<STORAGE_DEVICE_NUMBER>() as u32,
                None,
                None,
            )
        }
        .ok()
        .map(|_| num)
    }

    /// The disk device a drive letter lives on (its device instance).
    fn disk_of(letter: &str) -> Option<u32> {
        let h = device(letter)?;
        let wanted = device_number(h);
        unsafe {
            let _ = CloseHandle(h);
        }
        let wanted = wanted?;
        unsafe {
            let set = SetupDiGetClassDevsW(Some(&GUID_DEVINTERFACE_DISK), PCWSTR::null(), None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE).ok()?;
            let mut found = None;
            for i in 0.. {
                let mut iface = SP_DEVICE_INTERFACE_DATA { cbSize: std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32, ..Default::default() };
                if SetupDiEnumDeviceInterfaces(set, None, &GUID_DEVINTERFACE_DISK, i, &mut iface).is_err() {
                    break;
                }
                let mut need = 0u32;
                let _ = SetupDiGetDeviceInterfaceDetailW(set, &iface, None, 0, Some(&mut need), None);
                if need == 0 {
                    continue;
                }
                // The detail is a header and the path after it, in one buffer.
                let mut buf = vec![0u64; (need as usize).div_ceil(8)];
                let detail = buf.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
                (*detail).cbSize = std::mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
                let mut info = SP_DEVINFO_DATA { cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
                if SetupDiGetDeviceInterfaceDetailW(set, &iface, Some(detail), need, None, Some(&mut info)).is_err() {
                    continue;
                }
                let path = PCWSTR((*detail).DevicePath.as_ptr());
                let Ok(disk) = CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None) else {
                    continue;
                };
                let num = device_number(disk);
                let _ = CloseHandle(disk);
                if num.is_some_and(|n| n.DeviceNumber == wanted.DeviceNumber && n.DeviceType == wanted.DeviceType) {
                    found = Some(info.DevInst);
                    break;
                }
            }
            let _ = SetupDiDestroyDeviceInfoList(set);
            found
        }
    }

    pub fn eject(letter: &str) -> Result<(), String> {
        if !KNOWN.lock().unwrap().contains_key(letter) {
            return Err(crate::i18n::t("It could not be ejected."));
        }
        let disk = disk_of(letter).ok_or_else(|| crate::i18n::t("It could not be ejected."))?;
        let mut parent = 0u32;
        if unsafe { CM_Get_Parent(&mut parent, disk, 0) } != CR_SUCCESS {
            return Err(crate::i18n::t("It could not be ejected."));
        }
        // The USB device itself, as Explorer's Eject asks it; a veto (a file open on it)
        // comes back instead of Windows' own dialog. A moment's retry: Explorer may still
        // be letting go of the drive's window.
        for attempt in 0..3 {
            let mut veto = PNP_VETO_TYPE(0);
            let mut name = [0u16; 260];
            let done = unsafe { CM_Request_Device_EjectW(parent, Some(&mut veto), Some(&mut name), 0) };
            if done == CR_SUCCESS && veto.0 == 0 {
                *EJECTED.lock().unwrap() = Some((letter.to_string(), Instant::now()));
                crate::log::line(format!("usb: {letter}: ejected"));
                return Ok(());
            }
            crate::log::line(format!("usb: {letter}: eject refused ({}, veto {})", done.0, veto.0));
            if attempt < 2 {
                std::thread::sleep(Duration::from_millis(400));
            }
        }
        Err(crate::i18n::t("It is in use: close what has a file open on it and try again."))
    }
}
