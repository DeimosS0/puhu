// Frames at a steady pace below the display's: always the same whole number of
// refreshes apart.
//
// Waiting with setTimeout, then asking for a frame, lands on whichever refresh follows
// the timer, and a timer is late by up to ~16 ms (Windows' low-resolution timer, used
// for longer waits and on battery). Folded, the music bars' 12 frames a second came
// 67 to 103 ms apart on a 165 Hz screen, which reads as a stutter however smooth each
// frame is. Here the timer only gets close; frames are then asked for one refresh at a
// time until the one that is due, whose time is a refresh's own.

/** The timer aims at most this much early: a low-resolution one fires up to ~16 ms late. */
const MAX_SLACK_MS = 20;
/** And at least this much, when the timers have been on time. */
const MIN_SLACK_MS = 3;
/** Back-to-back frames, and timers, remembered to learn from. */
const SAMPLES = 20;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export class Pace {
  /** One refresh of the display the page is on, ms: the usual gap between back-to-back frames. */
  vsync = 1000 / 60;
  private gaps: number[] = [];
  /** How late the timers fired, ms: the fewer, the fewer frames asked for in vain. */
  private lates: number[] = [];
  /** Refreshes between two frames, per pace: kept until the refresh changes for real. */
  private counts = new Map<number, number>();

  /**
   * Calls `run` with the frame time of the refresh `frameMs` after `last` (rounded to
   * whole refreshes). `last` is the time of the frame calling this, or an older one.
   * Returns what cancels it.
   */
  after(last: number, frameMs: number, run: (now: number) => void): () => void {
    const due = last + (this.refreshes(frameMs) - 0.5) * this.vsync;
    let prev = -1;
    let cancelled = false;
    let timer: number | undefined;
    const tick = (t: number) => {
      if (cancelled) return;
      // A page without real frames (a test's stand-in) gives no time: draw now.
      if (typeof t !== "number") return run(performance.now());
      if (prev >= 0) this.learn(t - prev);
      if (t >= due) return run(t);
      prev = t;
      requestAnimationFrame(tick);
    };
    const slack = this.lates.length
      ? Math.min(MAX_SLACK_MS, Math.max(MIN_SLACK_MS, Math.max(...this.lates) + 2))
      : MAX_SLACK_MS;
    const wait = due - performance.now() - slack;
    if (wait > 0) {
      const at = performance.now() + wait;
      timer = window.setTimeout(() => {
        this.lates.push(Math.max(0, performance.now() - at));
        if (this.lates.length > SAMPLES) this.lates.shift();
        requestAnimationFrame(tick);
      }, wait);
    } else {
      // Asked from the frame at `last` itself, the first gap is a refresh too.
      if (performance.now() - last < this.vsync) prev = last;
      requestAnimationFrame(tick);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }

  /** Whole refreshes for `frameMs`; 30 fps on a 165 Hz screen is 5.5 of them, so a pace
   *  keeps its count while the refresh learnt wobbles by a hair. */
  private refreshes(frameMs: number): number {
    const exact = frameMs / this.vsync;
    let n = this.counts.get(frameMs);
    if (n == null || Math.abs(exact - n) > 0.6) {
      n = Math.max(1, Math.round(exact));
      this.counts.set(frameMs, n);
    }
    return n;
  }

  private learn(gap: number) {
    if (gap <= 2 || gap >= 50) return;
    this.gaps.push(gap);
    if (this.gaps.length > SAMPLES) this.gaps.shift();
    // Frame times wobble by a fraction of a refresh, and a gap may span two.
    this.vsync = median(this.gaps);
  }
}
