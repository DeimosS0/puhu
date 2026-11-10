# Send to phone, and from it

Status: built for 0.6.3 (2026-11-10): `src-tauri/src/phone.rs` (the session and its
listener), the page in `src/phone-page/` (built into `src-tauri/phone/` by
`npm run phone-page`). This is the threat model the code has to meet; update it before
the code.

A file goes from the computer to a phone, or from a phone to the computer, through the
phone's own browser: no app on the phone, no cable, no account, no server of ours,
iPhone and Android alike.

## How it is used

**To the phone**: drop a file (or several) on the island and pick Send to phone. Puhu
holds up a QR code like a sign. The phone's camera opens a small page with the file's
name, its size and Download. Once it is downloaded, the file folds into a paper plane
and flies off, and the island closes the session.

**From the phone**: open Get from phone in the island, scan the QR, pick photos or
files on the phone. Each one drops into the island, Puhu catches it, and it lands in
Downloads.

## How it works

- **A session** starts only from the user's click and lives until the files are
  through, Cancel, or 10 minutes, whichever comes first. One session at a time.
- **The listener** exists only while the session lives: a minimal HTTP server bound to
  the computer's own address on the network that carries the default route (never
  `0.0.0.0`, never a VPN or virtual adapter), on a random high port.
- **Which networks**: Windows gives every network a category. Domain (a managed work
  network): never, Puhu says why. Private: yes. Public: Windows 11 puts every new
  network there, a home Wi-Fi and a phone's hotspot included, so refusing it would
  refuse most people at home. On a Public network Puhu asks once for that network:
  "Is this your home or your phone's hotspot? Not a café, school or hotel network?"
  [Yes, it's mine] [Cancel], and remembers the answer for that network only.
- **The link**: `http://<address>:<port>/<token>`, the token 128 random bits from the
  OS's random source. Nothing else answers: no index, no listing, no path but the
  token's.
- **Claimed by the first phone**: the first request gets a session cookie; any other
  device is turned away. The island shows what connected ("iPhone · Safari"), with
  Cancel, so a phone that isn't yours is seen at once.
- **Encrypted end to end, in the page**: the link carries a fresh 256-bit key after its
  `#`; browsers never send that part over the network. Each file goes in 1 MiB pieces,
  each sealed with ChaCha20-Poly1305 (`ring` on the computer, `@noble/ciphers`,
  audited, pinned and served with the page on the phone: the browser's own crypto
  only works over HTTPS). Someone listening on the network sees only noise, and a
  changed piece is refused. Uploads are sealed on the phone the same way.
- **To the phone**: the page offers exactly the files that were dropped, each sent once;
  the page opens each piece and hands the whole file to the browser to save. When all
  are through the session ends.
- **From the phone**: uploads stream into a staging file in Puhu's private folder, then
  move to Downloads under a cleaned, unique name (never over an existing file). Each
  gets Windows' "came from the internet" mark (Zone.Identifier, ZoneId 3), so
  SmartScreen and Office warn before opening it. Nothing received is ever opened by
  Puhu. A transfer that breaks leaves nothing behind.
- **The pages** carry a strict CSP (`default-src 'none'`, our one script and style),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`, no CORS. They never ask for anything but files.

## Protocol (v1)

The source of truth for `src-tauri/src/phone.rs` and the phone's page (`src/phone-page/`).

- **Link**: `http://<address>:<port>/t/<T>#<K>`: `T` 16 random bytes, `K` the 32-byte
  key, both base64url without padding. Every path but the token's answers 404; an address
  with 20 wrong requests is shut out (closed unread) while the session goes on, so a
  stranger can't end it; 4 connections from one address, 16 in all.
- **Claim**: the first `GET /t/<T>` gets the page and a cookie (`p`, 128 random bits,
  `HttpOnly; SameSite=Strict; Path=/t/<T>`); every later request must carry it, any
  other device gets a short "opened on another phone" page.
- **Sealing**: ChaCha20-Poly1305 (RFC 8439), the 16-byte tag after the ciphertext.
  Nonce = `[direction, 0, 0, 0, file (u32 BE), piece (u32 BE)]`: direction 0 from the
  computer, 1 from the phone; a file's description uses piece `0xFFFFFFFF`, the list of
  files sent uses file `0xFFFFFFFF`. A piece is 1 MiB of the file.
- **To the phone**: `GET /t/<T>/m` is the sealed list `{"files":[{"name","size"}]}`;
  `GET /t/<T>/f/<i>/<n>` is piece `n` of file `i`, sealed; `POST /t/<T>/done` once the
  phone has saved them all ends the session.
- **From the phone**: files are numbered by the phone from 0 (20 at most).
  `POST /t/<T>/u/<i>` with the sealed `{"name","size"}` (500 MB at most) begins file
  `i`; `PUT /t/<T>/u/<i>/<n>` with its sealed pieces, in order; the last one finishes
  it: moved to Downloads under a cleaned unique name with the internet mark.
- **The page** is `/t/<T>` (HTML), `/t/<T>/a.js` and `/t/<T>/a.css`; its words come in a
  `<script type="application/json">`, so the page runs no inline script.
- **Limits**: request line 8 KB, headers 16 KB, a body a piece and its tag (4 KB for a
  description) with its Content-Length, 10 s to send the headers and 60 s for a body,
  one request per connection.
- **Names from the phone** lose any folder, the characters Windows refuses, control,
  direction and invisible characters (`photo<RLO>gpj.exe` can't pass for a photo), and
  a device name (`CON`, `COM1`) gets a `_` in front.
- **Trust on Linux**: no network id to remember, so a Public network is asked every time.

## Threats

| Who | What they try | What stops it | Left over |
|---|---|---|---|
| Someone on the same network | Guess the link | 128-bit token; an address shut out after 20 wrong requests | None |
| Someone on the same network | End or block the session | Wrong requests only shut out their own address; 4 connections from one address | A crowd of addresses could still fill the 16 connections for a while |
| Someone on the same network | Listen to the traffic | Encryption in the page: they see only noise | None |
| A device on the network that actively attacks it (ARP spoofing) | Change the page as it is served, so it leaks the key | Domain networks refused; Public ones only after "it's mine"; the window is 10 minutes | Real but rare: it needs an attacker working on your own network during those minutes |
| Someone who photographs the QR | Get the file first | Claimed by the first phone, shown on the island, 10 minutes at most; your phone would then see "already used" | They need to be in the room and on your Wi-Fi |
| A malicious upload | Path tricks, huge files, a disguised program | Cleaned names, unique files in Downloads only, size limits (500 MB a file, 20 files a session), the internet mark, never opened | The user may still open a bad file, as with any download |
| A broken or hostile client | Crash or hang the server | Small hand-written parser with hard limits (8 KB request line, 16 KB headers, Content-Length required), timeouts, 4 connections at most, fuzz tests | — |
| Forgetting it is on | A door left open | The listener dies with the session (10 minutes at most); the closed island shows a phone while it lives | None |
| Work networks | Data leaving a managed company network | Domain networks refused | None |

## What it is not

Not a cloud transfer: both devices must be on the same network. Campus and office Wi-Fi
often keep devices from seeing each other; then nothing arrives, and after 30 seconds
the island suggests the phone's hotspot. Not a sync, not a backup, nothing kept.

## Speed

On the same Wi-Fi a transfer usually runs at 10–50 MB/s (100 MB in a few seconds, 500 MB in
10 to 50 seconds), set by the Wi-Fi, not by Puhu. Sealing on the
computer is far faster than any Wi-Fi. Opening the pieces in a phone's browser is
plain JavaScript: on a recent phone it should keep up with the Wi-Fi, an old one may
slow down. These are estimates, measured on real phones in the first prototype.

Big files: without HTTPS the page can't stream a file to the phone's storage, so the
browser holds the whole opened file in memory before saving it. A file is limited to
500 MB, both ways, which every phone handles.

## The phone's hotspot

When the two can't see each other (campus or office Wi-Fi), the island suggests
connecting the computer to the phone's hotspot. The transfer then goes straight
between the two over the hotspot's Wi-Fi: it uses no mobile data. While the computer
stays on the hotspot, though, its own internet traffic (updates, sync) goes through
the phone's mobile data; Puhu says so and reminds the user to switch back when done.

## Rough edges to tell the user about

- The first time, Windows Firewall asks whether Puhu may use the network (with an
  administrator prompt on most PCs). Puhu says so before it happens; if it was refused,
  Puhu explains how to allow it.
- On iPhone, a downloaded file goes to Files, not Photos.

## Privacy

Nothing is kept: files sent are read from where they are, files received land in
Downloads. The log says "send to phone: started / claimed / done / cancelled", never a
file's name. A row in PRIVACY.md and in Settings → What Puhu keeps, in the same
release.

## Tests

Token length and randomness; one phone claims, a second is refused; a used file is not
served again; expiry closes the listener; Public and Domain networks refused; names
with `..`, `\`, `:`, reserved names (`CON`) and very long ones cleaned; size limits;
the Zone.Identifier mark written; a broken upload leaves nothing; header and request
limits; a fuzzed request never panics.

## Decided (2026-11-09)

- Domain (work) networks refused.
- Public networks after a one-time "it's mine" per network.
- Encryption in the page from the first version: the key travels from the screen to
  the phone's camera inside the QR code, never over the network.
- When the devices can't see each other, the island suggests the phone's hotspot.
- Limits: 10 minutes a session, 500 MB a file, 20 files.
