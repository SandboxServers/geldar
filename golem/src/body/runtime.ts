import type { Bot } from 'mineflayer';
import { ActionRegistry, type ActionRun, runAction } from '../actions/registry.ts';
import type { InflightStore } from './inflight.ts';
import { ProgramRegistry } from './program.ts';
import type { RecordSink } from './records.ts';
import { type Reflex, type ReflexContext, ReflexRunner } from './reflex.ts';
import { allReflexesOn, type ReflexConfig } from './reflex-config.ts';
import { type BodyView, createBodyView } from './view.ts';

/**
 * Where world ticks come from: subscribe a listener, get back the function that unsubscribes. The
 * listener receives the world tick: the world age, advanced by one per client physics tick (20 Hz)
 * between time packets (`watchWorldTicks`), so it is an estimate between packets and strictly increasing.
 * `ConnectionManager.onWorldTick` is the production source.
 */
export type TickSource = (listener: (worldAge: number) => void) => () => void;

/** Longest wall wait (at time scale 1) for an aborted handler to return before the next action. */
const HANDLER_GRACE_MS = 2000;

/** A usable time scale: finite and positive, else 1 (as `runAction` reads it). */
export function sanitiseTimeScale(requested: number | undefined): number {
  return requested !== undefined && Number.isFinite(requested) && requested > 0 ? requested : 1;
}

/**
 * Thrown by `runAction` when another action still holds the one slot. The executor maps it to the
 * `busy` reason, so the agent is told to wait rather than that the body is broken.
 */
export class ActionBusyError extends Error {
  constructor() {
    super('an action is already running');
    this.name = 'ActionBusyError';
  }
}

/** What a `BodyRuntime` is built from. */
export interface BodyRuntimeOptions {
  /** The agent life this Body serves (`life_id`). */
  lifeId: string;
  /** Increments on each Body restart; stamped on every record the Body writes. */
  bodyGeneration: number;
  /** The live bot. A reconnect needs a new runtime for the new bot. */
  bot: Bot;
  ticks: TickSource;
  sink: RecordSink;
  /** The give marker (inflight.ts). Left out, an economic action writes none. */
  inflight?: InflightStore;
  /** The reflexes that exist; the shard config decides which of them run. Default: none. */
  reflexes?: readonly Reflex[];
  /** Default: every reflex on. */
  reflexConfig?: ReflexConfig;
  /** Default: one built from the bot. A caller that passes one also owns its disposal. */
  view?: BodyView;
  /** The programs the executor may start. Default: an empty registry. */
  programs?: ProgramRegistry;
  /** `20 / target TPS`, passed to every action run. Default 1. */
  timeScale?: number;
  /** Check each completed action for a measured effect (`no_effect`). Default true. */
  receipts?: boolean;
}

/**
 * The Body's runtime: identity (`lifeId`, `bodyGeneration`), the one `ActionRegistry`, the empty
 * `ProgramRegistry` (empty unless the options carry one), the record sink, the view, and the reflex loop. The executor, programs and
 * reflexes are built on it and add nothing to its interface except through those registries.
 *
 * The runtime runs at most one action at a time through `runAction`; a reflex (or the executor)
 * may cancel it with `cancelAction`.
 */
export class BodyRuntime {
  readonly lifeId: string;
  readonly bodyGeneration: number;
  readonly bot: Bot;
  /** The one action registry of this Body. */
  readonly actions = new ActionRegistry();
  /** The program registry; empty unless the options carried one. */
  readonly programs: ProgramRegistry;
  readonly sink: RecordSink;
  /** The give marker, or null when the Body keeps none. */
  readonly inflight: InflightStore | null;
  readonly view: BodyView;
  readonly reflexRunner: ReflexRunner;
  private readonly ticks: TickSource;
  /** `20 / target TPS`: scales the wall limits of every action run. */
  readonly timeScale: number;
  private readonly receipts: boolean;
  private readonly ownedView: { dispose(): void } | null;
  private readonly stopController = new AbortController();
  private unsubscribe: (() => void) | null = null;
  private current: {
    controller: AbortController;
    /** The run's result. */
    done: Promise<unknown>;
  } | null = null;
  /**
   * Settles when the handler of the last action ended, or after the grace, whichever is first. Set
   * when an action's run settles; `cancelAction` and `runAction` wait for it, so no action starts
   * while an old handler still drives the bot (a late `pathfinder.stop()`, a window close).
   */
  private winding: Promise<void> | null = null;
  private stopped = false;

  constructor(options: BodyRuntimeOptions) {
    this.lifeId = options.lifeId;
    this.bodyGeneration = options.bodyGeneration;
    this.bot = options.bot;
    this.sink = options.sink;
    this.inflight = options.inflight ?? null;
    this.programs = options.programs ?? new ProgramRegistry();
    this.ticks = options.ticks;
    this.timeScale = sanitiseTimeScale(options.timeScale);
    this.receipts = options.receipts ?? true;
    const tracked = options.view === undefined ? createBodyView(options.bot) : null;
    this.ownedView = tracked;
    this.view = options.view ?? (tracked as BodyView);
    this.reflexRunner = new ReflexRunner({
      reflexes: options.reflexes ?? [],
      config: options.reflexConfig ?? allReflexesOn(),
      view: this.view,
      sink: options.sink,
      lifeId: options.lifeId,
      bodyGeneration: options.bodyGeneration,
      context: (tick) => this.reflexContext(tick),
    });
  }

  /** True between `start()` and `stop()`. */
  get running(): boolean {
    return this.unsubscribe !== null;
  }

  /** Starts the loop: every world tick goes to the reflex runner. A second start is a no-op. */
  start(): void {
    if (this.stopped) throw new Error('body runtime already stopped');
    if (this.unsubscribe) return;
    this.unsubscribe = this.ticks((tick) => {
      this.reflexRunner.onTick(tick).catch((error: unknown) => {
        // The runner records reflex failures itself; reaching here is a bug in the runner or sink.
        console.warn(`reflex runner failed: ${error instanceof Error ? error.message : error}`);
      });
    });
  }

  /** Stops the loop, aborts the running action, and releases the view. Final: it cannot restart. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopController.abort();
    await this.cancelAction();
    this.ownedView?.dispose();
  }

  /**
   * Runs one action through the registry (validation, timeout, abort). Throws when another action
   * is still running: the Body does one thing at a time. `signal` also cancels it, as do
   * `cancelAction` and `stop`.
   */
  async runAction(action: unknown, signal?: AbortSignal): Promise<ActionRun> {
    if (this.stopped) throw new Error('body runtime stopped');
    if (this.current) throw new ActionBusyError();
    if (this.winding) {
      // Only when a handler still winds down: an idle runtime fills the slot before the first await.
      await this.winding;
      if (this.stopped) throw new Error('body runtime stopped');
      if (this.current) throw new ActionBusyError();
    }
    const controller = new AbortController();
    const forward = (): void => controller.abort();
    signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted) forward();
    let handlerEnded: Promise<void> = Promise.resolve();
    const done = runAction(this.actions, this.bot, action, {
      timeScale: this.timeScale,
      signal: controller.signal,
      receipts: this.receipts,
      // Called before runAction's first await, so it is set before the slot is filled.
      onHandler: (ended) => {
        handlerEnded = ended;
      },
    });
    this.current = { controller, done };
    try {
      return await done;
    } finally {
      signal?.removeEventListener('abort', forward);
      this.current = null;
      this.winding = this.windDown(handlerEnded);
    }
  }

  /** True while an action runs. */
  get actionRunning(): boolean {
    return this.current !== null;
  }

  /**
   * Cancels the running action and resolves once its handler has ended (the run result comes
   * back on the abort, but the handler may still be cleaning up: stopping the pathfinder, putting
   * an item back). A handler that ignores the abort is waited for at most `HANDLER_GRACE_MS`
   * (times the time scale). A no-op when none runs.
   */
  async cancelAction(): Promise<void> {
    const running = this.current;
    if (running) {
      running.controller.abort();
      await running.done.catch(() => undefined);
    }
    // After the run settled (here or earlier, by a step's own end) the handler may still run.
    await this.winding;
  }

  /** Waits for `handlerEnded`, at most the grace; clears `winding` when it is still this wait. */
  private windDown(handlerEnded: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, HANDLER_GRACE_MS * this.timeScale);
    });
    const wait: Promise<void> = Promise.race([handlerEnded.catch(() => undefined), grace]).then(
      () => {
        clearTimeout(timer);
        if (this.winding === wait) this.winding = null;
      },
    );
    return wait;
  }

  private reflexContext(tick: number): ReflexContext {
    return {
      bot: this.bot,
      view: this.view,
      registry: this.actions,
      sink: this.sink,
      lifeId: this.lifeId,
      bodyGeneration: this.bodyGeneration,
      tick,
      timeScale: this.timeScale,
      signal: this.stopController.signal,
      cancelAction: () => this.cancelAction(),
    };
  }
}
