// Ask the screen (docs/game-mode.md): one shortcut takes the monitor under the pointer
// and the island opens the chat on it. The picture is taken with Windows Graphics
// Capture, which sees borderless and most full-screen games where GDI shows black, and
// reads only: nothing is injected into the game. Puhu's own windows are left out of it.
//
// The picture goes into the inbox like a dropped file (files.rs), so every chat
// provider that reads a dropped picture reads this one, and it goes the same way: the
// chip's ×, a new chat, or the inbox's daily sweep. Nothing is taken before the key is
// pressed, and nothing is sent before the user asks.

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Longest side sent: Claude reads ~1.15 megapixels as about 1,600 tokens, and more
/// detail only costs time and upload.
const MAX_SIDE: usize = 1568;
/// The island's thumbnail at most, at 2x.
const THUMB_W: usize = 240;
const THUMB_H: usize = 136;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screen {
    pub name: String,
    pub path: String,
    /// A small PNG data URL for the chat's chip.
    pub thumb: String,
    /// Game mode was on: it waits for the island to close (game::game_resume).
    pub game: bool,
}

/// Takes the screen under the pointer into the inbox. A game in front leaves game
/// mode quietly: the user called Puhu in, and it starts again once the island closes.
#[tauri::command]
pub async fn ask_screen(app: AppHandle) -> Result<Screen, String> {
    let hidden = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().hide_from_capture)
        .unwrap_or(false);
    let windows: Vec<_> = app.webview_windows().into_values().collect();
    let screen = tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        if !hidden {
            windows.iter().for_each(|w| crate::platform::hide_from_capture(w, true));
        }
        let shot = capture();
        if !hidden {
            windows.iter().for_each(|w| crate::platform::hide_from_capture(w, false));
        }
        let (rgb, w, h) = shot.map_err(|err| {
            crate::log::line(format!("ask the screen: {err}"));
            crate::i18n::t("Couldn't take the screen.")
        })?;
        let screen = keep(&rgb, w, h).ok_or_else(|| crate::i18n::t("Couldn't take the screen."));
        crate::log::line(format!("ask the screen: {w}x{h} in {} ms", started.elapsed().as_millis()));
        screen
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Screen { game: crate::game::step_out(&app), ..screen })
}

/// Writes the picture into the inbox, at most MAX_SIDE, and makes its thumbnail.
fn keep(rgb: &[u8], w: usize, h: usize) -> Option<Screen> {
    use crate::screenshot::{base64, png, shrink};
    let (big, bw, bh) = shrink(rgb, w, h, MAX_SIDE, MAX_SIDE);
    let bytes = png(&big, bw, bh, png::Compression::Balanced)?;
    let dir = crate::files::inbox_dir();
    crate::platform::ensure_private_dir(&crate::settings::local_dir()).ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let t = crate::platform::local_time();
    let path = crate::recap::write_unique(&dir, &format!("screen {:02}-{:02}-{:02}", t.hour, t.minute, t.second), "png", &bytes).ok()?;
    let (small, sw, sh) = shrink(&big, bw, bh, THUMB_W, THUMB_H);
    let thumb = format!("data:image/png;base64,{}", base64(&png(&small, sw, sh, png::Compression::Fast)?));
    Some(Screen {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        thumb,
        game: false,
    })
}

#[cfg(not(windows))]
fn capture() -> Result<(Vec<u8>, usize, usize), String> {
    Err("only on Windows".into())
}

/// The monitor under the pointer as top-down RGB: one frame of a capture session.
#[cfg(windows)]
fn capture() -> Result<(Vec<u8>, usize, usize), String> {
    use std::time::{Duration, Instant};
    use windows::core::{factory, Interface};
    use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
    use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Win32::Foundation::{HMODULE, POINT};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::IDXGIDevice;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
    use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let e = |err: windows::core::Error| err.message();
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
        return Err("Windows Graphics Capture is not supported here".into());
    }
    unsafe {
        let mut at = POINT::default();
        let _ = GetCursorPos(&mut at);
        let monitor = MonitorFromPoint(at, MONITOR_DEFAULTTOPRIMARY);
        let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(e)?;
        let item: GraphicsCaptureItem = interop.CreateForMonitor(monitor).map_err(e)?;

        let mut device = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            None,
        )
        .map_err(e)?;
        let device = device.ok_or("no Direct3D device")?;
        let winrt_device: IDirect3DDevice =
            CreateDirect3D11DeviceFromDXGIDevice(&device.cast::<IDXGIDevice>().map_err(e)?).map_err(e)?.cast().map_err(e)?;

        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            1,
            item.Size().map_err(e)?,
        )
        .map_err(e)?;
        let session = pool.CreateCaptureSession(&item).map_err(e)?;
        // Older Windows lack these two: a pointer or a frame round the screen at worst.
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.SetIsBorderRequired(false);
        session.StartCapture().map_err(e)?;
        // The first frame comes at once; a busy GPU may take a moment.
        let deadline = Instant::now() + Duration::from_secs(2);
        let frame = loop {
            if let Ok(frame) = pool.TryGetNextFrame() {
                break frame;
            }
            if Instant::now() > deadline {
                let _ = session.Close();
                let _ = pool.Close();
                return Err("no frame within 2 s".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        };

        let texture: ID3D11Texture2D =
            frame.Surface().map_err(e)?.cast::<IDirect3DDxgiInterfaceAccess>().map_err(e)?.GetInterface().map_err(e)?;
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        texture.GetDesc(&mut desc);
        desc.Usage = D3D11_USAGE_STAGING;
        desc.BindFlags = 0;
        desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
        desc.MiscFlags = 0;
        let mut staging = None;
        device.CreateTexture2D(&desc, None, Some(&mut staging)).map_err(e)?;
        let staging = staging.ok_or("no staging texture")?;
        let context = device.GetImmediateContext().map_err(e)?;
        context.CopyResource(&staging, &texture);
        let _ = frame.Close();
        let _ = session.Close();
        let _ = pool.Close();

        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).map_err(e)?;
        let (w, h, pitch) = (desc.Width as usize, desc.Height as usize, mapped.RowPitch as usize);
        let src = std::slice::from_raw_parts(mapped.pData as *const u8, pitch * h);
        let mut rgb = Vec::with_capacity(w * h * 3);
        for row in src.chunks_exact(pitch) {
            for px in row[..w * 4].chunks_exact(4) {
                rgb.extend_from_slice(&[px[2], px[1], px[0]]);
            }
        }
        context.Unmap(&staging, 0);
        Ok((rgb, w, h))
    }
}
