import type { McpInterest, WaitResult } from '@geldar/contract';
import {
  decodeCursor,
  encodeCursor,
  evaluateWake,
  type WakeConfig,
  type WakeReason,
} from '@geldar/mcp-mock';
import type { RunState } from '../events/mapper.ts';
import { fitResult, toPlayerEvents, WORLD_TEXT_NOTE, worldText } from '../events/present.ts';
import { toPlayView } from '../play-view.ts';
import type {
  BodyGateway,
  BudgetLedger,
  Clock,
  KeepAlive,
  PlayerEventLog,
  SleepMarks,
} from '../ports.ts';
import { BodyUnavailable } from '../ports.ts';

/** The longest `wait` the Scriptorium constraint allows, in seconds (spec 5.15.3). */
export const MAX_WAIT_SECONDS = 240;
/** How often an open `wait` writes a keepalive so its stream does not idle past a proxy. */
export const KEEPALIVE_MS = 20_000;
/** The shortest wait the contract allows, in seconds (mcp-play.schema.json, max_seconds minimum). */
export const MIN_WAIT_SECONDS = 5;
/** How often an open `wait` rechecks the policy while nothing else wakes it. */
export const POLL_MS = 1_000;

const ALL_INTERESTS: readonly McpInterest[] = [
  'directly_addressed',
  'intent_finished',
  'damage',
  'agent_approached',
  'proposal',
  'day_night',
];

/** The event log a `wait` reads: the port plus the newest sequence a life holds. */
export interface WaitLog extends PlayerEventLog {
  head(lifeId: string): number;
}

/** Marks the life's presence as touched; the server wires it to PresenceStore.touch. */
export type TouchPresence = (lifeId: string) => Promise<void>;

/** What `wait` needs from the rest of the server. */
export interface WaitDeps {
  clock: Clock;
  keepAlive: KeepAlive;
  log: WaitLog;
  body: Pick<BodyGateway, 'snapshot'>;
  /** The balance and the sleep mark that the play view of the snapshot reports, as `look` does. */
  budget: Pick<BudgetLedger, 'balance'>;
  sleeps: Pick<SleepMarks, 'read'>;
  /** The running intent per life, as the event mapper keeps it. */
  runs: Map<string, RunState>;
  config: WakeConfig;
  state: WaitState;
  touchPresence?: TouchPresence;
  keepAliveMs?: number;
  pollMs?: number;
}

/** One `wait` call. The cursor is the client's acknowledgement: the events after it are returned. */
export interface WaitRequest {
  lifeId: string;
  cursor?: string;
  interests?: readonly McpInterest[];
  maxSeconds: number;
  /** Aborted when the session ends (a revoke, say): the wait ends with `session_superseded`. */
  signal?: AbortSignal;
  /** Called on each keepalive tick, so the transport can write a progress line. */
  onKeepAlive?: () => void;
}

export type WaitError =
  | 'bad_cursor'
  | 'bad_max_seconds'
  | 'body_unavailable'
  | 'session_superseded'
  | 'wait_replaced';

export type WaitOutcome = { ok: true; result: WaitResult } | { ok: false; error: WaitError };

/** Per-process wait state: the open wait per life and the last wake per life (the spacing window). */
export interface WaitState {
  open: Map<string, (why: WaitError) => void>;
  lastWakeMs: Map<string, number>;
}

export function createWaitState(): WaitState {
  return { open: new Map(), lastWakeMs: new Map() };
}

/**
 * The long poll (spec 5.3.2, 5.15.3). Holds the call until the wake policy fires or the deadline
 * passes. An event is never consumed: the same cursor returns the same events, so a waking event in
 * a lost response wakes again on the old cursor. A missing Body ends the call with
 * `body_unavailable` and advances nothing.
 */
export async function wait(deps: WaitDeps, req: WaitRequest): Promise<WaitOutcome> {
  const { clock, log, state } = deps;
  const { lifeId } = req;
  // max_seconds: an integer from MIN_WAIT_SECONDS up; NaN, a missing value and a fraction are refused
  if (!Number.isInteger(req.maxSeconds) || req.maxSeconds < MIN_WAIT_SECONDS) {
    return { ok: false, error: 'bad_max_seconds' };
  }
  const head = log.head(lifeId);
  let from = head;
  if (req.cursor !== undefined) {
    const decoded = decodeCursor(req.cursor);
    if (decoded === null || decoded > head) return { ok: false, error: 'bad_cursor' };
    from = decoded;
  }

  const seconds = Math.min(MAX_WAIT_SECONDS, req.maxSeconds);
  const deadline = clock.nowMs() + seconds * 1000;
  const interests: readonly string[] = req.interests ?? ALL_INTERESTS;
  const control = new AbortController();
  const end: { error: WaitError | null } = { error: null };
  const stop = (why: WaitError): void => {
    end.error ??= why;
    control.abort();
  };
  state.open.get(lifeId)?.('wait_replaced');
  state.open.set(lifeId, stop);
  const onSessionEnd = (): void => stop('session_superseded');
  if (req.signal?.aborted) onSessionEnd();
  req.signal?.addEventListener('abort', onSessionEnd, { once: true });
  const stopKeepAlive = deps.keepAlive.start(deps.keepAliveMs ?? KEEPALIVE_MS, () =>
    req.onKeepAlive?.(),
  );
  const touch = async (): Promise<void> => {
    try {
      await deps.touchPresence?.(lifeId);
    } catch {
      // presence is best effort; a failed touch never ends a wait
    }
  };
  await touch();

  let reason: WakeReason = 'timeout';
  let wakingSeqs: number[] = [];
  let now = clock.nowMs();
  try {
    for (;;) {
      if (end.error !== null) return { ok: false, error: end.error };
      now = clock.nowMs();
      const { events } = await log.since(lifeId, from);
      const decision = evaluateWake({
        events,
        intentStartedMs: deps.runs.get(lifeId)?.startedMs ?? null,
        interests,
        nowMs: now,
        lastWakeMs: state.lastWakeMs.get(lifeId) ?? null,
        config: deps.config,
        alreadySuppressed: new Set(),
      });
      if (decision.wake) {
        reason = decision.wake.reason;
        wakingSeqs = decision.wake.seqs;
        break;
      }
      if (now >= deadline) {
        reason = 'timeout';
        break;
      }
      const waits = [deps.pollMs ?? POLL_MS, deadline - now];
      if (decision.recheckAtMs !== null) waits.push(decision.recheckAtMs - now);
      try {
        await clock.sleep(Math.max(1, Math.min(...waits)), control.signal);
      } catch {
        // an abort ends the wait on the next check
      }
      await touch();
    }
  } finally {
    stopKeepAlive();
    req.signal?.removeEventListener('abort', onSessionEnd);
    if (state.open.get(lifeId) === stop) state.open.delete(lifeId);
  }

  // The Body must answer for the snapshot; without it nothing is acknowledged.
  // The snapshot goes out as a play view, as `look` sends it: no heard lines, no sign text, and the
  // balance and days since sleep from the server. Speech comes from the event log only.
  let view: ReturnType<typeof toPlayView>;
  try {
    const body = await deps.body.snapshot(lifeId);
    const budget = await deps.budget.balance(lifeId, clock.nowMs());
    const mark = await deps.sleeps.read(lifeId);
    view = toPlayView(body, {
      budget: Math.floor(budget),
      daysSinceSleep: body.world_time.day - mark.lastSleepDay,
    });
  } catch (err) {
    if (err instanceof BodyUnavailable) return { ok: false, error: 'body_unavailable' };
    throw err;
  }
  state.lastWakeMs.set(lifeId, now);
  await touch();

  const since = await log.since(lifeId, from);
  const result: WaitResult = {
    snapshot: view.snapshot as unknown as WaitResult['snapshot'],
    events: toPlayerEvents(since.events),
    cursor: encodeCursor(log.head(lifeId)),
    wake_reason: reason,
    dropped_events: since.dropped,
    untrusted_world_text: {
      ...worldText(since.events, { wakingSeqs }),
      ...(view.untrusted.signs?.length ? { signs: view.untrusted.signs } : {}),
    },
    note: WORLD_TEXT_NOTE,
  };
  return { ok: true, result: fitResult(result, undefined, wakingSeqs) };
}
