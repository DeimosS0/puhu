# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately on
GitHub: the repository's **Security** tab → **Report a vulnerability**. Say what you
found, how to reproduce it, and which version of Puhu you used.

Puhu is made by one person, so an answer may take a little while, but every report is
read. A confirmed problem is fixed in a new release as soon as it can be, and the
release notes say what was fixed once the fix is out. Tell me if you want to be
credited.

Only the latest release is supported: every fix comes in a new version, which Puhu
offers in the island.

## What Puhu promises, and how it keeps it

- **Nothing about you leaves your computer** unless you set up the service it goes to.
  [PRIVACY.md](PRIVACY.md) lists everything Puhu keeps, sends, and for how long.
- **Releases are signed.** Puhu installs an update only if its signature matches
  Puhu's own key; download the installer only from this repository's releases page.
- **Keys and tokens** live in Windows Credential Manager, never in a file.
- **Agents are never blocked or approved without you.** The hook relay gives Puhu
  300 ms and steps aside; a permission is answered only by your click.
- **Your files are never changed in place.** A converted file goes next to the
  original; a dropped file is copied before anything reads it.
- **A feature that keeps data or opens a door to the network** gets a written threat
  model in `docs/` before its code, and its own tests for every protection it claims.

## Licence

Puhu comes as it is, without warranty (Apache License 2.0, sections 7 and 8). That is
no excuse for carelessness: the promises above are what this project holds itself to.
