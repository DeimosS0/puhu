// Send to phone, and from it: a file goes from this computer to a phone, or from a phone
// to this computer, through the phone's own browser on the same network. The design, the
// wire protocol and the threat model are docs/send-to-phone.md, the source of truth for
// what follows: a session only the user starts, a listener on this computer's network
// address that lives as long as the session (10 minutes at most), a link claimed by the
// first phone that opens it, and every piece sealed end to end with a key that travels
// in the QR code, from the screen to the phone's camera, never over the network.
//
// Work (Domain) networks are refused; a Public one only once the user said it is theirs
// (Windows 11 files every new network as Public, a home Wi-Fi and a phone's hotspot
// included). Nothing is kept: files sent are read where they are, files received land
// in Downloads with Windows' "came from the internet" mark and are never opened here.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::i18n::{n_, t};
use crate::island::WINDOW_LABEL;

/// How long a session lives at most.
const SESSION: Duration = Duration::from_secs(10 * 60);
/// A piece of a file, before sealing; sealed it carries its 16-byte tag after it.
pub const PIECE: usize = 1 << 20;
const TAG: usize = 16;
/// A file, either way, and how many files a session takes from the phone.
pub const MAX_FILE: u64 = 500 * 1024 * 1024;
pub const MAX_FILES: u32 = 20;
/// Wrong requests from one address before it is shut out (the session goes on).
const MAX_STRIKES: u32 = 20;
/// Connections at once: in all, and from one address.
const MAX_CONNECTIONS: usize = 16;
const MAX_PER_ADDRESS: usize = 4;
const LINE_MAX: usize = 8 * 1024;
const HEAD_MAX: usize = 16 * 1024;
const DESCRIPTION_MAX: usize = 4 * 1024;
const HEAD_TIME: Duration = Duration::from_secs(10);
const BODY_TIME: Duration = Duration::from_secs(60);
/// The file number of the list of files sent; the piece number of a file's description.
const WHOLE: u32 = u32::MAX;
/// Where a file from the phone is written before it is whole, in Puhu's private folder.
const INCOMING: &str = "incoming";

/// What the island hears about the session (event "phone").
pub const EVENT: &str = "phone";

/// The page the phone runs, built from src/phone-page (scripts/phone-page.mjs).
const PAGE_HTML: &str = include_str!("../phone/page.html");
const PAGE_JS: &str = include_str!("../phone/page.js");
const PAGE_CSS: &str = include_str!("../phone/page.css");

/// The page's words, by the ids src/phone-page reads: in Puhu's language.
const PAGE_WORDS: &[(&str, &str)] = &[
    ("sendHeading", n_("Files from your computer")),
    ("receiveHeading", n_("Send to your computer")),
    ("download", n_("Download")),
    ("saved", n_("Saved")),
    ("choose", n_("Choose files")),
    ("sending", n_("Sending…")),
    ("sent", n_("Sent")),
    ("tooBig", n_("Too big: 500 MB at most.")),
    ("tooMany", n_("20 files at most.")),
    ("otherPhone", n_("This link was opened on another phone.")),
    ("ended", n_("This link has ended. Scan a new code on your computer.")),
    ("failed", n_("Something went wrong. Try again.")),
    ("noKey", n_("Open this page by scanning the code on your computer.")),
    ("allSaved", n_("All saved. You can close this page.")),
];

// ── The session ───────────────────────────────────────────────────────────────

enum Mode {
    Send(Vec<Outgoing>),
    Receive,
}

struct Outgoing {
    path: PathBuf,
    name: String,
    size: u64,
}

struct Incoming {
    name: String,
    size: u64,
    pieces: u32,
    next: u32,
    staging: PathBuf,
    file: std::fs::File,
}

#[derive(Default)]
struct Progress {
    /// The phone's cookie, once one phone has claimed the link.
    cookie: Option<String>,
    /// Wrong requests, and connections open, by address.
    strikes: HashMap<IpAddr, u32>,
    open: HashMap<IpAddr, usize>,
    /// Bytes sent of each file (Send).
    served: Vec<u64>,
    /// Files being received, by the phone's number (Receive).
    incoming: HashMap<u32, Incoming>,
    /// The next number the phone may begin.
    next_file: u32,
    /// Files from the phone already whole: a retried last piece is answered, not added.
    finished: Vec<u32>,
}

struct Session {
    token: String,
    key: LessSafeKey,
    mode: Mode,
    progress: Mutex<Progress>,
    stop: tokio::sync::watch::Sender<bool>,
    app: AppHandle,
}

static CURRENT: Mutex<Option<Arc<Session>>> = Mutex::new(None);

fn current() -> Option<Arc<Session>> {
    CURRENT.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

/// The session ends: its listener stops, a half-received file goes, the island is told.
fn end(session: &Arc<Session>, reason: &str) {
    {
        let mut slot = CURRENT.lock().unwrap_or_else(PoisonError::into_inner);
        if slot.as_ref().is_some_and(|s| Arc::ptr_eq(s, session)) {
            *slot = None;
        } else {
            return;
        }
    }
    let _ = session.stop.send(true);
    let mut progress = session.progress.lock().unwrap_or_else(PoisonError::into_inner);
    for (_, incoming) in progress.incoming.drain() {
        drop(incoming.file);
        let _ = std::fs::remove_file(&incoming.staging);
    }
    drop(progress);
    crate::log::line(format!("send to phone: {reason}"));
    tell(&session.app, json!({ "state": "ended", "reason": reason }));
}

fn tell(app: &AppHandle, payload: Value) {
    let _ = app.emit_to(WINDOW_LABEL, EVENT, payload);
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    /// The link the QR code carries (its key after the #).
    url: String,
    /// The QR code: `size` modules a side, row by row, "1" dark.
    qr_size: usize,
    qr_bits: String,
    /// Seconds the session has.
    expires: u64,
}

/// Where Send to phone stands on this network, before anything starts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkCheck {
    /// "ok", "ask" (Public, not said to be the user's yet), "work" or "none".
    state: &'static str,
}

#[tauri::command]
pub async fn phone_network() -> NetworkCheck {
    NetworkCheck { state: network_state() }
}

/// "It's mine": the Public networks this computer is on now are trusted from now on.
/// Where the network can't be told apart (Linux), only the next session is, for a minute.
#[tauri::command]
pub async fn phone_trust_network() {
    let Some(ids) = imp::public_networks() else {
        *TRUSTED_ONCE.lock().unwrap_or_else(PoisonError::into_inner) = Some(std::time::Instant::now());
        return;
    };
    let mut trusted = trusted_networks();
    for id in ids {
        if !trusted.contains(&id) {
            trusted.push(id);
        }
    }
    save_trusted(&trusted);
}

/// "It's mine" said just now on a network with no id of its own: good for one start.
static TRUSTED_ONCE: Mutex<Option<std::time::Instant>> = Mutex::new(None);

/// Settings → What Puhu keeps → Clear: no network is trusted any more.
#[tauri::command]
pub fn phone_forget_networks() {
    let _ = std::fs::remove_file(trusted_path());
}

/// Send these dropped files to a phone.
#[tauri::command]
pub async fn phone_send(app: AppHandle, paths: Vec<String>) -> Result<Started, String> {
    if paths.is_empty() || paths.len() > MAX_FILES as usize {
        return Err(t("20 files at most."));
    }
    let mut files = Vec::new();
    for path in &paths {
        // Only what a real drop delivered (files.rs): never a path the page made up.
        if !crate::files::may_convert(path) {
            return Err(t("Only files dropped on the island can be added."));
        }
        let path = PathBuf::from(path);
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_file() {
            return Err(t("Only files dropped on the island can be added."));
        }
        if meta.len() > MAX_FILE {
            return Err(t("Too big: 500 MB at most."));
        }
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
        files.push(Outgoing { path, name, size: meta.len() });
    }
    start(app, Mode::Send(files)).await
}

/// Take files from a phone.
#[tauri::command]
pub async fn phone_receive(app: AppHandle) -> Result<Started, String> {
    start(app, Mode::Receive).await
}

#[tauri::command]
pub fn phone_cancel() {
    if let Some(session) = current() {
        end(&session, "cancelled");
    }
}

/// Downloads, shown after a file came from the phone. Never the file itself: it came
/// from elsewhere and is not opened here.
#[tauri::command]
pub fn phone_reveal_downloads() {
    if let Some(dir) = downloads() {
        crate::platform::reveal_folder(&dir.to_string_lossy());
    }
}

async fn start(app: AppHandle, mode: Mode) -> Result<Started, String> {
    match network_state() {
        "ok" => {}
        "ask" => return Err("ask".into()),
        "work" => return Err(t("Work networks are left out: nothing is sent over them.")),
        _ => return Err(t("This computer is on no network to share.")),
    }
    let ip = imp::local_address().ok_or_else(|| t("This computer is on no network to share."))?;
    let listener = TcpListener::bind(SocketAddr::new(ip, 0)).await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let random = SystemRandom::new();
    let mut token = [0u8; 16];
    let mut key = [0u8; 32];
    random.fill(&mut token).map_err(|_| "no randomness".to_string())?;
    random.fill(&mut key).map_err(|_| "no randomness".to_string())?;
    let url = format!("http://{ip}:{port}/t/{}#{}", b64url(&token), b64url(&key));
    let (qr_size, qr_bits) = qr(&url)?;
    let sealing = LessSafeKey::new(UnboundKey::new(&CHACHA20_POLY1305, &key).map_err(|_| "bad key".to_string())?);
    let served = match &mode {
        Mode::Send(files) => vec![0; files.len()],
        Mode::Receive => Vec::new(),
    };
    let (stop, stopped) = tokio::sync::watch::channel(false);
    let session = Arc::new(Session {
        token: b64url(&token),
        key: sealing,
        mode,
        progress: Mutex::new(Progress { served, ..Default::default() }),
        stop,
        app: app.clone(),
    });
    // One session at a time: a new one ends the one before.
    if let Some(old) = current() {
        end(&old, "replaced");
    }
    *CURRENT.lock().unwrap_or_else(PoisonError::into_inner) = Some(session.clone());
    crate::log::line("send to phone: started");
    tauri::async_runtime::spawn(serve(listener, session, stopped));
    Ok(Started { url, qr_size, qr_bits, expires: SESSION.as_secs() })
}

// ── The listener ──────────────────────────────────────────────────────────────

async fn serve(listener: TcpListener, session: Arc<Session>, mut stopped: tokio::sync::watch::Receiver<bool>) {
    let deadline = tokio::time::Instant::now() + SESSION;
    let slots = Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS));
    loop {
        tokio::select! {
            _ = stopped.changed() => break,
            _ = tokio::time::sleep_until(deadline) => {
                end(&session, "expired");
                break;
            }
            accepted = listener.accept() => {
                let Ok((stream, peer)) = accepted else { continue };
                let peer = peer.ip();
                // Shut out after its wrong requests, or already holding its share: closed
                // unread. Nobody can end the session this way, only lose their own way in.
                if !admit(&session, peer) {
                    continue;
                }
                let Ok(slot) = slots.clone().try_acquire_owned() else {
                    leave(&session, peer);
                    continue;
                };
                let session = session.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = handle(stream, &session, peer).await;
                    leave(&session, peer);
                    drop(slot);
                });
            }
        }
    }
}

/// An address may connect: not shut out, and under its share of connections.
fn admit(session: &Session, peer: IpAddr) -> bool {
    let mut progress = session.progress.lock().unwrap_or_else(PoisonError::into_inner);
    if progress.strikes.get(&peer).is_some_and(|n| *n >= MAX_STRIKES) {
        return false;
    }
    let open = progress.open.entry(peer).or_insert(0);
    if *open >= MAX_PER_ADDRESS {
        return false;
    }
    *open += 1;
    true
}

fn leave(session: &Session, peer: IpAddr) {
    let mut progress = session.progress.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(open) = progress.open.get_mut(&peer) {
        *open = open.saturating_sub(1);
    }
}

struct Request {
    peer: IpAddr,
    method: String,
    path: String,
    cookie: Option<String>,
    agent: String,
    length: Option<usize>,
    /// Whatever of the body came in with the headers.
    early: Vec<u8>,
}

async fn handle(mut stream: TcpStream, session: &Arc<Session>, peer: IpAddr) -> std::io::Result<()> {
    let request = match tokio::time::timeout(HEAD_TIME, read_head(&mut stream, peer)).await {
        Ok(Ok(Some(request))) => request,
        _ => return Ok(()),
    };
    let reply = route(&mut stream, session, request).await;
    stream.write_all(&reply).await?;
    stream.shutdown().await
}

/// The request line and the headers, within their limits; None for anything else.
async fn read_head(stream: &mut TcpStream, peer: IpAddr) -> std::io::Result<Option<Request>> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    let end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(at) = find(&buf, b"\r\n\r\n") {
            break at;
        }
        if buf.len() > LINE_MAX + HEAD_MAX {
            return Ok(None);
        }
    };
    let head = String::from_utf8_lossy(&buf[..end]).into_owned();
    let early = buf[end + 4..].to_vec();
    let mut lines = head.split("\r\n");
    let line = lines.next().unwrap_or_default();
    if line.len() > LINE_MAX {
        return Ok(None);
    }
    let mut parts = line.split(' ');
    let (Some(method), Some(path), Some(version)) = (parts.next(), parts.next(), parts.next()) else { return Ok(None) };
    if !version.starts_with("HTTP/1.") {
        return Ok(None);
    }
    let mut request = Request { peer, method: method.to_string(), path: path.to_string(), cookie: None, agent: String::new(), length: None, early };
    for header in lines {
        let Some((name, value)) = header.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => request.length = value.parse().ok(),
            "cookie" => request.cookie = value.split(';').find_map(|c| c.trim().strip_prefix("p=").map(str::to_string)),
            "user-agent" => request.agent = value.chars().take(300).collect(),
            "transfer-encoding" => return Ok(None),
            _ => {}
        }
    }
    Ok(Some(request))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Equal, in a time that doesn't tell how much of it matched.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn route(stream: &mut TcpStream, session: &Arc<Session>, request: Request) -> Vec<u8> {
    let peer = request.peer;
    let prefix = format!("/t/{}", session.token);
    // Anything but the token's own paths: nothing here, and a strike.
    let rest = match request.path.get(..prefix.len()) {
        Some(head) if same(head, &prefix) => request.path[prefix.len()..].to_string(),
        // A guess at another link is a strike against its address; what a browser asks
        // for by itself (/favicon.ico, /apple-touch-icon.png) is only not here.
        _ if request.path.starts_with("/t/") => return strike(session, request.peer),
        _ => return response(404, "text/plain", b"", None),
    };
    let parts: Vec<&str> = rest.split('/').filter(|p| !p.is_empty()).collect();

    if request.method == "GET" && parts.is_empty() {
        return page(session, &request);
    }
    // Everything else belongs to the phone that claimed the link.
    let claimed = session.progress.lock().unwrap_or_else(PoisonError::into_inner).cookie.clone();
    match (&claimed, &request.cookie) {
        (Some(ours), Some(theirs)) if same(ours, theirs) => {}
        _ => return response(403, "text/plain; charset=utf-8", t("This link was opened on another phone.").as_bytes(), None),
    }
    match (request.method.as_str(), parts.as_slice(), &session.mode) {
        ("GET", ["a.js"], _) => response(200, "text/javascript; charset=utf-8", PAGE_JS.as_bytes(), None),
        ("GET", ["a.css"], _) => response(200, "text/css; charset=utf-8", PAGE_CSS.as_bytes(), None),
        ("GET", ["m"], Mode::Send(files)) => {
            let list = json!({ "files": files.iter().map(|f| json!({ "name": f.name, "size": f.size })).collect::<Vec<_>>() });
            match seal(session, 0, WHOLE, 0, list.to_string().into_bytes()) {
                Some(sealed) => response(200, "application/octet-stream", &sealed, None),
                None => response(500, "text/plain", b"", None),
            }
        }
        ("GET", ["f", i, n], Mode::Send(files)) => match (i.parse::<u32>(), n.parse::<u32>()) {
            (Ok(i), Ok(n)) if (i as usize) < files.len() => send_piece(session, &files[i as usize], i, n, peer),
            _ => strike(session, peer),
        },
        ("POST", ["done"], Mode::Send(_)) => {
            tell(&session.app, json!({ "state": "sent" }));
            end(session, "done");
            response(204, "text/plain", b"", None)
        }
        ("POST", ["u", i], Mode::Receive) => match i.parse::<u32>() {
            Ok(i) => begin_file(stream, session, request, i).await,
            Err(_) => strike(session, peer),
        },
        ("PUT", ["u", i, n], Mode::Receive) => match (i.parse::<u32>(), n.parse::<u32>()) {
            (Ok(i), Ok(n)) => receive_piece(stream, session, request, i, n).await,
            _ => strike(session, peer),
        },
        _ => strike(session, peer),
    }
}

/// A wrong request: nothing here, and one more against its address (shut out at
/// MAX_STRIKES). The session itself goes on: a stranger can't end it.
fn strike(session: &Arc<Session>, peer: IpAddr) -> Vec<u8> {
    let mut progress = session.progress.lock().unwrap_or_else(PoisonError::into_inner);
    *progress.strikes.entry(peer).or_insert(0) += 1;
    response(404, "text/plain", b"", None)
}

/// The page: claimed by the first phone that opens it, refused to any other.
fn page(session: &Arc<Session>, request: &Request) -> Vec<u8> {
    let mut progress = session.progress.lock().unwrap_or_else(PoisonError::into_inner);
    let set_cookie = match &progress.cookie {
        Some(ours) if request.cookie.as_deref().is_some_and(|c| same(ours, c)) => None,
        Some(_) => return response(403, "text/plain; charset=utf-8", t("This link was opened on another phone.").as_bytes(), None),
        None => {
            let mut cookie = [0u8; 16];
            if SystemRandom::new().fill(&mut cookie).is_err() {
                return response(500, "text/plain", b"", None);
            }
            let cookie = b64url(&cookie);
            progress.cookie = Some(cookie.clone());
            tell(&session.app, json!({ "state": "claimed", "device": device(&request.agent) }));
            Some(format!("p={cookie}; Path=/t/{}; HttpOnly; SameSite=Strict", session.token))
        }
    };
    drop(progress);
    let words: serde_json::Map<String, Value> = PAGE_WORDS.iter().map(|(id, en)| (id.to_string(), Value::String(t(en)))).collect();
    let words = Value::Object(words).to_string().replace('<', "\\u003c");
    let lang = crate::i18n::current();
    let html = PAGE_HTML
        .replace("{{lang}}", lang)
        .replace("{{dir}}", if lang == "ar" { "rtl" } else { "ltr" })
        .replace("{{token}}", &session.token)
        .replace("{{mode}}", if matches!(session.mode, Mode::Send(_)) { "send" } else { "receive" })
        .replace("{{strings}}", &words);
    response(200, "text/html; charset=utf-8", html.as_bytes(), set_cookie.as_deref())
}

/// "iPhone · Safari", "Android · Chrome": enough to see whose phone it is.
fn device(agent: &str) -> String {
    let system = if agent.contains("iPhone") {
        "iPhone"
    } else if agent.contains("iPad") {
        "iPad"
    } else if agent.contains("Android") {
        "Android"
    } else if agent.contains("Windows") {
        "Windows"
    } else if agent.contains("Mac OS X") {
        "Mac"
    } else {
        "?"
    };
    let browser = if agent.contains("EdgA") || agent.contains("Edg/") {
        "Edge"
    } else if agent.contains("Firefox") || agent.contains("FxiOS") {
        "Firefox"
    } else if agent.contains("SamsungBrowser") {
        "Samsung Internet"
    } else if agent.contains("CriOS") || agent.contains("Chrome") {
        "Chrome"
    } else if agent.contains("Safari") {
        "Safari"
    } else {
        "?"
    };
    format!("{system} · {browser}")
}

fn send_piece(session: &Arc<Session>, file: &Outgoing, i: u32, n: u32, peer: IpAddr) -> Vec<u8> {
    let pieces = pieces(file.size);
    if n >= pieces {
        return strike(session, peer);
    }
    let start = n as u64 * PIECE as u64;
    let len = (file.size - start.min(file.size)).min(PIECE as u64) as usize;
    let mut plain = vec![0u8; len];
    let read = std::fs::File::open(&file.path).and_then(|mut f| {
        f.seek(SeekFrom::Start(start))?;
        f.read_exact(&mut plain)
    });
    if read.is_err() {
        return response(410, "text/plain", b"", None);
    }
    let Some(sealed) = seal(session, 0, i, n, plain) else { return response(500, "text/plain", b"", None) };
    let done = {
        let mut progress = session.progress.lock().unwrap_or_else(PoisonError::into_inner);
        let served = &mut progress.served[i as usize];
        *served = (*served).max(start + len as u64);
        *served
    };
    tell(&session.app, json!({ "state": "progress", "file": i, "done": done, "total": file.size }));
    response(200, "application/octet-stream", &sealed, None)
}

/// How many pieces a file of `size` bytes goes in: at least one, empty for an empty file.
pub fn pieces(size: u64) -> u32 {
    size.div_ceil(PIECE as u64).max(1) as u32
}

async fn read_body(stream: &mut TcpStream, request: Request, limit: usize) -> Option<Vec<u8>> {
    let length = request.length.filter(|l| *l <= limit)?;
    let mut body = request.early;
    if body.len() > length {
        return None;
    }
    body.reserve(length - body.len());
    let mut rest = (&mut *stream).take((length - body.len()) as u64);
    tokio::time::timeout(BODY_TIME, rest.read_to_end(&mut body)).await.ok()?.ok()?;
    (body.len() == length).then_some(body)
}

async fn begin_file(stream: &mut TcpStream, session: &Arc<Session>, request: Request, i: u32) -> Vec<u8> {
    let peer = request.peer;
    let Some(sealed) = read_body(stream, request, DESCRIPTION_MAX).await else { return response(400, "text/plain", b"", None) };
    let Some(plain) = open(session, 1, i, WHOLE, sealed) else { return strike(session, peer) };
    let Ok(description) = serde_json::from_slice::<Value>(&plain) else { return response(400, "text/plain", b"", None) };
    let (Some(name), Some(size)) = (description["name"].as_str(), description["size"].as_u64()) else {
        return response(400, "text/plain", b"", None);
    };
    if size > MAX_FILE || i >= MAX_FILES {
        return response(413, "text/plain", b"", None);
    }
    let mut progress = session.progress.lock().unwrap_or_else(PoisonError::into_inner);
    // The same beginning again (its answer was lost on the way): already begun.
    if i < progress.next_file {
        return response(204, "text/plain", b"", None);
    }
    if i != progress.next_file {
        return response(409, "text/plain", b"", None);
    }
    let dir = crate::settings::local_dir().join(INCOMING);
    if crate::platform::ensure_private_dir(&crate::settings::local_dir()).is_err() || std::fs::create_dir_all(&dir).is_err() {
        return response(500, "text/plain", b"", None);
    }
    let mut stem = [0u8; 12];
    let _ = SystemRandom::new().fill(&mut stem);
    let staging = dir.join(format!("{}.part", b64url(&stem)));
    let Ok(file) = std::fs::File::create(&staging) else { return response(500, "text/plain", b"", None) };
    progress.next_file = i + 1;
    progress.incoming.insert(i, Incoming { name: clean_name(name), size, pieces: pieces(size), next: 0, staging, file });
    response(204, "text/plain", b"", None)
}

async fn receive_piece(stream: &mut TcpStream, session: &Arc<Session>, request: Request, i: u32, n: u32) -> Vec<u8> {
    let peer = request.peer;
    let Some(sealed) = read_body(stream, request, PIECE + TAG).await else { return response(400, "text/plain", b"", None) };
    let Some(plain) = open(session, 1, i, n, sealed) else { return strike(session, peer) };
    let mut progress = session.progress.lock().unwrap_or_else(PoisonError::into_inner);
    // A piece sent again because its answer was lost: already written, answered, not added.
    if progress.finished.contains(&i) {
        return response(204, "text/plain", b"", None);
    }
    let Some(incoming) = progress.incoming.get_mut(&i) else { return response(409, "text/plain", b"", None) };
    if n < incoming.next {
        return response(204, "text/plain", b"", None);
    }
    // In order, each the size it must be: a full piece, or what is left of the file.
    let start = n as u64 * PIECE as u64;
    let expected = (incoming.size - start.min(incoming.size)).min(PIECE as u64) as usize;
    if n != incoming.next || plain.len() != expected {
        return response(409, "text/plain", b"", None);
    }
    if incoming.file.write_all(&plain).is_err() {
        return response(500, "text/plain", b"", None);
    }
    incoming.next += 1;
    let done = start + plain.len() as u64;
    let total = incoming.size;
    if incoming.next < incoming.pieces {
        drop(progress);
        tell(&session.app, json!({ "state": "progress", "file": i, "done": done, "total": total }));
        return response(204, "text/plain", b"", None);
    }
    let Some(incoming) = progress.incoming.remove(&i) else { return response(500, "text/plain", b"", None) };
    progress.finished.push(i);
    drop(progress);
    match finish(incoming) {
        Some(name) => {
            tell(&session.app, json!({ "state": "received", "file": i, "name": name }));
            response(204, "text/plain", b"", None)
        }
        None => response(500, "text/plain", b"", None),
    }
}

/// A file from the phone, whole: into Downloads under a cleaned name of its own, marked as
/// come from the internet so Windows warns before it is opened. Its name, or None.
fn finish(incoming: Incoming) -> Option<String> {
    let Incoming { name, staging, mut file, .. } = incoming;
    let result = (|| {
        file.flush().ok()?;
        drop(file);
        let dir = downloads()?;
        let target = unique_path(&dir, &name)?;
        std::fs::rename(&staging, &target).or_else(|_| std::fs::copy(&staging, &target).map(|_| ())).ok()?;
        let mut mark = target.as_os_str().to_owned();
        mark.push(":Zone.Identifier");
        let _ = std::fs::write(PathBuf::from(mark), "[ZoneTransfer]\r\nZoneId=3\r\n");
        note_received(&target);
        target.file_name().map(|n| n.to_string_lossy().into_owned())
    })();
    let _ = std::fs::remove_file(&staging);
    result
}

fn downloads() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        crate::downloads::downloads_dir()
    }
    #[cfg(not(windows))]
    {
        dirs_downloads()
    }
}

#[cfg(not(windows))]
fn dirs_downloads() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Downloads"))
}

/// Files from the phone, which the downloads indicator leaves alone.
static RECEIVED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

fn note_received(path: &Path) {
    let mut list = RECEIVED.lock().unwrap_or_else(PoisonError::into_inner);
    list.push(path.to_path_buf());
    let excess = list.len().saturating_sub(64);
    list.drain(..excess);
}

pub fn is_received(path: &Path) -> bool {
    RECEIVED.lock().unwrap_or_else(PoisonError::into_inner).iter().any(|p| p == path)
}

/// What a partial transfer left behind in an earlier run.
pub fn clear_leftovers() {
    let _ = std::fs::remove_dir_all(crate::settings::local_dir().join(INCOMING));
}

/// A name a phone sent, made safe to save: no folder, no character Windows refuses, no
/// device name, not too long; "file" when nothing is left.
pub fn clean_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    let mut name: String = base.chars().filter(|c| !c.is_control() && !invisible(*c) && !r#"<>:"/\|?*"#.contains(*c)).collect();
    name = name.trim().trim_end_matches(['.', ' ']).to_string();
    if name.chars().count() > 120 {
        let (stem, ext) = match name.rsplit_once('.') {
            Some((stem, ext)) if ext.chars().count() <= 10 && !stem.is_empty() => (stem.to_string(), format!(".{ext}")),
            _ => (name.clone(), String::new()),
        };
        name = stem.chars().take(120 - ext.chars().count()).collect::<String>() + &ext;
    }
    // Windows takes "CON .txt" for the device too: the stem without its trailing spaces.
    let stem = name.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        name = format!("_{name}");
    }
    if name.is_empty() || name.starts_with('.') && name.len() == 1 {
        "file".into()
    } else {
        name
    }
}

/// Characters that show nothing or turn the text around (Unicode's format characters:
/// direction marks and overrides, zero widths, the tags): "photo<RLO>gpj.exe" would read
/// as an image.
fn invisible(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x061C | 0x180E | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F
        | 0xFEFF | 0xFFF9..=0xFFFB | 0x0600..=0x0605 | 0x06DD | 0x070F | 0x08E2 | 0x110BD | 0x110CD
        | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
}

/// `dir/name`, or `dir/name (2)` and on: never a file that is already there.
fn unique_path(dir: &Path, name: &str) -> Option<PathBuf> {
    let first = dir.join(name);
    if !first.exists() {
        return Some(first);
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    (2..1000).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists())
}

// ── Sealing ───────────────────────────────────────────────────────────────────

/// [direction, 0, 0, 0, file (u32 BE), piece (u32 BE)]: never the same twice for a key.
pub fn nonce(direction: u8, file: u32, piece: u32) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[0] = direction;
    n[4..8].copy_from_slice(&file.to_be_bytes());
    n[8..12].copy_from_slice(&piece.to_be_bytes());
    n
}

fn seal(session: &Session, direction: u8, file: u32, piece: u32, mut data: Vec<u8>) -> Option<Vec<u8>> {
    let nonce = Nonce::assume_unique_for_key(nonce(direction, file, piece));
    session.key.seal_in_place_append_tag(nonce, Aad::empty(), &mut data).ok()?;
    Some(data)
}

fn open(session: &Session, direction: u8, file: u32, piece: u32, mut data: Vec<u8>) -> Option<Vec<u8>> {
    let nonce = Nonce::assume_unique_for_key(nonce(direction, file, piece));
    let len = session.key.open_in_place(nonce, Aad::empty(), &mut data).ok()?.len();
    data.truncate(len);
    Some(data)
}

/// Base64url without padding (RFC 4648 §5).
pub fn b64url(bytes: &[u8]) -> String {
    crate::screenshot::base64(bytes).replace('+', "-").replace('/', "_").trim_end_matches('=').to_string()
}

fn qr(url: &str) -> Result<(usize, String), String> {
    let code = qrcode::QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M).map_err(|e| e.to_string())?;
    let size = code.width();
    let bits = code.to_colors().iter().map(|c| if *c == qrcode::Color::Dark { '1' } else { '0' }).collect();
    Ok((size, bits))
}

// ── Responses ─────────────────────────────────────────────────────────────────

fn response(status: u16, content_type: &str, body: &[u8], set_cookie: Option<&str>) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        410 => "Gone",
        413 => "Content Too Large",
        _ => "Internal Server Error",
    };
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\
         Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\r\n\
         X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-store\r\n",
        body.len()
    );
    if let Some(cookie) = set_cookie {
        head.push_str(&format!("Set-Cookie: {cookie}\r\n"));
    }
    head.push_str("\r\n");
    let mut out = head.into_bytes();
    out.extend_from_slice(body);
    out
}

// ── The network ───────────────────────────────────────────────────────────────

fn network_state() -> &'static str {
    match imp::category() {
        imp::Category::None => "none",
        imp::Category::Work => "work",
        imp::Category::Private => "ok",
        imp::Category::Public => match imp::public_networks() {
            // Every one of them said to be the user's (and there is one at least).
            Some(ids) if !ids.is_empty() && ids.iter().all(|id| trusted_networks().contains(id)) => "ok",
            Some(_) => "ask",
            None => {
                let once = TRUSTED_ONCE.lock().unwrap_or_else(PoisonError::into_inner).take();
                if once.is_some_and(|at| at.elapsed() < Duration::from_secs(60)) { "ok" } else { "ask" }
            }
        },
    }
}

fn trusted_path() -> PathBuf {
    crate::settings::local_dir().join("phone-networks.json")
}

/// Windows' ids of the Public networks the user said are theirs (no names, no places).
fn trusted_networks() -> Vec<String> {
    std::fs::read_to_string(trusted_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_trusted(ids: &[String]) {
    if crate::platform::ensure_private_dir(&crate::settings::local_dir()).is_ok() {
        let _ = std::fs::write(trusted_path(), serde_json::to_string(ids).unwrap_or_default());
    }
}

#[cfg(windows)]
mod imp {
    use std::net::{IpAddr, UdpSocket};

    use windows::Win32::Networking::NetworkListManager::{
        INetworkListManager, NetworkListManager, NLM_ENUM_NETWORK_CONNECTED, NLM_NETWORK_CATEGORY_DOMAIN_AUTHENTICATED,
        NLM_NETWORK_CATEGORY_PRIVATE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

    pub enum Category {
        None,
        Work,
        Private,
        Public,
    }

    /// The address this computer is reached at on the network its traffic goes out on.
    /// Connecting a UDP socket sends nothing: it only picks the route.
    pub fn local_address() -> Option<IpAddr> {
        let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect("192.0.2.1:9").ok()?;
        let ip = socket.local_addr().ok()?.ip();
        (!ip.is_unspecified() && !ip.is_loopback()).then_some(ip)
    }

    /// (category, Windows' id) of each network this computer is connected to.
    fn networks() -> Vec<(i32, String)> {
        unsafe {
            let initialized = CoInitializeEx(None, COINIT_MULTITHREADED);
            let mut out = Vec::new();
            if let Ok(manager) = CoCreateInstance::<_, INetworkListManager>(&NetworkListManager, None, CLSCTX_ALL) {
                if let Ok(list) = manager.GetNetworks(NLM_ENUM_NETWORK_CONNECTED) {
                    loop {
                        let mut item = [None];
                        let mut fetched = 0u32;
                        if list.Next(&mut item, Some(&mut fetched)).is_err() || fetched == 0 {
                            break;
                        }
                        let Some(network) = item[0].take() else { break };
                        let category = network.GetCategory().map(|c| c.0).unwrap_or(0);
                        let id = network.GetNetworkId().map(|g| format!("{g:?}")).unwrap_or_default();
                        out.push((category, id));
                    }
                }
            }
            if initialized.is_ok() {
                CoUninitialize();
            }
            out
        }
    }

    /// The strictest of the networks this computer is on: a work one anywhere rules it out.
    pub fn category() -> Category {
        let all = networks();
        if local_address().is_none() || all.is_empty() {
            return Category::None;
        }
        if all.iter().any(|(c, _)| *c == NLM_NETWORK_CATEGORY_DOMAIN_AUTHENTICATED.0) {
            return Category::Work;
        }
        if all.iter().all(|(c, _)| *c == NLM_NETWORK_CATEGORY_PRIVATE.0) {
            Category::Private
        } else {
            Category::Public
        }
    }

    /// Windows' ids of the Public networks this computer is on now.
    pub fn public_networks() -> Option<Vec<String>> {
        Some(
            networks()
                .into_iter()
                .filter(|(c, id)| *c != NLM_NETWORK_CATEGORY_PRIVATE.0 && *c != NLM_NETWORK_CATEGORY_DOMAIN_AUTHENTICATED.0 && !id.is_empty())
                .map(|(_, id)| id)
                .collect(),
        )
    }
}

#[cfg(not(windows))]
mod imp {
    use std::net::{IpAddr, UdpSocket};

    pub enum Category {
        None,
        #[allow(dead_code)]
        Work,
        #[allow(dead_code)]
        Private,
        Public,
    }

    pub fn local_address() -> Option<IpAddr> {
        let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
        socket.connect("192.0.2.1:9").ok()?;
        let ip = socket.local_addr().ok()?.ip();
        (!ip.is_unspecified() && !ip.is_loopback()).then_some(ip)
    }

    /// Linux has no network categories: always asked, as a Public network.
    pub fn category() -> Category {
        if local_address().is_none() {
            Category::None
        } else {
            Category::Public
        }
    }

    /// No id a network can be told by: asked every time (phone_trust_network).
    pub fn public_networks() -> Option<Vec<String>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonces_follow_the_protocol() {
        assert_eq!(nonce(0, 0, 3), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
        assert_eq!(nonce(1, 2, WHOLE), [1, 0, 0, 0, 0, 0, 0, 2, 0xFF, 0xFF, 0xFF, 0xFF]);
        assert_eq!(nonce(0, WHOLE, 0), [0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, 0, 0, 0, 0]);
    }

    /// The same vector as tests/phone-page.test.mjs (noble, and OpenSSL): the phone's page
    /// and this side seal alike.
    #[test]
    fn sealing_matches_the_phone_page() {
        let key: Vec<u8> = (0u8..32).collect();
        let key = LessSafeKey::new(UnboundKey::new(&CHACHA20_POLY1305, &key).unwrap());
        let mut data = b"Puhu".to_vec();
        key.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce(0, 2, 3)), Aad::empty(), &mut data).unwrap();
        let hex: String = data.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "f46596f10ce562862463ffe11de359e591c4913d");
    }

    #[test]
    fn pieces_cover_the_file() {
        assert_eq!(pieces(0), 1);
        assert_eq!(pieces(1), 1);
        assert_eq!(pieces(PIECE as u64), 1);
        assert_eq!(pieces(PIECE as u64 + 1), 2);
        assert_eq!(pieces(MAX_FILE), 500);
    }

    #[test]
    fn base64url_has_no_padding_and_no_plus_or_slash() {
        assert_eq!(b64url(&[0xfb, 0xff]), "-_8");
        assert_eq!(b64url(&[0u8; 16]).len(), 22);
        assert_eq!(b64url(&[0u8; 32]).len(), 43);
    }

    #[test]
    fn names_from_a_phone_are_made_safe() {
        assert_eq!(clean_name("IMG_0001.HEIC"), "IMG_0001.HEIC");
        assert_eq!(clean_name("../../Windows/evil.exe"), "evil.exe");
        assert_eq!(clean_name(r"C:\Users\x\a.txt"), "a.txt");
        assert_eq!(clean_name("a<b>:c\"d|e?f*.txt"), "abcdef.txt");
        assert_eq!(clean_name("CON.txt"), "_CON.txt");
        assert_eq!(clean_name("com1"), "_com1");
        assert_eq!(clean_name("trailing. . "), "trailing");
        assert_eq!(clean_name(""), "file");
        assert_eq!(clean_name("..."), "file");
        assert_eq!(clean_name("a\u{0}b\u{7}.png"), "ab.png");
        // Turned-around and invisible characters can't dress a program up as a photo.
        assert_eq!(clean_name("photo\u{202E}gpj.exe"), "photogpj.exe");
        assert_eq!(clean_name("a\u{200B}b\u{2066}c\u{FEFF}.jpg"), "abc.jpg");
        assert_eq!(clean_name("CON .txt"), "_CON .txt");
        let long = format!("{}.jpeg", "x".repeat(300));
        let cleaned = clean_name(&long);
        assert_eq!(cleaned.chars().count(), 120);
        assert!(cleaned.ends_with(".jpeg"));
    }

    #[test]
    fn a_name_already_there_gets_a_number() {
        let dir = std::env::temp_dir().join(format!("puhu-phone-unique-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_path(&dir, "a.jpg").unwrap(), dir.join("a.jpg"));
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a.jpg").unwrap(), dir.join("a (2).jpg"));
        std::fs::write(dir.join("a (2).jpg"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a.jpg").unwrap(), dir.join("a (3).jpg"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_same_test_is_constant_in_what_it_answers() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "ab"));
    }

    #[test]
    fn devices_are_named_by_system_and_browser() {
        assert_eq!(device("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "iPhone · Safari");
        assert_eq!(device("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"), "Android · Chrome");
        assert_eq!(device("Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36"), "Android · Samsung Internet");
    }

    #[test]
    fn the_qr_code_carries_the_link() {
        let (size, bits) = qr("http://192.168.1.20:51234/t/AAAAAAAAAAAAAAAAAAAAAA#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").unwrap();
        assert_eq!(bits.len(), size * size);
        assert!(size >= 21);
    }
}
