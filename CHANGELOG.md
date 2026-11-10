# Changelog

## 0.6.4

Puhu rings until you answer, reads the text in a picture and does your sums.

- **Alarms that wait for you**: a timer that ends comes down from the island and rings until
  you say OK, every few seconds for a minute, then every half minute. After ten minutes the
  sound stops but the card stays, and Puhu rings once more when you are back at the
  computer. It rings though Puhu's sounds are off, and in a game (its card comes when the
  game is over).
- **Today's times ring too**: a thing on Today's list with a time gets a word ten minutes
  before and its alarm at the time, Puhu holding a little brass bell; OK ticks it, +10 min
  puts it off. A time that went by while Puhu was not running is told once. Settings →
  General → Today → Reminders: 10 or 5 minutes before, at its time, or off.
- **Copy text**: in the screenshot viewer (Win+Shift+S, then a click on the picture in the
  island) or on a picture dropped on the island. Windows' own text recognizer reads it on
  your computer, in your languages: a light crosses the picture, every word it finds lights
  up, and the text is on the clipboard. Drag over a few words to copy just those. Nothing is
  sent anywhere or kept.
- **Sums on the pull-down line**: write "1250*1,18" or "450 + %18" where timers go: the
  result shows as you type, Enter copies it. Numbers are read the way your language writes
  them, percentages the way a shop's calculator takes them.

## 0.6.3

Your week as a sky, files to and from your phone, and a Puhu who keeps less and says what he
keeps.

- **The week's sky**: Monday's card now tells anyone's week, not only an agent's. Every half
  hour with twenty minutes of a focus round, an agent at work or (only if you turn it on) a
  coding, design or writing program in front is a star, coloured by what filled it, and every
  thing ticked on Today's list is one more; each day's stars make a constellation. A title
  for the week (Night Owl, Early Bird, Focus Master, Weekend Hero…), the brightest day,
  three numbers and how it compares, never pointing out a lighter week. Share makes a tall
  picture of Puhu on a branch under your sky, dressed for the title, with no project,
  program or time of day in it; the agents' week is a page of its own. The card asks once
  whether to count working time: a minute counts only while a counted program is in front
  and the keyboard or mouse was used in the last two minutes, kept 14 days. A short summary
  of each week is kept a year.
- **Send to phone, and get from it**: drop files on the island and pick Send to phone, or
  Get from phone in the + tab. Puhu holds up a QR code and the phone's camera opens a page in
  its own browser, no app, iPhone or Android. Files go straight over your Wi-Fi or the
  phone's hotspot, not through the internet, every piece sealed end to end with a key that
  is only in the QR code; one phone a session, 10 minutes at most, 500 MB a file. Work
  networks are refused, a public one is asked once. What comes from the phone lands in
  Downloads with Windows' internet mark and is never opened.
- **What Puhu keeps**: Settings → General lists everything Puhu remembers and for how long,
  each with a Clear, and PRIVACY.md says the same. He keeps less: copied pictures 15 minutes
  (the newest two), a dropped file a day, agent sessions 4 weeks (their totals stay).
- **Safer**: a mail's text can no longer run as PowerShell (a curly quote in an attachment's
  name), and the chat's Mail switch is set aside with Mail; a token never goes over plain
  http to another machine or follows a redirect; the agents' relay pipe opens only to your
  account and talks only to Puhu; folders open without a command line; speech recognition's
  downloaded libraries are out of the build; only the per-user setup.exe ships, no .msi.
  SECURITY.md says how to report a problem privately.
- Fixes: the launch hello takes its time; Puhu no longer climbs over Win+Shift+S's frozen
  screen; the screenshot viewer's Save and Open no longer touch a wide picture; Today blows
  the dust off an old thing once a day, not each time it opens; a copied colour can no
  longer restyle its swatch.

## 0.6.2

Puhu lends a hand: with files, timers, USB drives, and the island itself.

- **Files into PDFs**: drop photos on the island and they become one PDF (a page each, A4,
  turned the way the camera meant); a Word document or plain text becomes a PDF too, without
  Word. One photo can also be made smaller to send, or a JPG. All of it on your computer;
  the new file goes beside the old one, never over it. Puhu stacks the pages and staples
  them, or wrings a photo out like a sponge; Copy puts the file itself on the clipboard, for
  Ctrl+V into a chat or a mail.
- **Timers**: pull the compact island down (or open the timer tab) and write "12 min tea",
  "egg 7 minutes" or "1 h 20 min". The island counts down, Puhu holds a tulip glass of tea
  darkening as it brews (a cup of coffee, an egg, an hourglass), and when it is done he
  holds it up ringing, with OK or five minutes more. Without a length, what you wrote goes
  on today's list.
- **The island under your hand**: the wheel over it turns the volume, a sideways swipe (the
  wheel tilted, or Shift and the wheel) goes to the next song or the one before, the middle
  button plays and pauses.
- **USB drives**: one plugged in is caught, with its name and the room left on it; its card
  opens it or ejects it safely, and says so when a file on it is still open.
- Fixes: taking a screenshot no longer starts game mode; the mini Puhus of other sessions no
  longer leave lines round them; Puhu is dressed in the drop scene as he is in the island;
  his scarf turns with his face.

## 0.6.1

Puhu settles on your desktop and dresses for the day.

- **On the taskbar**: let go near the taskbar, the desktop Puhu perches on its edge (on a
  first visit too) and keeps to it when the taskbar changes; now and then he walks a few
  steps along it.
- **The desktop Puhu lives a little**: a look round, a yawn and a stretch, a shake of the
  feathers; a fast cursor startles him and a slow stroke over him is petting; carried he
  beats his wings, let go he lands with a puff of feathers; he nods off before he sleeps,
  and asleep a move over him wakes him and a double click still sends him home.
- **Flights**: to and from the island he flies on an arc and shrinks into the island to the
  place and size of the island's Puhu, who takes over from him without a blink.
- **The weather** (General → Weather, type your town): an umbrella in the rain, a scarf in
  the cold, sunglasses in the sun, a small moon on a clear night; rain coming within the
  hour is told once, and the day's highest and lowest once a day. Only the town's
  coordinates go to Open-Meteo, once an hour; nothing at all without a town.
- **What you are busy with**: a mug of coffee while you code, a beret while you draw or
  design, a pencil while you write. Only the program in front is looked at.
- **The hour**, without a sound: on the hour a little door opens in the closed island and
  Puhu bows by the time.
- **Quiet when you are looking**: a turn that ends in the terminal you are looking at shows
  no card and plays no sound; Puhu only nods.
- **Music out of the box**: Now Playing is on in a new install (Spotify, YouTube Music in a
  browser…). The closed island's bars flow at 30 frames a second, and every paced
  animation comes a steady number of screen refreshes apart.
- **Lighter**: Puhu's window rests behind other windows and closes for real, its memory
  with it; the set-aside dictation pill is no longer made; windows nobody sees keep as
  little memory as they can.
- Settings: hiding the island is a switch of its own. In Turkish the version line reads
  "Kullandığın sürüm".

## 0.6.0

Puhu's first version of its own.

- **Puhu**: his own name, owl, colours, icon and sounds; he wears headphones with
  music, a focus band in a Pomodoro and reading glasses while an agent works.
- **Focus play**: points, levels and titles from Pomodoro rounds; the 04:00 day; a
  daily goal; a streak kept by shields; three quests and an egg every day; feathers;
  a weekly race and its leagues; badges; an evening reminder. It can be switched off.
- **Puhu's Nest**: his tree, the numbers, the calendar, the feather shop and every badge.
- **Surprises**: things Puhu notices, some with a secret badge.
- **Game mode**: over a full-screen game Puhu wishes a good game and steps aside until
  it is over; the games are listed in Settings.
- **Ask the screen** (Ctrl+Alt+F): the screen goes to the chat, with quick questions;
  in a game too. Local models (Ollama, LM Studio) get pictures as well.
- **A copied error**: the peek offers "Ask Puhu", and one click opens the chat on it.
- **Guard mode**: while you are away and an agent works, the closed island becomes
  Puhu's lane and he walks up and down it with a lantern; when you are back he is
  startled, the lantern flashes, and he tells you what finished meanwhile.
- **Today** (Ctrl+Alt+B, or the list's tab): write what there is to do ("tomorrow 14:00
  dentist", "friday report") and it lands on its day; what is not done comes along to
  the next one. A written line flies into the list as a slip of paper; a thing done is
  struck through and flies to Puhu as a paper plane. Once a day, the first time you are
  at the computer, a short peek says what there is to do. What waited from earlier
  days gathers dust, and Puhu blows it off as the list opens; in the evening he says how
  the day went and what goes along to tomorrow. The Puhu window has the week: a strip of
  days with a dot for every thing, and the day picked in full.
- Puhu acts out what the island tells: he sips from a battery-shaped juice box as the
  charger goes in, puts up an antenna when the internet goes, smooths his feathers for a
  camera, listens for a microphone, puts on headphones with yours, covers his ears at full
  volume and says "shh" when it is muted or turned all the way down.
- The evening reminder of focus play is a short word once, no longer an ember that stays
  on the closed island.
- Settings: how long the compact island stays before it goes to its smallest.
- The island stays above other windows; a Pomodoro round survives a restart.
- Updates: Puhu asks once whether he may look for new versions on GitHub; after
  that, a new version is one click in the island.
- **Puhu's window** opens on Today and the week; the settings are cards, each a name, a
  line and its control beside it, and the integrations a grid of cards.
- Set aside for now, until they are made for Puhu (the code stays): dictation and the
  Notetaker, « OK Puhu », Outlook sorting and WhatsApp.
- Shortcuts: the defaults no longer sit on keys a Turkish keyboard types with AltGr:
  the waiting card is Ctrl+Alt+J, the terminal Ctrl+Alt+K, mute Ctrl+Alt+H.
- Gone: the Android phone link, the outfits, the Mac and mobile apps, and anything
  that still looked for the app Puhu grew out of (its updates, hooks and data).
