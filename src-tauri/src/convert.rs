// Files dropped on the island, made into what they are wanted as: photos into one PDF,
// a photo smaller or a JPG, a Word document or plain text into a PDF. All of it runs on
// this computer; nothing is uploaded. The new file goes beside the first one dropped (into
// Downloads when that folder can't be written to), never over a file already there.
//
// Only paths a real drop delivered are taken (files::may_convert), and only files made
// here can be copied, shown or opened afterwards: the page never names any other path.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

/// Photos go into a PDF at most this many pixels on their long side (A4 at 300 dpi).
const PDF_SIDE: u32 = 2480;
const PDF_QUALITY: f32 = 0.85;
/// "Smaller": this long side, this JPEG quality.
const SMALL_SIDE: u32 = 1920;
const SMALL_QUALITY: f32 = 0.78;
const JPG_QUALITY: f32 = 0.92;
/// A4 in points, and the white round a photo on it.
const A4: (f32, f32) = (595.28, 841.89);
const MARGIN: f32 = 24.0;
/// A document read for the page to turn into HTML: no bigger than this.
const MAX_READ: u64 = 50 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Converted {
    pub path: String,
    pub name: String,
    /// Bytes, of the new file and of what it was made from.
    pub size: u64,
    pub before: u64,
    /// Pages of a PDF; 0 for a picture.
    pub pages: u32,
}

/// Files made here, the only ones the page may copy, show or open afterwards.
static MADE: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Made here (the downloads indicator stays quiet about them).
pub fn is_made(path: &Path) -> bool {
    MADE.lock().unwrap().iter().any(|p| p == path)
}

fn granted(path: &str) -> Result<PathBuf, String> {
    if !crate::files::may_convert(path) {
        return Err(crate::i18n::t("Only files dropped on the island can be added."));
    }
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err(crate::i18n::tf("Cannot read {path}: {error}", &[("path", path), ("error", "not a file")]));
    }
    Ok(p)
}

fn made(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path);
    is_made(&p).then_some(p)
}

/// A name free beside `first` (or in Downloads), "stem.ext" then "stem (2).ext"…, created
/// empty at once so nothing else takes it meanwhile.
fn new_file(first: &Path, stem: &str, ext: &str) -> Result<PathBuf, String> {
    let mut dirs = Vec::new();
    if let Some(dir) = first.parent() {
        dirs.push(dir.to_path_buf());
    }
    #[cfg(windows)]
    if let Some(dir) = crate::downloads::downloads_dir() {
        dirs.push(dir);
    }
    for dir in dirs {
        for i in 1..1000 {
            let name = if i == 1 { format!("{stem}.{ext}") } else { format!("{stem} ({i}).{ext}") };
            let path = dir.join(name);
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(_) => {
                    MADE.lock().unwrap().push(path.clone());
                    return Ok(path);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => break,
            }
        }
    }
    Err(crate::i18n::t("There is no folder to put it in."))
}

/// Writes the made file, or takes its empty placeholder back on a failure.
fn finish(path: &Path, bytes: &[u8], before: u64, pages: u32) -> Result<Converted, String> {
    if let Err(e) = std::fs::write(path, bytes) {
        let _ = std::fs::remove_file(path);
        return Err(e.to_string());
    }
    Ok(Converted {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        size: bytes.len() as u64,
        before,
        pages,
    })
}

fn stem(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Puhu".into())
}

fn size_of(paths: &[PathBuf]) -> u64 {
    paths.iter().filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Photos, in the order dropped, as one PDF: a page each, A4, turned to fit.
#[tauri::command]
pub async fn convert_images_pdf(paths: Vec<String>) -> Result<Converted, String> {
    blocking(move || {
        let sources = paths.iter().map(|p| granted(p)).collect::<Result<Vec<_>, _>>()?;
        let first = sources.first().ok_or_else(|| crate::i18n::t("There is nothing to make."))?;
        let mut pictures = Vec::new();
        for source in &sources {
            pictures.push(image::to_jpeg(source, PDF_SIDE, PDF_QUALITY)?);
        }
        let pdf = pdf_of_pictures(&pictures)?;
        let out = new_file(first, &stem(first), "pdf")?;
        finish(&out, &pdf, size_of(&sources), pictures.len() as u32)
    })
    .await
}

/// One photo as a JPG: `to` "small" (smaller to send) or "jpg" (the same size, as a JPG).
#[tauri::command]
pub async fn convert_image(path: String, to: String) -> Result<Converted, String> {
    blocking(move || {
        let source = granted(&path)?;
        let before = size_of(std::slice::from_ref(&source));
        let small = to == "small";
        let (bytes, _, _) = if small {
            image::to_jpeg(&source, SMALL_SIDE, SMALL_QUALITY)?
        } else {
            image::to_jpeg(&source, 0, JPG_QUALITY)?
        };
        if small && bytes.len() as u64 >= before {
            return Err(crate::i18n::t("It is already about as small as it gets."));
        }
        let name = if small { crate::i18n::tf("{name} (small)", &[("name", &stem(&source))]) } else { stem(&source) };
        let out = new_file(&source, &name, "jpg")?;
        finish(&out, &bytes, before, 0)
    })
    .await
}

/// A dropped document's bytes, for the page to turn into HTML (src/core/docx.ts).
#[tauri::command]
pub async fn convert_read(path: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || {
        let source = granted(&path)?;
        if std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0) > MAX_READ {
            return Err(crate::i18n::t("This file is too big to ask about (over 50 MB)."));
        }
        std::fs::read(&source).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
    })
    .await
}

/// The page's HTML for a dropped document, printed to a PDF beside it by Microsoft Edge,
/// with nothing loaded from anywhere and no script run. One print at a time (they share
/// Edge's profile folder).
#[tauri::command]
pub async fn convert_html_pdf(source: String, html: String) -> Result<Converted, String> {
    blocking(move || {
        let source = granted(&source)?;
        let before = size_of(std::slice::from_ref(&source));
        let out = new_file(&source, &stem(&source), "pdf")?;
        match print_pdf(&html, &out) {
            Ok(pages) => {
                let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
                Ok(Converted {
                    path: out.to_string_lossy().into_owned(),
                    name: out.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                    size,
                    before,
                    pages,
                })
            }
            Err(e) => {
                let _ = std::fs::remove_file(&out);
                Err(e)
            }
        }
    })
    .await
}

/// A made file on the clipboard as a file: Ctrl+V puts it in a chat, a mail, a folder.
#[tauri::command]
pub fn made_copy(app: tauri::AppHandle, path: String) -> bool {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Some(win) = app.get_webview_window(crate::island::WINDOW_LABEL) else { return false };
        made(&path).is_some_and(|p| crate::platform::copy_file_to_clipboard(&win, &p))
    }
    #[cfg(not(windows))]
    {
        let _ = (app, path);
        false
    }
}

/// A made file, selected in its folder.
#[tauri::command]
pub fn made_reveal(path: String) {
    if let Some(p) = made(&path) {
        #[cfg(windows)]
        crate::platform::reveal_file(&p);
        #[cfg(not(windows))]
        crate::platform::reveal_folder(&p.parent().unwrap_or(&p).to_string_lossy());
    }
}

/// A made file, opened in the app it belongs to.
#[tauri::command]
pub fn made_open(path: String) {
    if let Some(p) = made(&path) {
        crate::platform::reveal_folder(&p.to_string_lossy());
    }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/// JPEGs as the pages of a PDF, each on A4 (turned for a wide one) inside a white margin.
fn pdf_of_pictures(pictures: &[(Vec<u8>, u32, u32)]) -> Result<Vec<u8>, String> {
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Document, Object, Stream};

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids: Vec<Object> = Vec::new();
    for (jpeg, w, h) in pictures {
        let (pw, ph) = if w > h { (A4.1, A4.0) } else { A4 };
        let scale = ((pw - 2.0 * MARGIN) / *w as f32).min((ph - 2.0 * MARGIN) / *h as f32);
        let (dw, dh) = (*w as f32 * scale, *h as f32 * scale);
        let (x, y) = ((pw - dw) / 2.0, (ph - dh) / 2.0);
        let mut image = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => *w as i64,
                "Height" => *h as i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            },
            jpeg.clone(),
        );
        image.allows_compression = false;
        let image_id = doc.add_object(image);
        let content = Content {
            operations: vec![
                Operation::new("q", vec![]),
                Operation::new("cm", vec![dw.into(), 0.into(), 0.into(), dh.into(), x.into(), y.into()]),
                Operation::new("Do", vec!["Im0".into()]),
                Operation::new("Q", vec![]),
            ],
        };
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().map_err(|e| e.to_string())?));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), pw.into(), ph.into()],
            "Contents" => content_id,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => image_id } },
        });
        kids.push(page_id.into());
    }
    let count = kids.len() as i64;
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => count }));
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Prints `body` (a document's HTML, its own <style> included) to `out` with Edge, headless;
/// the number of pages it made.
/// What core/docx.ts never writes: anything that could take the page elsewhere or pull in
/// something from outside (a refresh to a local file would print that file instead).
const NOT_IN_A_DOCUMENT: &[&str] = &["<meta", "<base", "<link", "<iframe", "<frame", "<object", "<embed", "<script", "<svg"];

fn print_pdf(body: &str, out: &Path) -> Result<u32, String> {
    let lower = body.to_lowercase();
    if NOT_IN_A_DOCUMENT.iter().any(|tag| lower.contains(tag)) {
        return Err(crate::i18n::t("The PDF could not be made."));
    }
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    let edge = edge().ok_or_else(|| crate::i18n::t("Microsoft Edge is needed to make this PDF."))?;
    let dir = std::env::temp_dir().join("puhu-pdf");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let page = dir.join(format!("{}-{n}.html", std::process::id()));
    // Nothing from outside the page itself: no files, no network, no script.
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" \
         content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:\"></head><body>{body}</body></html>"
    );
    std::fs::write(&page, html).map_err(|e| e.to_string())?;
    let url = format!("file:///{}", page.to_string_lossy().replace('\\', "/"));
    let mut cmd = std::process::Command::new(edge);
    cmd.args([
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        // No --blink-settings=scriptEnabled=false: Edge then prints nothing. The page's
        // own policy (above) runs no script anyway.
        "--no-pdf-header-footer",
        "--print-to-pdf-no-header",
    ])
    .arg(format!("--user-data-dir={}", dir.join("profile").display()))
    .arg(format!("--print-to-pdf={}", out.display()))
    .arg(url);
    #[cfg(windows)]
    crate::platform::no_console(&mut cmd);
    let status = run_for(cmd, std::time::Duration::from_secs(90));
    let _ = std::fs::remove_file(&page);
    status?;
    let doc = lopdf::Document::load(out).map_err(|_| crate::i18n::t("The PDF could not be made."))?;
    Ok(doc.get_pages().len() as u32)
}

/// Runs `cmd` to its end, or kills it after `limit`. Its end is when its output closes:
/// Edge's first process may hand the work to others, which keep that pipe open until done.
fn run_for(mut cmd: std::process::Command, limit: std::time::Duration) -> Result<(), String> {
    use std::io::Read;
    use std::process::Stdio;
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let (out, err) = (child.stdout.take(), child.stderr.take());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut sink = Vec::new();
        if let Some(mut out) = out {
            let _ = out.read_to_end(&mut sink);
        }
        let _ = tx.send(());
    });
    std::thread::spawn(move || {
        if let Some(mut err) = err {
            let _ = std::io::copy(&mut err, &mut std::io::sink());
        }
    });
    let finished = rx.recv_timeout(limit).is_ok();
    if !finished {
        let _ = child.kill();
    }
    let _ = child.wait();
    if finished { Ok(()) } else { Err(crate::i18n::t("The PDF could not be made.")) }
}

fn edge() -> Option<PathBuf> {
    ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]
        .iter()
        .filter_map(|var| std::env::var_os(var))
        .map(|base| PathBuf::from(base).join("Microsoft").join("Edge").join("Application").join("msedge.exe"))
        .find(|p| p.is_file())
}

// ── Pictures (Windows Imaging, through WinRT) ────────────────────────────────

#[cfg(windows)]
mod image {
    use std::path::Path;

    use windows::core::HSTRING;
    use windows::Foundation::{PropertyType, PropertyValue};
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapEncoder, BitmapInterpolationMode, BitmapPixelFormat, BitmapPropertySet,
        BitmapTransform, BitmapTypedValue, ColorManagementMode, ExifOrientationMode,
    };
    use windows::Storage::Streams::{DataReader, DataWriter, InMemoryRandomAccessStream};

    fn com() {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        }
    }

    /// `path` decoded as the camera meant it (turned by its EXIF), no larger than `side` on
    /// its long side (0: as it is), transparency on white, encoded as a JPEG: (bytes, w, h).
    pub fn to_jpeg(path: &Path, side: u32, quality: f32) -> Result<(Vec<u8>, u32, u32), String> {
        com();
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let unreadable = || crate::i18n::tf("{name} could not be opened as a picture.", &[("name", &name)]);
        let (mut rgba, w, h) = decode(&bytes, side).map_err(|_| unreadable())?;
        for px in rgba.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a < 255 {
                for c in &mut px[..3] {
                    *c = ((*c as u32 * a + 255 * (255 - a)) / 255) as u8;
                }
                px[3] = 255;
            }
        }
        let jpeg = encode(&rgba, w, h, quality).map_err(|e| e.to_string())?;
        Ok((jpeg, w, h))
    }

    fn decode(bytes: &[u8], side: u32) -> windows::core::Result<(Vec<u8>, u32, u32)> {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(bytes)?;
        writer.StoreAsync()?.get()?;
        writer.FlushAsync()?.get()?;
        writer.DetachStream()?;
        stream.Seek(0)?;
        let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
        // The scale is of the picture as stored; its EXIF turn comes after it.
        let (pw, ph) = (decoder.PixelWidth()?, decoder.PixelHeight()?);
        let turned = decoder.OrientedPixelWidth()? != pw;
        let scale = if side > 0 { (side as f64 / pw.max(ph) as f64).min(1.0) } else { 1.0 };
        let (sw, sh) = (((pw as f64 * scale).round() as u32).max(1), ((ph as f64 * scale).round() as u32).max(1));
        let transform = BitmapTransform::new()?;
        transform.SetScaledWidth(sw)?;
        transform.SetScaledHeight(sh)?;
        transform.SetInterpolationMode(BitmapInterpolationMode::Fant)?;
        let pixels = decoder
            .GetPixelDataTransformedAsync(
                BitmapPixelFormat::Rgba8,
                BitmapAlphaMode::Straight,
                &transform,
                ExifOrientationMode::RespectExifOrientation,
                ColorManagementMode::ColorManageToSRgb,
            )?
            .get()?
            .DetachPixelData()?;
        let (w, h) = if turned { (sh, sw) } else { (sw, sh) };
        Ok((pixels.to_vec(), w, h))
    }

    fn encode(rgba: &[u8], w: u32, h: u32, quality: f32) -> windows::core::Result<Vec<u8>> {
        let out = InMemoryRandomAccessStream::new()?;
        let options = BitmapPropertySet::new()?;
        let q = BitmapTypedValue::Create(&PropertyValue::CreateSingle(quality)?, PropertyType::Single)?;
        options.Insert(&HSTRING::from("ImageQuality"), &q)?;
        let encoder = BitmapEncoder::CreateWithEncodingOptionsAsync(BitmapEncoder::JpegEncoderId()?, &out, &options)?.get()?;
        encoder.SetPixelData(BitmapPixelFormat::Rgba8, BitmapAlphaMode::Ignore, w, h, 96.0, 96.0, rgba)?;
        encoder.FlushAsync()?.get()?;
        let size = out.Size()? as u32;
        out.Seek(0)?;
        let reader = DataReader::CreateDataReader(&out)?;
        reader.LoadAsync(size)?.get()?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(bytes)
    }
}

#[cfg(not(windows))]
mod image {
    pub fn to_jpeg(_: &std::path::Path, _: u32, _: f32) -> Result<(Vec<u8>, u32, u32), String> {
        Err("Not on this system yet.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_file_never_takes_a_name_already_there() {
        let dir = std::env::temp_dir().join(format!("puhu-convert-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = dir.join("photo.png");
        std::fs::write(&first, b"x").unwrap();
        let a = new_file(&first, "photo", "pdf").unwrap();
        let b = new_file(&first, "photo", "pdf").unwrap();
        assert_eq!(a.file_name().unwrap(), "photo.pdf");
        assert_eq!(b.file_name().unwrap(), "photo (2).pdf");
        assert!(is_made(&a) && is_made(&b));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn pictures_make_one_page_each() {
        // Not a real JPEG: the page is built around the bytes, which is all this checks.
        let pdf = pdf_of_pictures(&[(vec![0xFF, 0xD8, 0xFF, 0xD9], 400, 300), (vec![0xFF, 0xD8, 0xFF, 0xD9], 300, 400)]).unwrap();
        let doc = lopdf::Document::load_mem(&pdf).unwrap();
        assert_eq!(doc.get_pages().len(), 2);
    }

    #[test]
    fn nothing_but_dropped_files_is_taken() {
        assert!(granted("C:/Windows/win.ini").is_err());
    }
}
