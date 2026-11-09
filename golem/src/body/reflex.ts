import type { Bot } from 'mineflayer';
import { errorText } from '../actions/outcome.ts';
import type { ActionRegistry } from '../actions/registry.ts';
import type { RecordSink } from './records.ts';
import { isReflexEnabled, type ReflexConfig, type ReflexName } from './reflex-config.ts';
import type { BodyView } from './view.ts';

/** The values a `check` found, kept in the `reflex_fired` record (plain JSON scalars). */
export type Trigger = Record<string, string | number | boolean | null>;

/** How a reflex run ended. `abandoned` means it gave up on purpose (for example no alternate route). */
export interface ReflexOutcome {
  result: 'handled' | 'failed' | 'abandoned';
  detail?: string;
}

/** What `run` gets: the bot to act through, and the runtime's hooks. */
export interface ReflexContext {
  bot: Bot;
  view: BodyView;
  registry: ActionRegistry;
  sink: RecordSink;
  lifeId: string;
  bodyGeneration: number;
  /** World age of the tick that fired this reflex. */
  tick: number;
  /** The runtime's time scale: pass it to every action and scale fixed wall-clock limits by it. */
  timeScale: number;
  /** Aborted when the runtime stops; a reflex should end its work promptly then. */
  signal: AbortSignal;
  /**
   * Cancels the action that is running (the intent's current step) and resolves once it has
   * ended. A no-op when none runs. A reflex calls it before acting when its work would clash.
   */
  cancelAction(): Promise<void>;
}

/**
 * One reflex (spec 5.2): something the Body does without asking the Mind, then reports.
 * `check` is cheap and synchronous: it only reads the view. `run` does the work.
 */
export interface Reflex {
  readonly name: ReflexName;
  /** Higher runs first when several reflexes trigger on the same tick. */
  readonly priority: number;
  /** World ticks after a firing before this reflex may fire again. */
  readonly cooldownTicks: number;
  /** The trigger values when the reflex should fire now, else null. */
  check(view: BodyView): Trigger | null;
  /** Does the work. A throw is recorded as a failed outcome, never propagated. */
  run(trigger: Trigger, ctx: ReflexContext): Promise<ReflexOutcome>;
}

/** What the runner needs from its owner. */
export interface ReflexRunnerOptions {
  reflexes: readonly Reflex[];
  config: ReflexConfig;
  view: BodyView;
  sink: RecordSink;
  lifeId: string;
  bodyGeneration: number;
  /** Builds the context for one firing. The runtime supplies the bot, registry and cancel hook. */
  context(tick: number): ReflexContext;
}

/**
 * Runs the enabled reflexes. On each world tick it takes the highest-priority reflex that is off
 * cooldown and whose `check` fires, and runs that one; only one reflex runs at a time, and ticks
 * that arrive meanwhile are skipped. A disabled reflex is never checked. Cooldown counts from the
 * tick the reflex fired. Each firing writes one `reflex_fired` record when it ends.
 */
export class ReflexRunner {
  private readonly ordered: Reflex[];
  private readonly lastFired = new Map<ReflexName, number>();
  private running: Promise<void> | null = null;

  private readonly opts: ReflexRunnerOptions;

  constructor(opts: ReflexRunnerOptions) {
    this.opts = opts;
    const names = new Set<string>();
    for (const reflex of opts.reflexes) {
      if (names.has(reflex.name)) throw new Error(`duplicate reflex ${reflex.name}`);
      names.add(reflex.name);
    }
    // Array.prototype.sort is stable: equal priorities keep the order they were given in.
    this.ordered = [...opts.reflexes].sort((a, b) => b.priority - a.priority);
  }

  /** True while a reflex is running. */
  get busy(): boolean {
    return this.running !== null;
  }

  /**
   * Handles one world tick. Resolves when the reflex it started (if any) has ended, so callers
   * and tests may await it; the runtime does not.
   */
  onTick(tick: number): Promise<void> {
    if (this.running) return this.running;
    for (const reflex of this.ordered) {
      if (!isReflexEnabled(this.opts.config, reflex.name)) continue;
      const last = this.lastFired.get(reflex.name);
      if (last !== undefined && tick - last < reflex.cooldownTicks) continue;
      let trigger: Trigger | null;
      let checkError: unknown;
      try {
        trigger = reflex.check(this.opts.view);
      } catch (error) {
        // A throwing check is a bug in the reflex: record it once per cooldown, do not retry every tick.
        trigger = {};
        checkError = error;
      }
      if (trigger === null) continue;
      this.lastFired.set(reflex.name, tick);
      const run = this.fire(reflex, trigger, tick, checkError).finally(() => {
        this.running = null;
      });
      this.running = run;
      return run;
    }
    return Promise.resolve();
  }

  private async fire(
    reflex: Reflex,
    trigger: Trigger,
    tick: number,
    checkError: unknown,
  ): Promise<void> {
    let outcome: ReflexOutcome;
    try {
      if (checkError !== undefined) throw checkError;
      outcome = await reflex.run(trigger, this.opts.context(tick));
    } catch (error) {
      outcome = { result: 'failed', detail: errorText(error) };
    }
    this.opts.sink.reflexFired({
      name: reflex.name,
      lifeId: this.opts.lifeId,
      bodyGeneration: this.opts.bodyGeneration,
      tick,
      trigger,
      outcome,
    });
  }
}
