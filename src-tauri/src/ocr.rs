// Text from a picture: Copy text in the screenshot viewer. Windows' own recognizer
// (Windows.Media.Ocr) reads it on this computer, in the languages the user has added to
// Windows; nothing goes over the network and nothing is kept. Only a click asks: a
// picture is never read on its own. The words go back to the island, which puts them on
// the clipboard and lights them over the picture.

use serde::Serialize;

/// The errors the island words itself: Windows has no recognizer for any of the user's
/// languages; the kept picture has gone (a quarter of an hour, screenshot.rs).
pub const NO_LANGUAGE: &str = "no-language";
const GONE: &str = "gone";
/// The longest side read: larger pictures are made smaller first (Windows reads up to 10000).
const MAX_SIDE: usize = 4096;

/// A word and where it is, as fractions of the picture's width and height.
#[derive(Serialize)]
pub struct Word {
    text: String,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

/// A line as Windows read it: its text (spaced as the language spaces words) and its words.
#[derive(Serialize)]
pub struct Line {
    text: String,
    words: Vec<Word>,
}

/// The text in one of the screenshot viewer's kept pictures, line by line; none: no text.
/// Err(NO_LANGUAGE) when Windows reads none of the user's languages.
#[tauri::command]
pub async fn screenshot_text(name: String) -> Result<Vec<Line>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (rgb, w, h) = crate::screenshot::read_kept(&name).ok_or_else(|| GONE.to_string())?;
        let (rgb, w, h) = if w.max(h) > MAX_SIDE { crate::screenshot::shrink(&rgb, w, h, MAX_SIDE, MAX_SIDE) } else { (rgb, w, h) };
        let mut bgra = Vec::with_capacity(w * h * 4);
        for p in rgb.chunks_exact(3) {
            bgra.extend_from_slice(&[p[2], p[1], p[0], 255]);
        }
        imp::read(&bgra, w, h)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod imp {
    use super::{Line, Word, NO_LANGUAGE};
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    pub fn read(bgra: &[u8], w: usize, h: usize) -> Result<Vec<Line>, String> {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        }
        // In the first of the user's languages Windows can read; none, nothing to read with.
        let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| NO_LANGUAGE.to_string())?;
        let lines = (|| -> windows::core::Result<Vec<Line>> {
            let writer = DataWriter::new()?;
            writer.WriteBytes(bgra)?;
            let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&writer.DetachBuffer()?, BitmapPixelFormat::Bgra8, w as i32, h as i32)?;
            let result = engine.RecognizeAsync(&bitmap)?.get()?;
            let (fw, fh) = (w as f32, h as f32);
            let mut lines = Vec::new();
            for line in result.Lines()? {
                let mut words = Vec::new();
                for word in line.Words()? {
                    let r = word.BoundingRect()?;
                    words.push(Word { text: word.Text()?.to_string(), x: r.X / fw, y: r.Y / fh, w: r.Width / fw, h: r.Height / fh });
                }
                lines.push(Line { text: line.Text()?.to_string(), words });
            }
            Ok(lines)
        })();
        lines.map_err(|e| e.message())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Line;

    pub fn read(_: &[u8], _: usize, _: usize) -> Result<Vec<Line>, String> {
        Err(super::NO_LANGUAGE.into())
    }
}
