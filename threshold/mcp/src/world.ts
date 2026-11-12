import { createHash } from 'node:crypto';
import { newId } from '@geldar/animus/src/ids.ts';
import { buildPlan } from '@geldar/animus/src/loop/plan.ts';
import type { OutputValidator } from '@geldar/animus/src/ports/index.ts';
import type {
  PlanMessage,
  SayInput,
  Snapshot,
  SovereignCallPayload,
  Thought,
  WaitInput,
} from '@geldar/contract';
import {
  type ImageToolResult,
  type ToolContext,
  ToolError,
  type ToolHandler,
  type ToolHandlers,
  type WakeConfig,
} from '@geldar/mcp-mock';
import type { RunState } from './events/mapper.ts';
import { FailureTracker } from './failures/tracker.ts';
import { TOOL_OUTCOMES } from './http/log.ts';
import {
  type AgentProfiles,
  type BodyGateway,
  BodyUnavailable,
  type BudgetLedger,
  type CallRecorder,
  type Clock,
  type DeathMarks,
  type JournalStore,
  type PlayerDirectory,
  type PlayerEventLog,
  type PresenceStore,
  type RateLimiter,
  type SleepMarks,
} from './ports.ts';
import type { KvPresenceStore } from './presence.ts';
import { bestEffortPresence, causeOf, rateLimitedPresenceLog } from './presence-write.ts';
import { type ActArgs, ActToolError, actTool } from './tools/act.ts';
import { JOURNAL_LINE_LIMIT, journalTool } from './tools/journal.ts';
import { lookTool, type ToolCall } from './tools/look.ts';
import { readBookTool } from './tools/read-book.ts';
import { sayTool } from './tools/say.ts';
import { SEE_REFUSALS, type SeeDeps, type SeeOutcome, seeTool } from './tools/see.ts';
import { type SleepDeps, sleepTool } from './tools/sleep.ts';
import { statusTool } from './tools/status.ts';
import { type NotAvailableTool, notAvailableTool } from './tools/unavailable.ts';
import { viewTool } from './tools/view.ts';
import { createWaitState, type WaitError, type WaitState, wait } from './tools/wait.ts';

/** The fixed messages the handlers add. None echoes world text or names an observer (decision 0059). */
export const BODY_RETRY_AFTER_S = 5;
export const BODY_UNAVAILABLE_MESSAGE =
  `Your body is waking. Try again in about ${BODY_RETRY_AFTER_S} seconds.` as const;
export const UNKNOWN_PLAYER_MESSAGE = 'No player is bound to this session.' as const;

/** How often the world settles the presence of every life it has seen (dim, then hibernate). */
export const SETTLE_MS = 10_000;

const WAIT_MESSAGES: Record<WaitError, string> = {
  bad_cursor: 'The cursor is not one this player was given.',
  bad_max_seconds: 'max_seconds must be a whole number of seconds, at least 5.',
  body_unavailable: BODY_UNAVAILABLE_MESSAGE,
  session_superseded: 'The session ended, so the wait stopped.',
  wait_replaced: 'A newer wait for this player replaced this one.',
};

/** The refusal of a journal line inside the player's journal spacing (`journal_min_seconds`). */
const JOURNAL_RATE_MESSAGE = 'Journal lines are spaced. Wait, then write again.';

/** The thought a sleep plan carries: one `sleep` action and no words. */
const SLEEP_THOUGHT = { reasoning: 'sleep', actions: [{ do: 'sleep' }] } as Thought;

/** Everything the world's handlers reach. Each tool function takes the subset it needs. */
export interface WorldDeps {
  players: PlayerDirectory;
  body: BodyGateway;
  budget: BudgetLedger;
  /** Act budget enforcement (decision 0149). Off by default: every act is metered, none is refused. */
  enforce?: boolean;
  sleeps: SleepMarks;
  /** The death count of each life (migration 0023): `status` reads it for `life`. */
  deaths: DeathMarks;
  profiles: AgentProfiles;
  journal: JournalStore;
  recorder: CallRecorder;
  events: PlayerEventLog;
  /** Presence per life; `settle` is called by the world's timer, `lifeIds` seeds it at start. */
  presence: PresenceStore & Pick<KvPresenceStore, 'settle' | 'lifeIds'>;
  limiter: RateLimiter;
  validator: OutputValidator;
  clock: Clock;
  /** The running intent per life, as the event mapper keeps it. */
  runs: Map<string, RunState>;
  /** The wake policy's timing settings. */
  wake: WakeConfig;
  /** `plan.expires_after_ticks` from the config. */
  expiresAfterTicks: number;
  /** `sovereign.mcp.max_result_bytes`: the largest `wait` result after trimming. Default 16384. */
  maxResultBytes?: number | undefined;
  /** `sovereign.mcp.wait_cap_seconds`: the longest `wait` in seconds. Default 240. */
  waitCapSeconds?: number | undefined;
  /** The laws in force, as sign lines, for `status`. */
  laws: readonly string[];
  /** Receives the cause of a presence write that failed; the call goes on without it. */
  log?: (line: Record<string, unknown>) => void;
  /** Counts each tool call with its closed outcome code and duration (metrics, decision 0088). */
  onToolCall?: (tool: string, outcome: string, durationMs: number) => void;
}

/** The world as the server uses it: the tool handlers, and a `close` that stops the settle timer. */
export interface World {
  tools: ToolHandlers;
  close(): void;
}

/** The deps plus what the world keeps for itself: the clock as `now`, the lives it has seen, the waits. */
type Wired = WorldDeps & {
  now: () => number;
  lives: Set<string>;
  waitState: WaitState;
  failures: FailureTracker;
  /** `deps.log` behind the per-kind rate limit: presence and settle failures, once a minute each. */
  presenceLog: (line: Record<string, unknown>) => void;
};

type Run = (call: ToolCall, input: unknown, ctx: ToolContext) => unknown;

/** The player comes from the bound session, never from the arguments. */
async function callerOf(deps: Wired, ctx: ToolContext): Promise<ToolCall> {
  const player = await deps.players.find(ctx.playerId);
  if (player === null) throw new ToolError('unknown_player', UNKNOWN_PLAYER_MESSAGE);
  deps.lives.add(player.lifeId);
  return { playerId: ctx.playerId, lifeId: player.lifeId };
}

/** The fixed messages for the `see` codes that carry no detail (refusals come from SEE_REFUSALS). */
const SEE_MESSAGES = {
  invalid_input: 'see takes an optional width and height in pixels, and no other input.',
  session_closed: 'The session ended, so no picture was taken.',
  body_unavailable: BODY_UNAVAILABLE_MESSAGE,
} as const;

/** The picture, or a typed ToolError for each failure: a failed `see` is never returned as data. */
async function seeOf(deps: SeeDeps, call: ToolCall, input: unknown): Promise<ImageToolResult> {
  const outcome: SeeOutcome = await seeTool(deps, call, input);
  if ('picture' in outcome) return outcome.picture;
  if (outcome.error === 'view_unavailable') {
    throw new ToolError('view_unavailable', SEE_REFUSALS[outcome.detail]);
  }
  throw new ToolError(
    outcome.error,
    SEE_MESSAGES[outcome.error],
    outcome.error === 'body_unavailable' ? BODY_RETRY_AFTER_S : undefined,
  );
}

/**
 * A Body that does not answer becomes the `body_unavailable` tool error, and an act or say fault
 * becomes its own code; other faults pass on.
 */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof BodyUnavailable) {
      throw new ToolError('body_unavailable', BODY_UNAVAILABLE_MESSAGE, BODY_RETRY_AFTER_S);
    }
    if (err instanceof ActToolError) throw new ToolError(err.code, err.message);
    throw err;
  }
}

/**
 * Every bound call keeps its life awake (spec 5.15.3: any call within 60 s), and a call that meets
 * an unanswering Body asks for it up, so the next call finds the Body starting.
 */
function bound(deps: Wired, run: Run, readOnly = false): ToolHandler {
  return (input, ctx) =>
    guarded(async () => {
      const call = await callerOf(deps, ctx);
      await bestEffortPresence(deps.presenceLog, () => deps.presence.touch(call.lifeId));
      try {
        return await run(call, input, ctx);
      } catch (err) {
        if (err instanceof BodyUnavailable) {
          await bestEffortPresence(deps.presenceLog, () =>
            deps.presence.wantBody(call.lifeId, deps.now()),
          );
          // The Body may have come up while the call waited: look again before saying it is waking.
          // Only a read repeats; an act or say may already have reached the Body.
          if (readOnly && (await bodyAnswers(deps.body, call.lifeId))) {
            return await run(call, input, ctx);
          }
        }
        throw err;
      }
    });
}

/** True when the Body answers a snapshot now. */
async function bodyAnswers(body: BodyGateway, lifeId: string): Promise<boolean> {
  try {
    await body.snapshot(lifeId);
    return true;
  } catch {
    return false;
  }
}

/** One `wait` for the bound life. The session's abort ends it; the keepalive is the session's own. */
async function waitTool(deps: Wired, call: ToolCall, input: WaitInput, ctx: ToolContext) {
  const outcome = await wait(
    {
      maxResultBytes: deps.maxResultBytes,
      waitCapSeconds: deps.waitCapSeconds,
      clock: deps.clock,
      keepAlive: { start: () => () => undefined },
      log: deps.events,
      body: deps.body,
      budget: deps.budget,
      sleeps: deps.sleeps,
      runs: deps.runs,
      config: deps.wake,
      state: deps.waitState,
      failures: deps.failures,
      presenceLog: deps.presenceLog,
      wantBody: (lifeId) => deps.presence.wantBody(lifeId, deps.now()),
      touchPresence: async (lifeId) => {
        deps.lives.add(lifeId);
        await deps.presence.touch(lifeId);
      },
    },
    {
      lifeId: call.lifeId,
      maxSeconds: input.max_seconds,
      signal: ctx.signal,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.interests === undefined ? {} : { interests: input.interests }),
    },
  );
  if (!outcome.ok) {
    throw new ToolError(
      outcome.error,
      WAIT_MESSAGES[outcome.error],
      outcome.error === 'body_unavailable' ? BODY_RETRY_AFTER_S : undefined,
    );
  }
  return outcome.result;
}

/** The sleep plan: one `sleep` action, built from the snapshot the Body just sent. */
function sleepPlanOf(expiresAfterTicks: number) {
  return (_lifeId: string, snapshot: Snapshot): PlanMessage =>
    buildPlan({ thought: SLEEP_THOUGHT, thoughtId: newId('th'), snapshot, expiresAfterTicks });
}

/**
 * Mirrors one journal line and records the call (spec 5.15.3: journal publishes a sovereign_call). A line
 * inside the player's journal spacing is refused before anything is written or recorded.
 */
async function journalAndRecord(deps: Wired, call: ToolCall, text: string) {
  const started = deps.now();
  if (!deps.limiter.take(`journal:${call.lifeId}`, started).allowed) {
    throw new ToolError('rate_limited', JOURNAL_RATE_MESSAGE);
  }
  const result = await journalTool(deps, call, { text });
  const balance = await deps.budget.balance(call.lifeId, started);
  // The event carries the length and a hash of the kept text, never the text (the journal table has it).
  const kept = text.slice(0, JOURNAL_LINE_LIMIT);
  const record: SovereignCallPayload = {
    player_id: call.playerId,
    tool: 'journal',
    outcome: 'ok',
    accepted: [0],
    rejected: [],
    credits_charged: 0,
    budget_remaining: Math.max(0, Math.floor(balance)),
    latency_ms: Math.max(0, deps.now() - started),
    journal_chars: kept.length,
    journal_sha256: createHash('sha256').update(kept).digest('hex').slice(0, 16),
  };
  await deps.recorder.record(record);
  return result;
}

/**
 * Starts the settle timer: every `SETTLE_MS` on the injected clock, each life seen so far is settled,
 * so an awake life dims and then hibernates with no call. The lives already in the bucket count as
 * seen, so a life awake before a restart settles too. A failed write is retried on the next tick.
 */
function startSettle(deps: Wired): () => void {
  const stop = new AbortController();
  const seedLives = async (): Promise<boolean> => {
    try {
      for (const lifeId of await deps.presence.lifeIds()) deps.lives.add(lifeId);
      return true;
    } catch (err) {
      deps.presenceLog({ event: 'settle_error', cause: causeOf(err) });
      return false;
    }
  };
  const tick = async (): Promise<void> => {
    let seeded = false;
    for (;;) {
      if (!seeded) seeded = await seedLives();
      try {
        await deps.clock.sleep(SETTLE_MS, stop.signal);
      } catch {
        return;
      }
      for (const lifeId of deps.lives) {
        await deps.presence.settle(lifeId).catch((err: unknown) => {
          deps.presenceLog({ event: 'settle_error', cause: causeOf(err) });
          return null;
        });
      }
    }
  };
  void tick();
  return () => stop.abort();
}

/**
 * The 15 tool handlers of the real world and the settle timer. Each handler runs its tool function
 * against the Body and the stores; the player comes from the bound session.
 */
export function createWorld(deps: WorldDeps): World {
  const wired: Wired = {
    ...deps,
    now: () => deps.clock.nowMs(),
    lives: new Set(),
    waitState: createWaitState(),
    failures: new FailureTracker(),
    presenceLog: rateLimitedPresenceLog(deps.log, () => deps.clock.nowMs()),
  };
  const unavailable = (tool: NotAvailableTool): ToolHandler =>
    bound(wired, (call) => notAvailableTool(wired, call, tool));
  const sleepDeps: SleepDeps = {
    body: wired.body,
    events: wired.events,
    journal: wired.journal,
    marks: wired.sleeps,
    now: wired.now,
    failures: wired.failures,
    buildSleepPlan: sleepPlanOf(wired.expiresAfterTicks),
  };
  const stopSettle = startSettle(wired);
  const tools: ToolHandlers = {
    act: bound(wired, (call, input) => actTool(wired, call, input as ActArgs)),
    say: bound(wired, (call, input) => sayTool(wired, call, (input as SayInput).text)),
    sleep: bound(wired, (call) => sleepTool(sleepDeps, call)),
    wait: bound(wired, (call, input, ctx) => waitTool(wired, call, input as WaitInput, ctx)),
    look: bound(wired, (call) => lookTool(wired, call), true),
    status: bound(wired, (call) => statusTool(wired, call), true),
    journal: bound(wired, (call, input) =>
      journalAndRecord(wired, call, (input as { text: string }).text.slice(0, JOURNAL_LINE_LIMIT)),
    ),
    read_book: bound(wired, (call) => readBookTool(wired, call)),
    view: bound(wired, (call, input, ctx) =>
      viewTool(
        {
          view: (lifeId, size) => wired.body.view(lifeId, size),
          budget: wired.budget,
          isOpen: () => !ctx.signal.aborted,
        },
        call,
        input,
      ),
    ),
    see: bound(wired, (call, input, ctx) =>
      seeOf(
        {
          see: (lifeId, size) => wired.body.see(lifeId, size),
          budget: wired.budget,
          isOpen: () => !ctx.signal.aborted,
        },
        call,
        input,
      ),
    ),
    write_book: unavailable('write_book'),
    define_skill: unavailable('define_skill'),
    use_skill: unavailable('use_skill'),
    offer: unavailable('offer'),
    propose: unavailable('propose'),
    vote: unavailable('vote'),
  };
  const logTools = Object.fromEntries(
    Object.entries(tools).map(([name, run]) => [name, logged(wired, name, run)]),
  ) as ToolHandlers;
  return { tools: logTools, close: stopSettle };
}

/** The outcome code of a failed call: the tool's own code when it is a closed one, otherwise `internal`. */
function outcomeOf(err: unknown): string {
  if (err instanceof ToolError && (TOOL_OUTCOMES as readonly string[]).includes(err.code)) {
    return err.code;
  }
  return 'internal';
}

/** The last tool and outcome code per session (keyed by the session's abort signal). Operators only. */
const lastCalls = new WeakMap<AbortSignal, { tool: string; outcome: string }>();
const watched = new WeakSet<AbortSignal>();

/**
 * Logs one `session_end` line when a session's signal aborts: the last tool and its outcome code.
 * It goes to the operator log only; no tool result carries it. A session with no finished call logs nothing.
 */
function watchSessionEnd(deps: Wired, ctx: ToolContext): void {
  if (watched.has(ctx.signal)) return;
  watched.add(ctx.signal);
  const line = (): void => {
    const last = lastCalls.get(ctx.signal);
    if (last === undefined) return;
    try {
      deps.log?.({ event: 'session_end', player_id: ctx.playerId, ...last });
    } catch {
      // The line is lost; nothing else depends on it.
    }
  };
  if (ctx.signal.aborted) line();
  else ctx.signal.addEventListener('abort', line, { once: true });
}

/**
 * Logs one `tool_call` line per call: the tool, the player, the outcome code and the duration. Never the
 * arguments, the result or any text. A logger that throws does not fail the call.
 */
function logged(deps: Wired, tool: string, run: ToolHandler): ToolHandler {
  const record = (playerId: string, outcome: string, started: number): void => {
    const durationMs = deps.now() - started;
    try {
      deps.log?.({
        event: 'tool_call',
        player_id: playerId,
        tool,
        outcome,
        duration_ms: durationMs,
      });
    } catch {
      // The line is lost; the call's own result stands.
    }
    try {
      deps.onToolCall?.(tool, outcome, durationMs);
    } catch {
      // The count is lost; the call's own result stands.
    }
  };
  return async (input, ctx) => {
    watchSessionEnd(deps, ctx);
    const started = deps.now();
    try {
      const result = await run(input, ctx);
      record(ctx.playerId, 'ok', started);
      lastCalls.set(ctx.signal, { tool, outcome: 'ok' });
      return result;
    } catch (err) {
      const outcome = outcomeOf(err);
      record(ctx.playerId, outcome, started);
      lastCalls.set(ctx.signal, { tool, outcome });
      throw err;
    }
  };
}
