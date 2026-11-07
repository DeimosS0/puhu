# Puhu: focus, streaks and play — design

Status: agreed design, not built yet. Decisions taken with the user on 2026-11-05 are
marked **(decided)**; open questions are listed at the end. Change this file before the
code when a rule changes.

## Why anyone would bother

- **Progress you can see.** Every focus round moves a bar and grows something.
- **Something to keep.** A streak you would rather not break, made humane by shields,
  a weekend charm and a repair, so it never turns into anxiety.
- **A companion.** Puhu grows with you, is glad when you come, waits when you don't.
- **Curiosity.** Eggs, secret badges and easter eggs: you never know everything he does.
- **Your choice.** You pick your goal, you can switch any of it off.
- **Healthy.** No lives, no punishment. Breaks earn too; after many rounds Puhu tells
  you to rest and points halve.

## Where it lives

1. **The island, for moments.** First focus of the day, a goal reached, a level, a
   badge: a short celebration, one at a time (a queue, never on top of each other).
2. **Puhu's card, in the open island.** Level and bar, streak, today's goal ring, the
   day's three quests, recent badges.
3. **Puhu's Nest, a page in the app's own window (the hub).** The full picture: the
   tree (below), streak calendar, all badges, wardrobe, weekly race, stats, settings.
   **Built:** `src/hub/pages/nest.ts`, first in the window's sidebar ("Puhu" group),
   opened from the tree button on Puhu's card. The tree (drawn once on a sky for the
   hour), level and title, six numbers (streak and best, rounds and focus time,
   feathers, goal days, shields, this week against last), the last 26 weeks as a
   calendar (a round, the goal, a shield, today), and every badge (earned ones in
   their tier, the next tier's ask, secret ones found plus "???"). It reads the log
   itself when shown; nothing moves on its own.

## Points and what they turn into

- **Wisdom points** (Bilgelik): 25-min focus = 10, 50-min = 20, a finished break +2,
  daily goal +5, quests 5–15. After 8 focus rounds in a day: half points and a rest nudge.
- **Levels:** to go from level n to n+1 takes 50 + 25·(n−1). At ~4 rounds a day:
  level 5 ≈ 5 days, 10 ≈ 3 weeks, 20 ≈ 3 months, 30 ≈ 6 months, 50 ≈ 1.5 years.
  Names: Egg → Chick → Fledgling → … → Wise Owl. Puhu changes a little with tiers
  (fuller feathers, a shine in his eyes, a tiny crown at the top).
- **Points turn into a place: Puhu's tree.** Every finished focus adds a leaf, a goal
  day a blossom, a level a branch, a streak milestone a lantern; seasons follow the
  calendar. The tree is the visible history of your work, shown in the Nest and as a
  small corner in the card. **(decided)**
- **Feathers** (Tüy), the currency: from levels, quests, eggs, streak milestones. Spent
  in the wardrobe (colours, our own accessories, celebration effects, flame variants)
  and on shields. Some rewards only come with levels or badges and can't be bought.
  **Built (the feather shop, in the Nest):** a shield (60, while fewer than two are
  carried) and colours for Puhu's wardrobe: Kum 120, Gül 150, Orman 150, Altın 300 from
  level 10. A purchase is a `spend` fact in the log (balance = earned − spent; colours
  stay owned); a colour bought is worn at once, appears in the right-click wardrobe
  beside Kar and Gece, and the island follows (shared choice, `progress-changed`).

### How the tree is drawn, so it never looks cheap

- In code on a canvas, like Puhu: the same soft rounded shapes and palette, no outlines,
  no clip art, no images.
- Grown, not placed: growth is seeded by the person's own log, so each tree is theirs
  alone and comes out the same every time the log is replayed. A new branch grows where
  there is room and light, so it never looks random or crowded.
- Restraint: a trunk and a few big limbs; leaves as soft clusters, not thousands of
  single leaves. Past a set density clusters get fuller instead of more numerous.
- Motion: a slow sway; after a round, the new leaf unfurls when the Nest opens;
  seasons change over days, not at once; at night the lanterns glow and Puhu sits on a
  branch.
- Proven in the lab before it goes in: day 1, week 1, month 1, six months and two years
  rendered side by side, and approved from those pictures.

## Streak and the flame

- One finished focus in a day keeps the streak (the full goal is not needed).
- **Day starts at 04:00 (decided):** a round finished at 01:00 counts for the day before.
- **Built (2026-11-05):** `core/progress.ts` `moments()` says what a new fact changed
  (the day's first round, the goal, a level, a shield told with the next first round);
  `Island.celebrate` plays them one after another as island peeks after the Pomodoro's
  own (the flame catches and the number turns over like a counter; the goal's ring
  closes and ticks; a star for a level), never over the open island, a full-screen app
  or a presentation. Beside a running Pomodoro: the flame and the streak, an outline
  until the day's first round. The card: a ring of the day's goal round the dial, a
  segment per round, glowing when reached. The evening ember: `emberDue()`, Settings
  "Evening reminder" (`focusReminder`, 20:00, Off). The state refreshes on one timer
  at the next 04:00 or reminder, and when Puhu wakes. A running round survives a
  reload or a restart (kept in localStorage every 10 s).
- **The flame is not always on screen (decided: unobtrusive):**
  - first focus of the day: the flame lights in the island, the number turns like a
    counter, Puhu cheers; then it goes;
  - while a Pomodoro runs: a small still flame and the number next to its ring;
  - evening, once, at the reminder time (20:00 by default, decided) if the day has no
    focus yet: a small ember
    beside Puhu in the closed island (no sound; silent over full screen or a
    presentation; can be switched off);
  - in the card and the Nest, always.
- Flame colour evolves: orange, blue at 30 days, purple at 100, rainbow at 365.
- Milestones 3, 7, 14, 30, 50, 100, 200, 365: badge, feathers, a short celebration.
- **Shield:** saves a missed day; carry at most 2; one free per 7-day streak or bought
  with feathers; next morning a small ice animation says it saved you.
- **Weekend charm** (optional), **holiday mode** (pause a few days), **repair** (missed
  yesterday without a shield: do twice the goal today, once a month).

## Daily goal

Easy (1 round), Regular (2), Serious (4), Intense (6). **Default Regular, asked at first
launch (decided).** A ring around the Pomodoro timer closes and shines when reached. A
perfect week (7/7) is a badge.

## Quests, eggs, monthly challenge

- Three small quests a day ("2 rounds", "45 minutes", "finish a break", "a round before
  10:00", "finish 3 things with Claude"). Each gives feathers and points.
- All three done: an **egg** that hatches into feathers, a shield, a one-hour double
  points potion, or rarely an accessory.
- Monthly challenge ("40 rounds this month"): a collectible badge, different each month.
- **Claude Code work earns no points directly (decided); it only appears in quests.**

### Built (phase 2, step 1)

`src/core/quests.ts`: eight quests (rounds, minutes, breaks, a round before 10:00, one
after 18:00, two in a row, a 50-minute one, three things with Claude); three a day,
picked by the day (seeded) for the goal it began with, so every replay agrees. Each done
is +5 points and +5 feathers; all three hatch the day's egg (seeded): 10-25 feathers
(65 %), a shield (20 %) or an hour of double points (15 %). Claude's turns are written
(`claude` events) only while that quest is open, and only as many as it asks. Feathers
also come from each level (+10) and each streak milestone (+10). Puhu's card shows the
day's quests and egg beside him; the island tells a quest done and hatches the egg.

## Badges and easter eggs

Tiered badges (bronze, silver, gold): streak days, rounds, focus hours, marathon (4 in a
row), ultra (8 in a day), early bird (before 08:00), night owl (after midnight), perfect
week, break master, collector.

**Lots of secret badges and easter eggs (decided), and the list keeps growing:** they are
what makes Puhu sweet. Each one is a trigger, a reaction and often a hidden badge that
shows as "???" in the Nest until found. After a month, an unfound one now and then
leaves a hint ("Puhu sometimes looks at the moon…").

How they are built, so adding one stays cheap: a registry where each egg is one entry
(id, trigger, reaction, badge, rarity). Triggers read the events Puhu already gets
(pokes, music, volume, keys, power, network, clipboard, files, time); reactions reuse a
small set of moves (eyes, wings, props, the island's peek). Eggs never earn points, only
their badge, and never fire over full screen or a presentation.

**Built (phase 2, step 2):** 21 surprises (`src/core/secrets.ts`, reactions in
`Island.surprise`, the time-bound ones in `src/island/surprises.ts`): dizzy, the 1000th
poke, volume 42 and 11, Caps Lock six turns in four seconds, a screenshot, "puhu" /
"hello world" / "rm -rf" / 🦉 copied, 11:11, 13:37, a full moon at 22:00, the Konami
code, charger under 5 %, back after three days, the 20th Settings visit, an edited log,
1 April, 1 January, the 256th day. Reactions always; the badge (`secret.<id>`, violet,
counted apart on the card) only while focus play is on. The rest of the tables below
need drawings (props, the pixel Puhu) or new triggers and come later.

### Touching Puhu

| Trigger | Puhu | Secret badge |
|---|---|---|
| Ten pokes in a few seconds | spiral eyes, wobbles, sits down | Dizzy |
| 1000 pokes in all | rubs his head, then a heart | Best friend |
| Pokes in a rhythm | taps the same rhythm back | Rhythm buddy |
| A poke while he sleeps at night | one eye opens, a grumble, back to sleep | Let sleeping owls lie |
| Five pokes during a focus | a wing to his beak: "shh" | Distraction |
| Double-click | a hop; one time in twenty, a backflip | Backflip |
| Shaken left and right | feathers fly off, he fluffs back up | All shook up |
| Pushed to the island's edge | hangs on by his wings | Cliffhanger |
| Held for 10 s after the card opens | falls asleep in your hand | Lullaby |
| Cursor still on him for 30 s | stares back, then winks | Staring contest |
| One poke in 500 | sneezes out a golden feather | Lucky feather |

### Time and the calendar

| Trigger | Puhu | Secret badge |
|---|---|---|
| 11:11 | closes his eyes and makes a wish, a sparkle | Wish |
| 13:37 | his glasses turn green for a minute | 1337 |
| 12:34 | counts one-two-three-four on his wing | — |
| A round finished at exactly 00:00 | a tiny clock strikes | Midnight |
| A round between 03:00 and 04:00 | yawns, nightcap | The owl's hour |
| A full moon night (computed, no network) | hoots at the moon | Full moon |
| 21 December, the longest night | the happiest owl of the year | Longest night |
| Friday the 13th | knocks on wood | Not today |
| 29 February | a confetti "4" | Once in four years |
| The 256th day of the year | his eyes blink in binary | Programmer's Day |
| A round on Monday before 09:00 | rolls up his sleeves | Monday warrior |
| A round on Friday after 18:00 | looks at you: really? | Overtime |
| A round on Sunday | proud little nod | Weekend hero |
| New Year, Halloween, 1 April | fireworks, a pumpkin, upside down for a moment | one each |
| Lunar New Year, Eid, 23 April (by language) | a red lantern, offers a sweet, child-size Puhu | one each |
| A year since first launch | party hat and a cake | Anniversary |
| Away three days | dusty, then overjoyed | Missed you |

### Music and sound

| Trigger | Puhu | Secret badge |
|---|---|---|
| The same song five times in a row | sings along with closed eyes | On repeat |
| A song with owl, baykuş, puhu or hoot in its title | wings up, delighted | Our song |
| Ten skips in a minute | crossed eyes | Can't decide |
| A song over ten minutes | nods off halfway, wakes for the end | Epic |
| Volume set to exactly 42 | a knowing nod | The answer |
| Volume set to exactly 11 | a wink | This one goes to eleven |
| Volume up and down five times quickly | bobs like a DJ | DJ |
| Volume to 100 / to 0 | covers his ears / "shh" | — |

### Copying, files and downloads

| Trigger | Puhu | Secret badge |
|---|---|---|
| "puhu" copied | blushes | He noticed |
| 🦉 copied | waves at himself | Mirror |
| "hello world" copied | waves back | First program |
| "rm -rf" copied | gasps, covers his eyes | Dangerous waters |
| A colour code copied | his eyes sparkle in that colour | Eye for colour |
| The same text copied five times | rolls his eyes kindly | Ctrl+V master |
| Something very long copied | staggers under the weight | Heavy lifting |
| Ten downloads in a day | carries a tiny stack | Hoarder |
| A file with owl or puhu in its name dropped | stares at it, amazed | Is that me? |
| Twenty PDFs dropped | puts on reading glasses | Bookworm |
| Teased until he sulks, the first time | the sulk | You upset him |
| The file given within 5 s of the sulk | hugs it | Made up |

### The computer

| Trigger | Puhu | Secret badge |
|---|---|---|
| A screenshot while the island is open | strikes a pose (ten in a minute: gold) | Paparazzi |
| Caps Lock on and off three times quickly | jumps at the noise | WHY ARE WE SHOUTING |
| Charger plugged in under 5 % | wipes his brow | Just in time |
| Battery at 1 % | snores, very weakly | Running on fumes |
| Unplugged at 100 % | waves the cable goodbye | — |
| A whole focus round offline | thumbs up | Digital detox |
| Back online after a long time | waves at the returning signal | — |
| Back after an hour with the screen locked | hides, then pops out: "Ce-e!" | Peekaboo |
| The computer wakes from sleep | stretches his wings | — |
| The camera on ten times | straightens his feathers | Camera ready |
| Hiding from screen sharing switched on | a ninja mask for a moment | Secret agent |
| Konami code with the island open | pixel-art Puhu for a minute | Old school |
| Twenty visits to Settings | peeks in with a spanner | Tinkerer |
| Five languages tried | says hello in each | Polyglot |
| Every accessory at once | a twirl | Fashion icon |
| An edited progress file | detective hat, squints | Caught you |

### Focus and the streak

| Trigger | Puhu | Secret badge |
|---|---|---|
| Streak broken, then repaired | the flame rises like a phoenix | From the ashes |
| Seven days at Intense | headband and a cape | Machine |
| A round started exactly on the hour | salutes | Punctual |
| Ten rounds without a single pause | ticks like a clock | Like clockwork |
| Three starts cancelled within a minute | stretches | Warm-up laps |
| The break skipped three times | yawns loudly, points at the break | — (rest is not rewarded by skipping it) |

### Claude (reactions only, never points or badges)

| Trigger | Puhu |
|---|---|
| Claude fails three times in a row | brings a cup of tea |
| A long Claude task done during a focus | thumbs up, without waking you |
| Claude still working after 02:00 | brings you a coffee |
| A permission refused | an approving nod |

### Finding them

| Trigger | Puhu | Secret badge |
|---|---|---|
| Ten secret badges found | unrolls a treasure map | Treasure hunter |
| Every secret badge found | a golden owl outline appears in the Nest | Seen it all |

## Weekly race against your past self

Your rival is your own past weeks ("you beat last week's you"), with leagues from bronze
to diamond relative to your own average. Friends later (below).

**Built (phase 2, step 3):** weeks run from Monday 04:00. Puhu's card shows this week's
points against last week's by the same moment of its week (`race.pace`), on one scale;
the week's first points tell, if last week beat the one before it. **Leagues (built):**
this week's points against the average of the past weeks there have been (up to four),
each counted to the same moment of its week: bronze below 0.6 of it, silver to 0.9,
gold to 1.1 (keeping up), platinum to 1.4, diamond beyond. Shown on the Nest's week
tile and as the colour of "This week" on Puhu's card; none before there is a past week.

## Friends and teams (after the public release, its own module)

**When (decided):** not now. First the single-person game ships and gathers reactions;
friends come when people ask for them, paid for by support if it ever costs anything
(see Funding).

- A shared branch where your team's Puhus sit: a friend in focus wears the headband, a
  finished round sends a feather to the others, a team goal and a team streak.
- Off by default; with it off, nothing of this module touches the network.
- The phone: Puhu has no phone app. The Nest shows a QR code; scanned with a
  phone camera it opens a small web page (served by the same Worker, addable to the
  home screen) to accept an invite and, later, to see the streak and the team branch.
  No app store needed.
- Modules: `progress` (the log and the rules, pure and tested) knows nothing of the
  others; `moments` turns its changes into the island's queue; `social` only reads the
  derived state and publishes the short summary below. Removing `social` changes
  nothing else.

### The server and what it costs

- A Cloudflare Worker with one Durable Object per team (a room), on the owner's own
  personal Cloudflare account, on a free `workers.dev` address (a custom domain is
  optional, about $10 a year).
- Free plan limits per day: 100,000 requests, 100,000 rows written, 5 GB stored. With
  WebSocket hibernation an idle connection costs nothing, and 20 incoming messages count
  as one request. A Puhu sends about 10–20 small messages a day, so roughly 5 requests
  and 20 rows a day per person: the free plan carries a few thousand daily users.
- Past that, the paid plan is $5 a month (1 M requests, 50 M rows written a month
  included), enough for tens of thousands.
- The free plan cannot bill: past a limit, requests fail until 00:00 UTC (03:00 in
  Turkey). Friends show as offline for the rest of the night; everything else in Puhu
  is local and keeps working.

### Security

- No accounts, passwords or e-mail. On joining, each Puhu makes a key pair; the private
  key stays in the Windows Credential Manager, the server keeps only the public key, and
  every message is signed, so nobody can speak as someone else.
- Invites: a long random code that expires in 24 hours. The owner can revoke it and
  remove members; at most 12 people per team; no public list or search, so strangers
  cannot find a team.
- Shared on purpose and nothing else: a nickname, Puhu's colour, today's rounds, the
  streak, "in focus now". Never files, songs, the clipboard, anything of Claude's. No
  history kept on the server, and no logs of who connected.
- The server checks everything: message shape, size (under 512 bytes), rate per member,
  plausibility (a round cannot end before 90 % of its length has passed since its start;
  no more than 24 hours of focus in a day), nickname length and characters.
- Leaving a team deletes your row; a team nobody opens for 30 days deletes itself.
- The server holds no secret to leak, and its code is open with the app's.
- The app treats what comes from the server as untrusted: nicknames are shown as plain
  text with a length cap, never as HTML.

## Funding (after the public release)

GitHub Sponsors: Turkey is a supported region and sponsorships from personal accounts
carry no fee. A `FUNDING.yml` puts a Sponsor button on the repo; Settings and the Nest get
one quiet "support Puhu" link, never a nag. (Ko-fi, Buy Me a Coffee and Patreon pay out
through Stripe, PayPal or Payoneer, which is unclear or unavailable in Turkey: check
before adding one.)

## Badges built so far (phase 1)

`src/core/badges.ts`: On fire (streak 3/7/30), Focused (rounds 10/100/500), Goal getter
(goal days 5/30/100), Perfect week (goal 7 days in a row), Marathon (4 rounds in a row,
each begun within 20 minutes of the last), Ultra (8 in a day), Break master (breaks
10/50/200), Early bird (a round done 04:00-08:00), Night owl (00:00-04:00). Earned ones
are written as `badge` events and announced as a moment. Puhu's titles by level: Owlet,
Fledgling (5), Night watch (10), Apprentice (20), Sage (30), Wise owl (50).

## Poking Puhu vs. opening his card

Tap Puhu = poke (his reactions and easter eggs). Press and hold = his card (a ring fills
round him as you hold). Right-click = wardrobe (as now). The flame or level chip in the
island opens the card too. **Built:** with focus play on, a tap pokes him on release;
held past 0.22 s, an amber ring fills round him in 0.52 s and opens his card
(`views/puhucard.ts`: level, title and bar, streak, today, shields, rounds, the badges
newest first, the daily goal to change). The streak beside the Pomodoro's dots opens it
too. With focus play off, a press pokes him at once, as before.

## First launch (decided: ask, and make it fun)

On Puhu's very first launch (and at each launch until answered), after the flying
hello and once the island is quiet, Puhu asks whether you want to focus with him
(`src/island/focus-intro.ts`, card `src/views/focusintro.ts`).

- Yes → pick a daily goal; Puhu tries each on (Easy winks, Regular is happy, Serious
  puts on his glasses, Intense the headband and raises a wing). OK records the goal,
  turns focus play on and adds the Pomodoro's pill if a slot is free; then "Start the
  first round" or "Later".
- Not now → focus play off: nothing is recorded and none of it shows (no flame, no
  card) until "Focus play" is switched on in Settings.
- Not asked there, to keep it short: the reminder (20:00, changed in Settings) and the
  first egg (comes with eggs, phase 2).
- Declining never locks anything else: the island, music, the Pomodoro and the rest of
  Puhu work the same.

## Data that does not break

- An **append-only event log** (`%APPDATA%\Puhu\progress.log`, `src-tauri/src/progress.rs`):
  facts only ("a 25-min focus ended at 14:25 and ran 24:58 awake", "the goal is now 4",
  "badge earned"), one per line as `<signature> <event JSON>`, each event with a schema
  version. A few KB a month, never leaves the computer unless a team is joined. Shields
  are not events: the rules work out where one was used.
- **Rules are pure, versioned functions** (`src/core/progress.ts`) that replay the log into the state (points,
  level, streak, feathers, quests). Change a rule and everything is recomputed from
  history. Earned badges and rewards are events themselves: never taken back.
- New feature = a new event type and a new rule; old data stays valid.
- Rules return what changed ("level 7", "badge X"); the island plays those moments in a
  queue.
- **Editing the file:** on one's own computer it can't be prevented, only noticed. Each
  line carries an HMAC over the previous line's signature and its event, with a key kept
  in the Windows Credential Manager, so a changed, removed or reordered line is noticed
  (and shown as such). A lost key starts a new chain ("rekey") instead of calling an
  honest log edited. For teams the service never trusts the client alone:
  rounds are reported live (start and end), and impossible numbers are refused.
- Settings: export, reset.
- A focus counts only if at least 90 % of its length ran while the computer was awake
  (a skip never counts; a gap of over 90 s between the timer's ticks is sleep). A break
  earns only after a counted round of the same day, so skipping focus to farm breaks
  earns nothing.
- Recorded only while focus play is on (`focusGame`, asked at first launch).

## Build order

1. Event log, points and levels, streak with the flame moments, daily goal ring,
   shields, core badges, first-launch questions, Puhu's card.
2. Quests, eggs, feathers, wardrobe, secret badges and easter eggs, weekly race, the
   Nest page and the tree.
3. Guard mode feeding in, monthly challenges, Puhu's growth tiers, "your week" card.
4. After the public release: funding, then friends and teams when people ask for them.

## Open questions

- The tree's look, from the lab pictures, before phase 2.
