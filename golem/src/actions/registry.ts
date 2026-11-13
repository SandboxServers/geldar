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
import { DEFAULT_DIAG_SINK, type DiagSink } from './stall-diag.ts';

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
 * Actions that leave a sleeper in bed: `sleep` itself, `wait` (passing the night needs the sleepers
 * in bed) and `note` (no world effect). Every other action wakes the bot first.
 */
const STAYS_IN_BED: ReadonlySet<ActionKind> = new Set<ActionKind>(['sleep', 'wait', 'note']);
/** How long a wake is waited for when the server's update does not arrive first. */
const WAKE_CONFIRM_MS = 1_000;

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
  logFailure(opts.failureSink ?? DEFAULT_DIAG_SINK, bot, action, run);
  registry.notifyFinished(action, run);
  return run;
}

/** What `runAction` takes besides the action. */
export interface ActionRunOptions {
  timeScale?: number;
  signal?: AbortSignal;
  now?: () => number;
  /** Where a failed action's log line goes. Defaults to the Body's stdout log. */
  failureSink?: DiagSink;
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
    // A bot in a bed does nothing on a move: get up first. See STAYS_IN_BED for the actions that do not.
    if (!STAYS_IN_BED.has(valid.do) && bot.isSleeping) await wakeBot(bot);
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

/**
 * Gets the bot out of bed. `bot.wake()` only sends the request: `isSleeping` clears when the server's
 * update arrives, so this waits for the 'wake' event or WAKE_CONFIRM_MS, whichever comes first. A wake
 * that throws is ignored: the handler then reports what it can do.
 */
async function wakeBot(bot: Bot): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onWake: (() => void) | undefined;
  const confirmed = new Promise<void>((resolve) => {
    onWake = () => resolve();
    timer = setTimeout(resolve, WAKE_CONFIRM_MS);
    bot.once('wake', onWake);
  });
  try {
    await bot.wake();
    await confirmed;
  } catch {
    // Ignored on purpose, see above.
  } finally {
    clearTimeout(timer);
    if (onWake) bot.removeListener('wake', onWake);
  }
}

/** Cuts an error text to the message limit. */
function truncate(text: string): string {
  return text.slice(0, MESSAGE_LIMIT);
}

/** Longest kept text of one argument; a longer one is cut. */
const ARG_LIMIT = 80;
/** A failure line longer than this loses its args to a cut. */
const FAILURE_LINE_LIMIT = 400;
/** A failure with the same verb, reason and message as one logged this recently is counted, not logged. */
const FAILURE_REPEAT_MS = 2_000;
/** Distinct failure keys remembered per bot; the least recently logged is forgotten past this. */
const FAILURE_KEYS_PER_BOT = 200;

/** When one failure key was last logged, and how many repeats were suppressed since. */
interface FailureKey {
  last: number;
  repeats: number;
}

/** Per bot, the failure keys seen. A WeakMap, so a bot that goes away takes its keys with it. */
const failureKeys = new WeakMap<object, Map<string, FailureKey>>();

/**
 * Writes one JSON line for a failed or cancelled action: the verb, its arguments (cut), the reason,
 * the full message, the position and the wall time. Repeats of one (verb, reason, message) within
 * FAILURE_REPEAT_MS of the last logged line are counted and reported as `repeats` on the next one.
 * It only logs: the run it is given is not changed.
 */
function logFailure(sink: DiagSink, bot: Bot, action: unknown, run: ActionRun): void {
  if (run.state === 'completed') return;
  const source =
    typeof action === 'object' && action !== null ? (action as Record<string, unknown>) : {};
  const verb = typeof source.do === 'string' ? source.do : 'unknown';
  const reason = run.state === 'cancelled' ? 'cancelled' : (run.result.reason ?? 'unknown');
  const message = run.result.message ?? '';
  const now = sink.now();

  let keys = failureKeys.get(bot);
  if (!keys) {
    keys = new Map<string, FailureKey>();
    failureKeys.set(bot, keys);
  }
  const key = `${verb}\u0000${reason}\u0000${message}`;
  const seen = keys.get(key);
  if (seen && now - seen.last < FAILURE_REPEAT_MS) {
    seen.repeats += 1;
    return;
  }
  const repeats = seen?.repeats ?? 0;
  keys.delete(key);
  keys.set(key, { last: now, repeats: 0 });
  while (keys.size > FAILURE_KEYS_PER_BOT) {
    const oldest = keys.keys().next().value;
    if (oldest === undefined) break;
    keys.delete(oldest);
  }

  const position = bot.entity?.position;
  const line: Record<string, unknown> = {
    event: 'action_failed',
    do: verb,
    args: compactArgs(source),
    reason,
    message,
    pos: position ? { x: round2(position.x), y: round2(position.y), z: round2(position.z) } : null,
    ms: run.result.latency_ms,
  };
  if (repeats > 0) line.repeats = repeats;
  if (JSON.stringify(line).length > FAILURE_LINE_LIMIT) {
    line.args = { cut: JSON.stringify(line.args).slice(0, ARG_LIMIT) };
  }
  sink.log(JSON.stringify(line));
}

/** The arguments without `do`, each string cut to ARG_LIMIT. */
function compactArgs(source: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(source)) {
    if (name === 'do') continue;
    args[name] = typeof value === 'string' ? value.slice(0, ARG_LIMIT) : value;
  }
  return args;
}

/** A coordinate to two decimals, enough for a block position and short in the log. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
