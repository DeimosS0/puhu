// An alarm: a timer that ended, or a thing on Today's list at its time. Like a phone's, it
// rings until it is answered: every few seconds for the first minute, then every half
// minute, and after ten minutes it goes quiet. The card stays until OK; someone coming
// back to the computer after it went quiet hears it once more (island/alarm.ts).

/** Every 5 s for the first minute, every 30 s after, no sound after ten minutes. */
export const RING_FAST_MS = 5_000;
export const FAST_FOR_MS = 60_000;
export const RING_SLOW_MS = 30_000;
export const SOUND_FOR_MS = 600_000;

/** When it rings after ringing at `last`, for an alarm that went off at `since`; null: it has gone quiet. */
export function nextRing(since: number, last: number): number | null {
  const next = last + (last - since < FAST_FOR_MS ? RING_FAST_MS : RING_SLOW_MS);
  return next - since <= SOUND_FOR_MS ? next : null;
}
