# Your week's sky (the weekly card)

Status: built for 0.6.3 (2026-11-10): `src/recap/sky.ts` (the sky, the titles, the kept
weeks), `src/recap/share.ts` (the image), `src/views/recap.ts` (the card: the sky first,
the agents' page when there were agents, sharing), working time in `activity.rs`
(settings `countWork`, asked once on the card). Update this file before the code.

The Monday card stops being an agent report and becomes the week of anyone who uses
Puhu: a night sky with a star for every bit of real work, a title for how the week
went, and an image made to be shared.

## Why anyone would share it

What Spotify Wrapped, Strava and Forest's trees teach:
- **It is about you, not the app**: a title that says who you were this week
  ("Night Owl", "Focus Master"), not a list of counters.
- **One idea per screen**: a title, one sentence, three numbers.
- **Made for a story**: 1080 × 1920, good as it is in an Instagram or WhatsApp status.
- **Against yourself only**: no ranking against others (nothing leaves the computer);
  "your fullest sky", "third week in a row".
- **Never a reproach**: a light week is "A Quiet Week — few stars, but bright".
- **This week only, and never the same twice**: the sky is drawn from the week; the
  cards collect.

Who: students (people preparing for exams already post their daily study hours),
developers (agent time and lines), anyone using Today or focus rounds.

## Stars

A star is a half hour of real work, or a thing done. Counted per half-hour slot of the
week, so nothing is counted twice:

- **A time star**: a half-hour slot where at least 20 minutes were covered by any of a
  focus round (progress.log), an agent working (recap.json) or, only if turned on,
  active work in a coding, design or writing app. Coloured by what covered it most:
  gold focus, indigo code, rose design, sky-blue writing. The "at work" number counts
  every half hour's most covered minutes, starred or not, so nothing is counted twice.
- **A thing-done star**: each Today thing ticked that week, a small mint glint.

Each day's stars make one constellation, Monday on the left; the brightest day is
named. The share image never shows times of day, project names or app names.

## The title

Worked out on the computer from the week, first match wins; each comes with Puhu's
outfit (existing props) and a sentence chosen from a few written ones:

| Title | When | Puhu wears |
|---|---|---|
| Quiet Week | fewer than 6 time stars | the scarf |
| Night Owl | 35 % or more of the time stars between 22:00 and 04:00 | the moon |
| Early Bird | 35 % or more between 05:00 and 10:00 | the mug |
| Focus Master | 60 % or more of the time stars are focus rounds | glasses and the band |
| Marathoner | a run of 6 or more time stars in a row (3 hours) | the band |
| Every Day | time stars on all 7 days | the beret |
| Weekend Hero | 40 % or more on Saturday and Sunday | the headphones |
| Finisher | 15 or more things done | the pencil |
| Steady | anything else | — |

Thresholds are first guesses, tuned on real weeks before release.

## Where the data comes from, and what is new

Already kept, nothing changes: focus rounds (progress.log, until cleared), agent
sessions (recap.json, 4 weeks), Today (14 days for done things).

**New, and only if the user turns it on** ("Count my working time too"):

- **What**: for each half-hour slot of the last 14 days, the minutes of active work in
  three kinds: coding, design, writing. Nothing else: never an app's name, a window's
  title, a key, a page or a file.
- **How**: activity.rs already knows the kind of the program in front (for Puhu's
  props). While a counted kind is in front, once a minute Puhu asks Windows how long
  since the last key or mouse input; under 2 minutes, that minute counts. Locked,
  asleep, in game mode or idle, nothing counts. Nothing runs while no counted app is in
  front.
- **Where**: `%LOCALAPPDATA%\Puhu\activity.json`, in the private folder Puhu already
  uses.
- **How long**: 14 days, slot by slot; then gone.
- **Asked once**: on the first Monday card, a line under it: "Count your working time
  too, for a fuller sky?" [Turn on] [No thanks]. "No thanks" never asks again; the
  switch stays in Settings → Weekly recap.
- **Shown and cleared** in Settings → What Puhu keeps, and a row in PRIVACY.md.

**After the card**: each week's card keeps only its summary (the week, the title, star
counts by kind, the three numbers) for a year, so "your fullest sky", the collection
and a year-end card (the sky of the whole year, late December) work. No slot, hour or
app in it.

## Risks, and what is done about them

| Risk | Answer |
|---|---|
| Someone reads activity.json | Only a program already running as you can; it could read your browser history too. What it would find: when you worked in the last 14 days, in three kinds. No names, no content. |
| Puhu turns into a screen-time tracker | Off by default, only three work kinds, never apps or sites, no daily nagging, no "you were idle" anywhere. |
| A shared image says too much | No times, projects or apps in it; the sentence may name the busiest hour ("23:00"), and the user sees the image before sharing it. |
| A light week feels like failure | The Quiet Week title and its sentences are kind by design. |
| CPU | One check a minute only while a counted app is in front; the card's stars twinkle in once, then nothing moves. |

## The island card

Monday's card: the title and its sentence on top, the week's constellations twinkling
in on the left, the three numbers and Share on the right. For a week with agents, a
second page keeps today's agent card (time, sessions, files, lines, top agent and
project).

## Tests

Slots from overlapping sources count once; the 20-minute rule; each title's threshold
and the order; a week with nothing; the 14-day prune of activity.json; the 12-week
summaries; nothing counted while idle, locked or in game mode; the share image has no
project or app name in it.

## Decided (2026-11-09)

- Counting working time is asked once, on the first Monday card, with what it counts
  said plainly; the user: "sorulsun, açık olsun her şey".
- Weekly summaries are kept for a year, for the year-end card.

## Open questions for the user

1. The titles and their thresholds above (first guesses, tuned on real weeks).
