// The island's side of timers (core/timer.ts): a second hand only while one runs (for the
// time the island shows), one wake-up at the soonest end, and the ring. Nothing runs when
// no timer does.

import { Timers, type Timer } from "../core/timer";

export interface TimerHost {
  /** A second has gone: the island shows the time left. */
  tick(): void;
  /** One has ended and nobody has said OK to it yet. */
  ring(timer: Timer): void;
}

export class TimerClock {
  private ticker: number | null = null;
  private wake: number | null = null;

  constructor(private readonly host: TimerHost) {}

  /** The soonest one still running. */
  running(now = Date.now()): Timer | null {
    return Timers.all().find((t) => t.endsAt > now) ?? null;
  }

  /** After any change to the timers (and at launch): the second hand, the next wake-up, a ring due. */
  sync() {
    const now = Date.now();
    const all = Timers.all();
    const running = all.filter((t) => t.endsAt > now);
    if (running.length > 0 && this.ticker == null) this.ticker = window.setInterval(() => this.host.tick(), 1000);
    if (running.length === 0 && this.ticker != null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
    if (this.wake != null) window.clearTimeout(this.wake);
    this.wake = null;
    if (running[0]) this.wake = window.setTimeout(() => this.sync(), running[0].endsAt - now + 20);
    const rung = all.find((t) => t.endsAt <= now);
    if (rung) this.host.ring(rung);
    this.host.tick();
  }
}
