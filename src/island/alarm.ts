// The alarm's bell (core/alarm.ts keeps its rhythm): what went off rings until it is
// answered, goes quiet after ten minutes, and rings once more when someone comes back
// to the computer (away.rs alarm_wait_back). One timer at a time; nothing while quiet.

import { nextRing } from "../core/alarm";
import { Bridge } from "../core/bridge";

export interface AlarmHost {
  /** One ring: the sound, what Puhu holds shaking, the card up. `first`: it just went off. */
  ring(first: boolean): void;
}

export class AlarmBell {
  private id: string | null = null;
  private since = 0;
  private timer: number | null = null;
  /** Gone quiet with nobody at the computer: `back` rings it once more. */
  private waitingBack = false;

  constructor(private readonly host: AlarmHost) {}

  /** Rings `id` (a timer's or a Today thing's) from now on, unless it rings already. */
  start(id: string) {
    if (this.id === id) return;
    this.stop();
    this.id = id;
    this.since = Date.now();
    this.host.ring(true);
    this.after(this.since);
  }

  /** Answered: no more rings. */
  stop() {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
    this.id = null;
    this.waitingBack = false;
  }

  /** Someone is back at the computer (the `back` event). */
  back() {
    if (!this.id || !this.waitingBack) return;
    this.waitingBack = false;
    this.host.ring(false);
  }

  private after(last: number) {
    const next = nextRing(this.since, last);
    if (next == null) {
      void this.quiet();
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.host.ring(false);
      this.after(next);
    }, Math.max(0, next - Date.now()));
  }

  private async quiet() {
    const id = this.id;
    const watching = (await Bridge.alarmWaitBack().catch(() => false)) === true;
    if (this.id === id) this.waitingBack = watching;
  }
}
