import { type Action, validateThought } from '@geldar/contract';
import type { Bot } from 'mineflayer';
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
  opts: { timeScale?: number; signal?: AbortSignal; now?: () => number } = {},
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
  // The async call turns a synchronous throw into a rejection, so both paths reach `catch`.
  // The registry keys handlers by verb, so `valid` is the action type this handler takes.
  const typed = handler as ActionHandler;
  // A rejection that arrives after the timeout also lands here; the race has already dropped it, so
  // the warning is the only trace.
  const ran = (async () => typed.run(ctx, valid))().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`action ${valid.do} handler failed: ${message}`);
    return failed('internal', truncate(message));
  });

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
  return finish(outcome, latencyMs, worldTicks);
}

/** Builds the run from an outcome, the latency and the world ticks. */
function finish(outcome: ActionOutcome, latencyMs: number, worldTicks: number | null): ActionRun {
  return { state: recordState(outcome), result: toResult(outcome, latencyMs, worldTicks) };
}

/** `bot.time.age` when it is a finite number, else null. */
function worldAge(bot: Bot): number | null {
  const age: unknown = bot.time?.age;
  return typeof age === 'number' && Number.isFinite(age) ? age : null;
}

/** Cuts an error text to the message limit. */
function truncate(text: string): string {
  return text.slice(0, MESSAGE_LIMIT);
}
