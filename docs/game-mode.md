# Game mode and "Ask the screen"

Status: game mode built (phase 1, 2026-11-06); Ask the screen built without reading
aloud (phase 2, 2026-11-06). Update this file before the code.

Two features that go together. In a full-screen game Puhu steps aside and costs
nothing; when you need him, one key hands him what is on the screen and he answers.

## 1. Game mode

**When it starts**
- On its own: the window in front fills its whole monitor (a game in full screen or
  borderless full screen) and Windows reports it as busy (`SHQueryUserNotificationState`:
  `QUNS_RUNNING_D3D_FULL_SCREEN` or `QUNS_BUSY`). Checked on every foreground change,
  from the `EVENT_SYSTEM_FOREGROUND` hook `keep_on_top` already installs: no polling.
- Per app, like Discord's registered games: an app joins the list (Settings → Game mode)
  the first time it fills the screen, on — or off for browsers, video players and
  slideshows — and a switch per app turns it on or off; Remove forgets it.

**Built**: `src-tauri/src/game.rs` (a worker fed by the foreground hook; it looks at the
window in front 0.3, 2 and 6 s after it changes, and leaves game mode only after 8 s away,
so an Alt+Tab changes nothing), `platform::front_window`, settings `gameMode` and
`gameApps` (Rust-owned), the island's `setGame`, Settings → Game mode.

**What Puhu does in it**
- First, a moment: Puhu puts on a headset, waves his wing and says "Have a good game!";
  then the island folds away completely: nothing is drawn, every animation loop stops,
  and the pointer can't wake it.
- The cursor polls (island and dictation pill), the music analysis (beat.rs) and the
  desktop Puhu stop; Puhu's sounds are muted.
- Peeks and moments (songs, downloads, badges, surprises) are held, as they already are
  while presenting (`platform::presenting`).
- A Pomodoro keeps counting, silently.
- Claude Code: a permission or a question goes straight to the terminal (as when Puhu is
  paused), so no session waits on an island nobody looks at; it is counted.
- Measured in the dev build: game mode alone saved little, because most of Puhu's cost at
  rest was the main thread answering the cursor polls' window queries (~9 % of a core).
  The polls now read their window from Win32 directly (`platform::frame`).

**When it ends**
- One small peek: "Welcome back! · Done while you played: 2 · In the terminal: 1". Then
  everything held plays as usual.
- First time ever: a secret badge, Player two.

## 2. Ask the screen

**Built**: `src-tauri/src/screen_ask.rs` (`ask_screen`: Windows Graphics Capture of the
monitor under the pointer, Puhu's windows kept out with their display affinity, at most
1568 px, a PNG in the inbox like a dropped file), the shortcut `Ctrl+Alt+F` (the reserved
`attachFrontWindow` action, its id kept), `Island.askScreen`, the chat's picture chip and
quick questions (`views/chat.ts`), pictures for Ollama / LM Studio (`local_chat.rs`).
In a game, game mode ends quietly (`game::step_out`, no welcome back) and starts again
when the game is back in front. Not yet: reading aloud (left for later by the user),
streaming for Claude and the subscriptions, Save, the "never" list, the first-time line.

**The gesture**
- A shortcut (decision 1). Puhu takes the screen under the pointer at once (no overlay,
  nothing in front of the game), and the island opens a small card: the picture as a
  thumbnail, a text field already focused, and quick chips: *What is this?*, *How do I get
  past this?*, *Translate*, *Explain the error*.
- The same shortcut with Shift: pick a region instead (Windows' own snipping overlay,
  `ms-screenclip:`; the picture arrives on the clipboard, where Puhu already listens).
- Enter sends; the answer streams into the card. Esc closes it. The picture is then
  forgotten; **Save** keeps it, like the screenshot viewer.
- Read aloud (the voice's existing speech output): on by default in game mode, where
  the card may not be visible (an exclusive full-screen game hides every other window).
- Later, by voice: "OK Puhu, what is this?" takes the screen and asks, hands-free.

**Taking the picture**
- Windows Graphics Capture for the monitor (or DXGI Desktop Duplication on systems
  without it): it sees borderless and most full-screen games, which GDI often shows as
  black. Read-only: nothing is injected into the game, so anti-cheat has nothing to see.
- Puhu's own windows are left out of the picture.
- Downscaled to at most 1568 px on the long side before sending: less to upload, faster
  answers, lower cost (Claude reads an image of ~1.15 megapixels as about 1,600 tokens).

**Who answers** — the chat's provider, as set in Settings → Chat:

| Provider | Pictures | Notes |
|---|---|---|
| Claude (API key) | yes, already | the default |
| Google AI / Gemini (API key) | yes, already (OpenAI-compatible endpoint) | Google has offered a free tier, with limits |
| OpenAI, OpenRouter | yes, already | OpenRouter reaches many vision models |
| Ollama / LM Studio | yes (same image format), with a vision model | a local vision model: nothing leaves the computer |
| Claude / Gemini / Codex subscriptions (CLI) | not yet | text only in Puhu today |

**Privacy**
- Nothing is taken until the shortcut is pressed; the picture goes only to the provider
  the user chose, and is not written to disk unless saved.
- The first time, one line says where it goes ("to Claude, with your key").
- Apps on a "never" list (password managers, banking) refuse the shortcut.

## Phases
1. Game mode: detection, folding away, holding, the summary when it ends. Measured.
2. Ask the screen: capture, the card, streaming answers, read aloud; images for local
   models.
3. By voice; region picking; quests and the secret badge.

## Decisions (2026-11-06)
1. The shortcut for Ask the screen: Ctrl+Alt+F, the key the reserved `attachFrontWindow`
   action already held, checked against the AltGr layers like the others.
2. Capture: the whole screen at once.
3. Read aloud: yes, it reuses the voice's speech output; postponed (2026-11-06).
4. Claude's requests during a game: to the terminal at once, counted for the welcome back.
5. Full-screen videos: per app, Discord-like; browsers and players join the list off.
