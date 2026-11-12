import { type Action, validateThought } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { worldAge } from '../world-clock.ts';
import { judge, snapshot, withReceipt } from './effect.ts';
import {
  type ActionOutcome,
  type ActionResult,
  cancelled,
  failed,
  recordState,
  toResult,
} from './outcome.ts';

/** The contract verbs an action can name (`goto`, `mine`, ...). */
export type ActionKind = Action['do'];

/** What a handler gets besides its action: the bot, an abort signal and the wall-time scale. */
export interface ActionContext {
  bot: Bot;
  /** Aborted on timeout or cancel. A handler should stop its work when it fires. */
  signal: AbortSignal;
  /** `20 / target TPS`, default 1. Wall-clock timeouts are multiplied by it. */
  timeScale: number;
}

/** The code that carries out one verb. */
export interface ActionHandler<K extends ActionKind = ActionKind> {
  kind: K;
  /** Wall-clock timeout in milliseconds at timeScale 1. */
  timeoutMs: number;
  run(ctx: ActionContext, action: Extract<Action, { do: K }>): Promise<ActionOutcome>;
}

/**
 * Any one handler. `ActionHandler<K>` for a single verb does not assign to `ActionHandler` (all
 * verbs), so registries and lists hold this union instead; each typed handler still checks its own
 * action type.
 */
export type AnyActionHandler = { [K in ActionKind]: ActionHandler<K> }[ActionKind];

/** Maps each verb to its one handler. */
export class ActionRegistry {
  private readonly handlers = new Map<string, AnyActionHandler>();
  private readonly finishListeners = new Set<(action: unknown, run: ActionRun) => void>();

  /** Adds a handler. Throws if its kind already has one. */
  register(handler: AnyActionHandler): void {
    if (this.handlers.has(handler.kind)) {
      throw new Error(`duplicate action handler for ${handler.kind}`);
    }
    this.handlers.set(handler.kind, handler);
  }

  /** The handler for a verb, or undefined when none is registered. */
  get(kind: string): AnyActionHandler | undefined {
    return this.handlers.get(kind);
  }

  /** The registered verbs, in registration order. */
  kinds(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Calls listener with the action and its run each time runAction ends one on this registry,
   * whoever started it. The action is as passed in, so it may not be valid. Returns the remover.
   */
  onFinished(listener: (action: unknown, run: ActionRun) => void): () => void {
    this.finishListeners.add(listener);
    return () => this.finishListeners.delete(listener);
  }

  /** Tells the onFinished listeners; one that throws does not stop the others. */
  notifyFinished(action: unknown, run: ActionRun): void {
    for (const listener of [...this.finishListeners]) {
      try {
        listener(action, run);
      } catch (error) {
        console.warn(`action listener failed: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

/** What `runAction` produces: the record state and the stored result. */
export interface ActionRun {
  state: 'completed' | 'failed' | 'cancelled';
  result: ActionResult;
}

/** Longest error text kept in a failure message. */
const MESSAGE_LIMIT = 200;
/** Longest delay `setTimeout` accepts. A longer one fires at once, so the timeout is capped here. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Validates one action against the contract, then runs its handler with a wall-clock timeout and
 * an abort signal. The timeout wins over a handler that ignores the signal; a late handler result
 * is dropped. Latency is wall time; world ticks come from `bot.time.age` before and after.
 */
export async function runAction(
  registry: ActionRegistry,
  bot: Bot,
  action: unknown,
  opts: ActionRunOptions = {},
): Promise<ActionRun> {
  const run = await runUnobserved(registry, bot, action, opts);
  registry.notifyFinished(action, run);
  return run;
}

/** What `runAction` takes besides the action. */
export interface ActionRunOptions {
  timeScale?: number;
  signal?: AbortSignal;
  now?: () => number;
  /** Check a completed action against the position, inventory and block it should have changed (`no_effect`). */
  receipts?: boolean;
  /**
   * Called once, before the first await, with a promise that settles when the handler itself has
   * ended. `runAction` may return earlier (an abort or a timeout wins the race), so a caller that
   * must know the handler is done before it starts the next action waits on this.
   */
  onHandler?: (ended: Promise<void>) => void;
}

/** runAction without the onFinished notification. */
async function runUnobserved(
  registry: ActionRegistry,
  bot: Bot,
  action: unknown,
  opts: ActionRunOptions,
): Promise<ActionRun> {
  const verdict = validateThought({ reasoning: 'x', actions: [action] });
  if (!verdict.ok) {
    return finish(failed('invalid_args', truncate(verdict.errors[0] ?? 'invalid action')), 0, 0);
  }
  const valid = action as Action;
  const handler = registry.get(valid.do);
  if (!handler) {
    return finish(failed('unsupported', `no handler for ${valid.do}`), 0, 0);
  }
  if (opts.signal?.aborted) return finish(cancelled(), 0, 0);

  // A zero, negative, NaN or infinite scale would time the action out at once or never: use 1.
  const requested = opts.timeScale ?? 1;
  const timeScale = Number.isFinite(requested) && requested > 0 ? requested : 1;
  const now = opts.now ?? (() => performance.now());
  const controller = new AbortController();
  const timeoutMs = Math.min(handler.timeoutMs * timeScale, MAX_TIMER_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onExternal: (() => void) | undefined;

  const timedOut = new Promise<ActionOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(failed('timeout', `no result within ${timeoutMs} ms`));
    }, timeoutMs);
  });
  const externallyAborted = new Promise<ActionOutcome>((resolve) => {
    onExternal = () => {
      controller.abort();
      resolve(cancelled());
    };
    opts.signal?.addEventListener('abort', onExternal, { once: true });
  });
  const ctx: ActionContext = { bot, signal: controller.signal, timeScale };
  // Clocks are read before the handler starts: a handler may run synchronously up to its first await.
  const startedAt = now();
  const startAge = worldAge(bot);
  const before = snapshot(bot, valid);
  // The async call turns a synchronous throw into a rejection, so both paths reach `catch`.
  // The registry keys handlers by verb, so `valid` is the action type this handler takes.
  const typed = handler as ActionHandler;
  // A rejection that arrives after the timeout also lands here; the race has already dropped it, so
  // the warning is the only trace.
  const ran = (async () => {
    // A bot in a bed does nothing on a move: get up first. Only `sleep` stays in bed.
    if (valid.do !== 'sleep' && bot.isSleeping) await wakeBot(bot);
    return typed.run(ctx, valid);
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`action ${valid.do} handler failed: ${message}`);
    return failed('internal', truncate(message));
  });

  opts.onHandler?.(ran.then(() => undefined));
  let outcome: ActionOutcome;
  try {
    outcome = await Promise.race([ran, timedOut, externallyAborted]);
  } finally {
    clearTimeout(timer);
    if (onExternal) opts.signal?.removeEventListener('abort', onExternal);
  }
  const latencyMs = Math.round(now() - startedAt);
  const endAge = worldAge(bot);
  const worldTicks = startAge === null || endAge === null ? null : endAge - startAge;
  // The receipt: a completed action must have changed the body or the world as it claims.
  const checked =
    opts.receipts === true
      ? withReceipt(
          outcome,
          judge(
            valid,
            before,
            snapshot(bot, valid),
            outcome.status === 'completed' ? outcome.detail : {},
          ),
        )
      : outcome;
  return finish(checked, latencyMs, worldTicks);
}

/** Builds the run from an outcome, the latency and the world ticks. */
function finish(outcome: ActionOutcome, latencyMs: number, worldTicks: number | null): ActionRun {
  return { state: recordState(outcome), result: toResult(outcome, latencyMs, worldTicks) };
}

/** Gets the bot out of bed. A wake that throws is ignored: the handler then reports what it can do. */
async function wakeBot(bot: Bot): Promise<void> {
  try {
    await bot.wake();
  } catch {
    // Ignored on purpose, see above.
  }
}

/** Cuts an error text to the message limit. */
function truncate(text: string): string {
  return text.slice(0, MESSAGE_LIMIT);
}
