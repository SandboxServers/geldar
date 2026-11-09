import type { Bot } from 'mineflayer';
import { ActionRegistry, type ActionRun, runAction } from '../actions/registry.ts';
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
  readonly view: BodyView;
  readonly reflexRunner: ReflexRunner;
  private readonly ticks: TickSource;
  private readonly timeScale: number;
  private readonly ownedView: { dispose(): void } | null;
  private readonly stopController = new AbortController();
  private unsubscribe: (() => void) | null = null;
  private current: { controller: AbortController; done: Promise<unknown> } | null = null;
  private stopped = false;

  constructor(options: BodyRuntimeOptions) {
    this.lifeId = options.lifeId;
    this.bodyGeneration = options.bodyGeneration;
    this.bot = options.bot;
    this.sink = options.sink;
    this.programs = options.programs ?? new ProgramRegistry();
    this.ticks = options.ticks;
    this.timeScale = options.timeScale ?? 1;
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
    if (this.current) throw new Error('an action is already running');
    const controller = new AbortController();
    const forward = (): void => controller.abort();
    signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted) forward();
    const done = runAction(this.actions, this.bot, action, {
      timeScale: this.timeScale,
      signal: controller.signal,
    });
    this.current = { controller, done };
    try {
      return await done;
    } finally {
      signal?.removeEventListener('abort', forward);
      this.current = null;
    }
  }

  /** True while an action runs. */
  get actionRunning(): boolean {
    return this.current !== null;
  }

  /** Cancels the running action and resolves once it has ended. A no-op when none runs. */
  async cancelAction(): Promise<void> {
    const running = this.current;
    if (!running) return;
    running.controller.abort();
    await running.done.catch(() => undefined);
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
