# Privacy

Puhu keeps as little as he can, for as short a time as he can, and only on your
computer. There is no telemetry, no account and no server of ours: nothing about you
is ever sent to us. Settings → General → **What Puhu keeps** shows the same list as
this page, with a Clear for each thing that can be cleared.

## What he keeps

| What | Why | Where | For how long |
|---|---|---|---|
| Focus play: when each Pomodoro round and break started and how long it ran, the daily goal, badges earned, what you bought in the Nest, the time an agent finished a turn for a quest | Your level, streak, quests and badges | `%APPDATA%\Puhu\progress.log` | Until you clear it |
| Agent sessions: per session the agent, the project folder's name, its start and end, and how many files, lines, commands and questions | The weekly recap | `%LOCALAPPDATA%\Puhu\recap.json` | 4 weeks; older weeks only add to a few totals (sessions, time, lines, answers) |
| Your Allow and Deny clicks on agents' permission requests | The weekly recap | `recap.json` | 4 weeks, as above |
| Working time, only if you turned it on: minutes per half hour in coding, design and writing programs, never their names | The weekly sky | `%LOCALAPPDATA%\Puhu\activity.json` | 14 days |
| Each week's sky in short: its title, how many stars, minutes and things done; no hour in it | Your fullest sky, the year's card | Puhu's web storage | A year |
| Today's list | Your things to do | Puhu's web storage, `%LOCALAPPDATA%\io.github.deimoss0.puhu` | Until you tick or delete them; done ones 14 days |
| The last pictures you copied (a screenshot or any image) | The island's peek and its viewer | `%TEMP%\puhu-screenshots` | The newest two, 15 minutes each, and none once Puhu closes |
| Copies of files you drop for the chat | So the chat can read them while the original stays untouched | `%LOCALAPPDATA%\Puhu\inbox` | A day, or until you let go of the file |
| Files from your phone (Send to phone) | They are yours | Downloads, with Windows' "came from the internet" mark; never opened by Puhu | Yours to keep; a transfer that breaks leaves nothing (its partial file in `%LOCALAPPDATA%\Puhu\incoming` goes, and at launch) |
| Windows' id of each Public network you said is yours | Send to phone asks only once | `%LOCALAPPDATA%\Puhu\phone-networks.json` | Until you clear it; never a network's name |
| Your town and its coordinates | The weather | `%APPDATA%\Puhu\settings.json` | Until you remove it under Weather |
| Names of apps that filled the screen | Game mode | `settings.json` | Until you remove them under Game mode |
| Puhu's log: what happened and when (an agent's events, a game taking the screen, an error), never what you write, copy or open | Finding a fault | `%LOCALAPPDATA%\Puhu\puhu.log` | Up to 1 MB, then it starts over |
| Keys and tokens for the services you connect | Talking to those services | Windows Credential Manager | Until you remove the service |

The file Puhu makes from a drop (a PDF, a smaller photo) goes next to the original and
is yours; Puhu keeps no copy.

## What he looks at but never keeps

- **Text you copy**: shown in the island for a moment. What a password manager marks as
  private is never read at all.
- **The program in front**: only its name, for the prop he takes up (a mug, a beret, a
  pencil) and for game mode. Never a window's title or what is in it.
- **Music**: the song your media player announces, while it plays.
- **Camera and microphone**: which app uses them, for the dot on the island and a
  moment's note.
- **Downloads and USB drives**: a file's name as it arrives, a drive's name and room.
- **Copy text**: only when you click it in the screenshot viewer, Windows' own text
  recognizer reads the picture on this computer; the words go to your clipboard and
  nowhere else.
- **The chat**: your conversation stays in memory while Puhu runs, and is gone when he
  closes.

## What goes over the network

Only what you set up:

- **Weather**: the town you type goes to Open-Meteo once to find it, then its
  coordinates once an hour. Nothing without a town.
- **Updates**: after you say yes once, Puhu asks GitHub whether there is a new
  version, and installs only one signed with Puhu's key.
- **The chat**: your messages, the files you add and, with Ask the screen, a picture
  of the screen go to the provider you chose (or stay on your computer with a local
  model such as Ollama).
- **Services you connect** (Stripe, GitHub, Vercel and the others): only to the
  service, with your own key.
- **Album covers**: from the music service's own image server, when it gives one.
- **Send to phone**: only between this computer and your phone, on your own network,
  never through the internet. Puhu listens only while its code is on screen (10 minutes
  at most), only the first phone that opens it gets in, and every piece is sealed with a
  key that goes from the screen to the phone's camera, never over the network.
  [docs/send-to-phone.md](docs/send-to-phone.md) has the whole design.

## Removing everything

Each item above has its Clear in Settings → General → What Puhu keeps (or where the
table says). To remove Puhu entirely, uninstall it, then delete `%APPDATA%\Puhu`,
`%LOCALAPPDATA%\Puhu` and `%LOCALAPPDATA%\io.github.deimoss0.puhu`, and Puhu's entries
in Windows Credential Manager.

## Changes

A new feature that keeps or sends anything is added to this page in the same release.
