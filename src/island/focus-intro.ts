// Focus play's first question (docs/gamification.md, "First launch"): once the
// greeting is over and the island is quiet, Puhu asks whether to focus with him.
// Yes picks a daily goal; "Not now" keeps it all out of sight until Settings turns
// it on. Until it is answered it is the island's waiting card (State.waitingCard):
// nothing but a permission takes its place, a close only folds it, and the island
// opens on it again. The answer is the focusGame setting, null until then; a
// question still unanswered when Puhu quits comes back at the next launch. The
// card is views/focusintro.ts.

import { Bridge } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { POMODORO_ID, Pomodoro } from "../core/pomodoro";
import { DEFAULT_GOAL } from "../core/progress";
import { State } from "../core/state";
import { N_ } from "../i18n/i18n";
import { chooseGoal } from "./progress";

export type IntroStep = "ask" | "goal" | "deal" | "later";

/** What the card needs from the island. */
export interface FocusIntroHost {
  alert(view: IslandViewName): void;
  collapse(): void;
  /** Puhu's answer to a goal picked on the card. */
  reactToGoal(rounds: number): void;
}

/** The daily goals offered, in rounds. */
export const GOALS = [
  { rounds: 1, name: N_("Easy") },
  { rounds: 2, name: N_("Regular") },
  { rounds: 4, name: N_("Serious") },
  { rounds: 6, name: N_("Intense") },
] as const;

/** After the greeting has flown off; then every few seconds while the island is busy. */
const FIRST_DELAY_MS = 1500;
const RETRY_MS = 5000;
const RETRIES = 24;
const QUIET_VIEWS: ReadonlySet<IslandViewName> = new Set(["overview", "empty"]);

class FocusIntroController {
  step: IntroStep = "ask";
  goal: number = DEFAULT_GOAL;
  private host: FocusIntroHost | null = null;
  private started = false;

  /** At launch, once: ask if it was never answered. */
  launch(host: FocusIntroHost) {
    if (this.started || State.settings.focusGame !== null) return;
    this.started = true;
    this.host = host;
    this.openWhenQuiet(0);
  }

  private openWhenQuiet(attempt: number) {
    window.setTimeout(() => {
      if (State.settings.focusGame !== null) return;
      if (!this.quiet()) {
        if (attempt < RETRIES) this.openWhenQuiet(attempt + 1);
        return;
      }
      this.step = "ask";
      State.waitingCard = "focusIntro";
      State.isPinned = true;
      this.host?.alert("focusIntro");
    }, attempt === 0 ? FIRST_DELAY_MS : RETRY_MS);
  }

  private quiet(): boolean {
    if (State.paused || State.pendingApproval) return false;
    return State.mode !== "expanded" || QUIET_VIEWS.has(State.view);
  }

  yes() {
    this.step = "goal";
    this.host?.reactToGoal(this.goal);
    State.notify();
  }

  pick(rounds: number) {
    if (rounds === this.goal) return;
    this.goal = rounds;
    this.host?.reactToGoal(rounds);
    State.notify();
  }

  confirm() {
    // Focus play is the Pomodoro's: its pill joins the island if there is room.
    if (!State.isKept(POMODORO_ID)) State.toggleIntegration(POMODORO_ID);
    this.answer(true);
    void chooseGoal(this.goal);
    this.step = "deal";
    State.notify();
  }

  notNow() {
    this.answer(false);
    this.step = "later";
    State.notify();
  }

  startFirst() {
    Pomodoro.start();
    this.host?.collapse();
  }

  done() {
    this.host?.collapse();
  }

  private answer(on: boolean) {
    State.waitingCard = null;
    State.settings.focusGame = on;
    void Bridge.saveSettings(State.settings);
  }
}

export const FocusIntro = new FocusIntroController();
