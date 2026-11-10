# Contributing

Puhu is made by one person. The most useful help is a good bug report or an idea: open an
issue, and its form asks for what is needed. A security problem goes privately, as
[SECURITY.md](SECURITY.md) says.

## Pull requests

Welcome, the smaller the better; for anything bigger, open an issue first so we agree on
it before you spend the time. A better line in your own language is especially welcome:
every string is in `src/i18n/strings.json`, in 14 languages.

A pull request is not merged with the button. Puhu's public history is one commit per
release, so a change I take is applied by hand to the next release, with you as its
co-author and named in the release notes, and the pull request is closed with a link to
that release.

## Before you send

- `npm test` and `cargo test -p puhu --lib` pass.
- A new string is in all 14 languages; `npm test` fails otherwise.
- No telemetry, and network calls only to services the user set up.
- Anything that keeps data or listens on the network gets its row in
  [PRIVACY.md](PRIVACY.md) and a threat model in `docs/` before its code.
- Puhu's look is his own: no other app's artwork, names or sounds. His name, character,
  icon and sounds are not under the code's licence ([ASSETS.md](ASSETS.md)).
- What you send is under the [Apache License 2.0](LICENSE), like the rest of the code.
