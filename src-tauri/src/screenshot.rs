// An image on the clipboard, for the island's preview: a screenshot taken with
// Win+Shift+S or Print Screen, or an image copied anywhere. Windows tells us when the
// clipboard changes (AddClipboardFormatListener on a message-only window), so nothing
// polls. The island gets a small copy to show (`screenshot`) and the full image is
// kept as a file it can open (`open_screenshot`), show larger (`screenshot_view`) or
// save as a PNG (`save_screenshot`). Copied text goes on to copied.rs. Linux has no
// preview yet.

use std::path::PathBuf;
use std::sync::Mutex;

/// The newest images, kept in the temp folder for the island to open.
const KEEP: usize = 5;
/// The viewer's copy at most: its largest picture at 2x.
const VIEW_W: usize = 980;
const VIEW_H: usize = 552;

/// The image saved last, so "Show in folder" never takes a path from the page.
static SAVED: Mutex<Option<PathBuf>> = Mutex::new(None);

#[cfg(windows)]
pub use imp::start;

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle) {}

fn folder() -> std::path::PathBuf {
    std::env::temp_dir().join("puhu-screenshots")
}

/// Only a plain file name, of a file in that folder.
fn kept(name: &str) -> Option<PathBuf> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return None;
    }
    Some(folder().join(name)).filter(|path| path.is_file())
}

/// Opens one of the kept images in the default viewer; only a file of that folder.
#[tauri::command]
pub fn open_screenshot(name: String) {
    if let Some(path) = kept(&name) {
        crate::platform::reveal_folder(&path.to_string_lossy());
    }
}

/// One of the kept images (our own BMPs: the file header, then a DIB), top-down RGB.
fn read_kept(name: &str) -> Option<(Vec<u8>, usize, usize)> {
    let bytes = std::fs::read(kept(name)?).ok()?;
    dib_to_rgb(bytes.get(14..)?)
}

/// A larger copy of one of the kept images for the island's viewer, as a PNG data URL.
#[tauri::command]
pub async fn screenshot_view(name: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (rgb, w, h) = read_kept(&name)?;
        let (small, sw, sh) = shrink(&rgb, w, h, VIEW_W, VIEW_H);
        let png = png(&small, sw, sh, png::Compression::Fast)?;
        Some(format!("data:image/png;base64,{}", base64(&png)))
    })
    .await
    .ok()
    .flatten()
}

/// Where Windows keeps its own screenshots (Win+Print Screen): the Screenshots known
/// folder, wherever the user's Pictures went (OneDrive, another name, another drive).
#[cfg(windows)]
fn screenshots_dir() -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Screenshots, SHGetKnownFolderPath, KF_FLAG_CREATE};
    unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_Screenshots, KF_FLAG_CREATE, None).ok()?;
        let dir = path.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(path.0 as _));
        dir
    }
}

#[cfg(not(windows))]
fn screenshots_dir() -> Option<PathBuf> {
    None
}

/// Saves one of the kept images as a PNG where Windows keeps its own screenshots,
/// or in the first pictures folder there is, named as Windows names them: `label`
/// (the page's "Screenshot", in the user's language) and the time.
#[tauri::command]
pub async fn save_screenshot(name: String, label: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let (rgb, w, h) = read_kept(&name)?;
        let png = png(&rgb, w, h, png::Compression::Balanced)?;
        let dir = screenshots_dir().or_else(|| crate::platform::picture_dirs().into_iter().find(|d| d.is_dir()))?;
        std::fs::create_dir_all(&dir).ok()?;
        let t = crate::platform::local_time();
        let label: String = label.chars().filter(|c| !c.is_control() && !r#"<>:"/\|?*"#.contains(*c)).take(40).collect();
        let label = if label.trim().is_empty() { "Screenshot" } else { label.trim() };
        let stem = format!("{label} {}-{:02}-{:02} {:02}{:02}{:02}", t.year, t.month, t.day, t.hour, t.minute, t.second);
        let path = crate::recap::write_unique(&dir, &stem, "png", &png).ok()?;
        *SAVED.lock().unwrap_or_else(|e| e.into_inner()) = Some(path);
        Some(())
    })
    .await
    .ok()
    .flatten()
    .is_some()
}

/// Opens the folder of the image saved last.
#[tauri::command]
pub fn reveal_saved_screenshot() {
    let dir = SAVED.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|p| p.parent().map(PathBuf::from));
    if let Some(dir) = dir {
        crate::platform::reveal_folder(&dir.to_string_lossy());
    }
}

/// Top-down RGB as a PNG.
pub(crate) fn png(rgb: &[u8], w: usize, h: usize, compression: png::Compression) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, w as u32, h as u32);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(compression);
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(rgb).ok()?;
    writer.finish().ok()?;
    Some(out)
}

/// A 24-bit BMP of `w`×`h` pixels from top-down RGB rows.
fn bmp(rgb: &[u8], w: usize, h: usize) -> Vec<u8> {
    let row = (w * 3 + 3) & !3;
    let size = 54 + row * h;
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&54u32.to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(w as i32).to_le_bytes());
    out.extend_from_slice(&(h as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&[0; 24]);
    for y in (0..h).rev() {
        for x in 0..w {
            let p = (y * w + x) * 3;
            out.extend_from_slice(&[rgb[p + 2], rgb[p + 1], rgb[p]]);
        }
        out.extend(std::iter::repeat_n(0, row - w * 3));
    }
    out
}

/// `src` (top-down RGB, `w`×`h`) shrunk to fit in `max_w`×`max_h`, each pixel the
/// average of the ones it covers.
pub(crate) fn shrink(src: &[u8], w: usize, h: usize, max_w: usize, max_h: usize) -> (Vec<u8>, usize, usize) {
    let scale = (max_w as f64 / w as f64).min(max_h as f64 / h as f64).min(1.0);
    let (tw, th) = (((w as f64 * scale).round() as usize).max(1), ((h as f64 * scale).round() as usize).max(1));
    let mut out = vec![0u8; tw * th * 3];
    for ty in 0..th {
        let (y0, y1) = (ty * h / th, ((ty + 1) * h / th).max(ty * h / th + 1));
        for tx in 0..tw {
            let (x0, x1) = (tx * w / tw, ((tx + 1) * w / tw).max(tx * w / tw + 1));
            let mut sum = [0u32; 3];
            let mut n = 0u32;
            // At most 4×4 samples a pixel: plenty for a preview, cheap for a 4K screen.
            let (sy, sx) = (((y1 - y0) / 4).max(1), ((x1 - x0) / 4).max(1));
            for y in (y0..y1).step_by(sy) {
                for x in (x0..x1).step_by(sx) {
                    let p = (y * w + x) * 3;
                    sum[0] += src[p] as u32;
                    sum[1] += src[p + 1] as u32;
                    sum[2] += src[p + 2] as u32;
                    n += 1;
                }
            }
            let q = (ty * tw + tx) * 3;
            for c in 0..3 {
                out[q + c] = (sum[c] / n.max(1)) as u8;
            }
        }
    }
    (out, tw, th)
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(T[(n >> (18 - 6 * i)) as usize & 63] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A CF_DIB (BITMAPINFOHEADER, maybe its three masks, the rows) → top-down RGB.
fn dib_to_rgb(dib: &[u8]) -> Option<(Vec<u8>, usize, usize)> {
    let u32_at = |i: usize| dib.get(i..i + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    let header = u32_at(0)? as usize;
    let w = u32_at(4)? as i32;
    let h = u32_at(8)? as i32;
    let bits = u16::from_le_bytes([*dib.get(14)?, *dib.get(15)?]) as usize;
    let compression = u32_at(16)?;
    if w <= 0 || h == 0 || !(bits == 24 || bits == 32) || !(compression == 0 || compression == 3) {
        return None;
    }
    let (w, top_down, h) = (w as usize, h < 0, h.unsigned_abs() as usize);
    let masks = if compression == 3 && header == 40 { 12 } else { 0 };
    let start = header + masks;
    let row = (w * bits / 8 + 3) & !3;
    if dib.len() < start + row * h {
        return None;
    }
    let mut rgb = vec![0u8; w * h * 3];
    for y in 0..h {
        let src_y = if top_down { y } else { h - 1 - y };
        let line = &dib[start + src_y * row..];
        for x in 0..w {
            let p = x * bits / 8;
            let q = (y * w + x) * 3;
            rgb[q] = line[p + 2];
            rgb[q + 1] = line[p + 1];
            rgb[q + 2] = line[p];
        }
    }
    Some((rgb, w, h))
}

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Foundation::{HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::DataExchange::{
        AddClipboardFormatListener, CloseClipboard, GetClipboardData, GetClipboardSequenceNumber,
        IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::{CF_DIB, CF_UNICODETEXT};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, HWND_MESSAGE, MSG,
        WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLIPBOARDUPDATE, WNDCLASSW,
    };

    use crate::island::WINDOW_LABEL;

    #[derive(Serialize, Clone)]
    struct Shot {
        /// A small copy, as a data URL.
        thumb: String,
        width: usize,
        height: usize,
        /// The kept file's name, for `open_screenshot`.
        name: String,
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static mut LAST_SEQUENCE: u32 = 0;
    /// A fingerprint of the last image: copying one picture can change the clipboard twice.
    static mut LAST_IMAGE: u64 = 0;

    unsafe fn copy_dib(hwnd: HWND) -> Option<Vec<u8>> {
        // Another program may hold the clipboard for a moment.
        let mut opened = false;
        for _ in 0..5 {
            if unsafe { OpenClipboard(Some(hwnd)) }.is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if !opened {
            return None;
        }
        let bytes = unsafe { GetClipboardData(CF_DIB.0 as u32) }.ok().and_then(|handle| {
            let global = HGLOBAL(handle.0);
            let ptr = unsafe { GlobalLock(global) } as *const u8;
            if ptr.is_null() {
                return None;
            }
            let size = unsafe { GlobalSize(global) };
            let out = unsafe { std::slice::from_raw_parts(ptr, size) }.to_vec();
            let _ = unsafe { GlobalUnlock(global) };
            Some(out)
        });
        let _ = unsafe { CloseClipboard() };
        bytes
    }

    unsafe fn changed(hwnd: HWND) {
        let sequence = unsafe { GetClipboardSequenceNumber() };
        if sequence == unsafe { LAST_SEQUENCE } {
            return;
        }
        if unsafe { IsClipboardFormatAvailable(CF_DIB.0 as u32) }.is_err() {
            // Not a picture: text gets its own peek (copied.rs).
            if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32) }.is_ok() {
                unsafe { LAST_SEQUENCE = sequence };
                if let Some(app) = APP.get() {
                    unsafe { crate::copied::changed(hwnd, app) };
                }
            }
            return;
        }
        unsafe { LAST_SEQUENCE = sequence };
        let Some(dib) = (unsafe { copy_dib(hwnd) }) else { return };
        let print = dib.len() as u64 ^ dib.iter().step_by(97).fold(0u64, |h, &b| h.wrapping_mul(31).wrapping_add(b as u64));
        if print == unsafe { LAST_IMAGE } {
            return;
        }
        unsafe { LAST_IMAGE = print };
        let Some((rgb, w, h)) = super::dib_to_rgb(&dib) else { return };
        let (small, tw, th) = super::shrink(&rgb, w, h, 520, 292);
        let thumb = format!("data:image/bmp;base64,{}", super::base64(&super::bmp(&small, tw, th)));
        // The whole image, kept for opening; only the newest few stay.
        let dir = super::folder();
        let _ = std::fs::create_dir_all(&dir);
        let name = format!("image-{sequence}.bmp");
        if std::fs::write(dir.join(&name), super::bmp(&rgb, w, h)).is_err() {
            return;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let mut files: Vec<_> = entries.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
            files.sort_by(|a, b| b.0.cmp(&a.0));
            for (_, old) in files.into_iter().skip(super::KEEP) {
                let _ = std::fs::remove_file(old);
            }
        }
        if crate::platform::presenting() {
            return;
        }
        if let Some(app) = APP.get() {
            let _ = app.emit_to(WINDOW_LABEL, "screenshot", Shot { thumb, width: w, height: h, name });
        }
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_CLIPBOARDUPDATE {
            unsafe { changed(hwnd) };
            return LRESULT(0);
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    pub fn start(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        // A thread that only waits: for the clipboard to change.
        let _ = std::thread::Builder::new().name("puhu-clipboard".into()).spawn(|| unsafe {
            let class = w!("PuhuClipboardWatch");
            let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), lpszClassName: class, ..Default::default() };
            RegisterClassW(&wc);
            let Ok(hwnd) = CreateWindowExW(WINDOW_EX_STYLE(0), class, w!(""), WINDOW_STYLE(0), 0, 0, 0, 0, Some(HWND_MESSAGE), None, None, None) else {
                return;
            };
            LAST_SEQUENCE = GetClipboardSequenceNumber();
            if AddClipboardFormatListener(hwnd).is_err() {
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                DispatchMessageW(&msg);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn a_kept_bmp_reads_back_as_it_was_written() {
        let rgb: Vec<u8> = (0..5 * 3 * 3).map(|i| (i * 7) as u8).collect();
        let file = bmp(&rgb, 5, 3);
        assert_eq!(dib_to_rgb(&file[14..]), Some((rgb, 5, 3)));
    }

    #[test]
    fn a_bottom_up_dib_reads_top_down_and_shrinks() {
        // 2×2, 24 bits, bottom-up: the first row in memory is the bottom one.
        let mut dib = vec![0u8; 40];
        dib[0] = 40;
        dib[4] = 2;
        dib[8] = 2;
        dib[12] = 1;
        dib[14] = 24;
        // bottom row: blue, green (BGR) + 2 bytes padding; top row: red, white + padding.
        dib.extend_from_slice(&[255, 0, 0, 0, 255, 0, 0, 0]);
        dib.extend_from_slice(&[0, 0, 255, 255, 255, 255, 0, 0]);
        let (rgb, w, h) = dib_to_rgb(&dib).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(&rgb[0..3], &[255, 0, 0]); // top-left red
        assert_eq!(&rgb[6..9], &[0, 0, 255]); // bottom-left blue
        let (small, tw, th) = shrink(&rgb, 2, 2, 1, 1);
        assert_eq!((tw, th), (1, 1));
        assert_eq!(small.len(), 3);
        let file = bmp(&rgb, 2, 2);
        assert_eq!(&file[0..2], b"BM");
        assert_eq!(file.len(), 54 + 8 * 2);
    }
}
