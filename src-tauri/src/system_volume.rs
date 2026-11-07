// The system volume, for the island's volume indicator: whenever the default output's
// volume or mute changes (the volume keys, the taskbar slider, an app), the island hears
// `system-volume` with the new level. Windows calls us (an endpoint volume callback);
// nothing polls. When the default output changes (headphones connected or taken off),
// the island hears `audio-output` with its name and whether it is headphones, and the
// callback moves to the new output. Linux has neither yet.

#[cfg(windows)]
pub use imp::start;

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle) {}

#[cfg(windows)]
mod imp {
    use std::sync::{mpsc, Mutex};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::core::{implement, Result, BOOL, PCWSTR};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::Endpoints::{
        IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
    };
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, EDataFlow, ERole, Headphones, Headset, IMMDevice, IMMDeviceEnumerator, IMMNotificationClient,
        IMMNotificationClient_Impl, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
        PKEY_AudioEndpoint_FormFactor,
    };
    use windows::Win32::System::Com::StructuredStorage::{PropVariantToStringAlloc, PropVariantToUInt32};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

    use crate::island::WINDOW_LABEL;

    #[derive(Serialize, Clone, Copy, PartialEq)]
    struct Level {
        /// 0…1, as the taskbar slider shows it.
        level: f32,
        muted: bool,
    }

    #[implement(IAudioEndpointVolumeCallback)]
    struct OnVolume {
        app: AppHandle,
        /// The last level told: Windows also calls when only a channel moved.
        last: Mutex<Option<Level>>,
    }

    impl IAudioEndpointVolumeCallback_Impl for OnVolume_Impl {
        fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
            let Some(d) = (unsafe { data.as_ref() }) else { return Ok(()) };
            let now = Level { level: d.fMasterVolume, muted: d.bMuted != BOOL(0) };
            let mut last = self.last.lock().unwrap();
            let same = last.is_some_and(|l| l.muted == now.muted && (l.level - now.level).abs() < 0.002);
            if !same {
                *last = Some(now);
                let _ = self.app.emit_to(WINDOW_LABEL, "system-volume", now);
            }
            Ok(())
        }
    }

    /// Hears the default output change, and nothing else.
    #[implement(IMMNotificationClient)]
    struct OnDevice(mpsc::Sender<()>);

    impl IMMNotificationClient_Impl for OnDevice_Impl {
        fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> Result<()> {
            Ok(())
        }
        fn OnDeviceAdded(&self, _: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn OnDeviceRemoved(&self, _: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, _: &PCWSTR) -> Result<()> {
            if flow == eRender && role == eConsole {
                let _ = self.0.send(());
            }
            Ok(())
        }
        fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> Result<()> {
            Ok(())
        }
    }

    #[derive(Serialize, Clone)]
    struct Output {
        /// What the output is called, without the kind: "WH-1000XM4" for "Headphones (WH-1000XM4)".
        name: String,
        headphones: bool,
    }

    /// "Headphones (WH-1000XM4)" → "WH-1000XM4"; "Speakers (Realtek(R) Audio)" → "Realtek(R) Audio".
    fn device_name(friendly: &str) -> String {
        match friendly.find(" (") {
            Some(i) if friendly.ends_with(')') => friendly[i + 2..friendly.len() - 1].to_string(),
            _ => friendly.to_string(),
        }
    }

    unsafe fn describe(device: &IMMDevice) -> Option<Output> {
        let store = unsafe { device.OpenPropertyStore(STGM_READ) }.ok()?;
        let name = unsafe { store.GetValue(&PKEY_Device_FriendlyName) }.ok()?;
        let text = unsafe { PropVariantToStringAlloc(&name) }.ok()?;
        let friendly = unsafe { text.to_string() }.unwrap_or_default();
        unsafe { CoTaskMemFree(Some(text.0 as *const _)) };
        let form = unsafe { store.GetValue(&PKEY_AudioEndpoint_FormFactor) }
            .ok()
            .and_then(|v| unsafe { PropVariantToUInt32(&v) }.ok())
            .unwrap_or(0) as i32;
        Some(Output { name: device_name(&friendly), headphones: form == Headphones.0 || form == Headset.0 })
    }

    pub fn start(app: &AppHandle) {
        let app = app.clone();
        // A thread that only waits: for the default output to change.
        let _ = std::thread::Builder::new().name("puhu-volume".into()).spawn(move || unsafe {
            if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
                return;
            }
            let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else {
                return;
            };
            let (tx, rx) = mpsc::channel();
            let client: IMMNotificationClient = OnDevice(tx).into();
            let _ = devices.RegisterEndpointNotificationCallback(&client);
            let callback: IAudioEndpointVolumeCallback = OnVolume { app: app.clone(), last: Mutex::new(None) }.into();
            let mut first = true;
            loop {
                let device = devices.GetDefaultAudioEndpoint(eRender, eConsole);
                // A new output (not the one there at start): the island says which.
                if !first {
                    if let Some(output) = device.as_ref().ok().and_then(|d| describe(d)) {
                        let _ = app.emit_to(WINDOW_LABEL, "audio-output", output);
                    }
                }
                first = false;
                let volume = device.and_then(|d| d.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None));
                if let Ok(v) = &volume {
                    let _ = v.RegisterControlChangeNotify(&callback);
                }
                if rx.recv().is_err() {
                    break;
                }
                if let Ok(v) = &volume {
                    let _ = v.UnregisterControlChangeNotify(&callback);
                }
            }
        });
    }
}
