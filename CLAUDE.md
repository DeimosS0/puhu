# Puhu — guide for AI coding agents

Puhu is a Windows desktop "dynamic island": a small black island at the top-centre of
the screen with an owl, Puhu, in it. It shows AI coding agent sessions (Claude Code,
Codex, Gemini CLI and more) and a few integrations, lets the user approve, answer, chat
and drop files from the island, and turns Pomodoro focus into a game (points, streaks,
quests, badges, the Nest). Tauri 2: Rust in `src-tauri/`, TypeScript in `src/` (no
framework). Apache-2.0 (LICENSE, NOTICE); the name, character, icon and sounds are reserved (ASSETS.md).

## Where things are
- `src/puhu/` — Puhu drawn in Canvas 2D (`engine.ts`, `puhu.ts`), the launch greeting, the mini Puhus.
- `src/island/` — the island's state machine and glue: hooks, focus play (`progress.ts`), surprises.
- `src/views/` — every island view. `src/hub/` — Puhu's window (the Nest, Flow, mail, settings pages).
- `src/core/` — state, the bridge to Rust, Pomodoro, and focus play's pure rules: `progress.ts`
  (replays the log), `quests.ts`, `badges.ts`, `secrets.ts` (surprises), `shop.ts`.
- `src/nest/tree.ts` — the Nest's tree. `docs/gamification.md` — focus play's design, the source of truth.
- `src/i18n/strings.json` — every string, keyed by its English text, in all 14 languages.
- `src-tauri/src/` — windows, the hook pipe, providers, pollers, `progress.rs` (the signed log).
- `hook/` — `puhu-hook.exe`, the relay agents' hooks run.
- `core/pills.ts` and the pill catalog: pill IDs are stable contract values.
- README pictures: files in `docs/media/` (not tracked), published on the one-commit `media` branch by `node scripts/readme-media.mjs`; the README links them by their raw.githubusercontent.com address.

## Build and test
```
npm install
npm run tauri dev                       # development build with live reload
npm run tauri build -- --bundles nsis   # installer
npm test                                # front-end tests (node:test)
cargo test -p puhu --lib                # Rust tests
```

## Rules
- Secrets live in Windows Credential Manager, never on disk or in git.
- No telemetry. Network calls only to services the user configured.
- Never block Claude Code: if the app doesn't answer, the hook exits immediately.
- Never overwrite `~/.claude/settings.json`: dated backup, merge, show the diff, write only after the user confirms.
- Never send a message or an email, or approve a permission, without an explicit click.
- Performance: 0 % CPU when the island is hidden; nothing polls while nothing is due.
- Keep the identifier `io.github.deimoss0.puhu` (Credential Manager entries, WebView2 data and the data folders depend on it).
- Pill IDs and stored keys (settings.json fields, localStorage keys, the progress log's events) are stable: renaming one needs a migration.
- Every new string goes into `src/i18n/strings.json` with all 13 other languages; `npm test` fails otherwise and when a string is no longer used.
- New views follow the existing style. Puhu's look is his own: no other app's artwork, names or sounds.
- Every release adds its CHANGELOG.md section and its What's new (`src/whats-new/whats-new.json`, 1 to 4 items in the 14 languages).
