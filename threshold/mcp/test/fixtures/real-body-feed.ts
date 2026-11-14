import { readFileSync } from 'node:fs';
import type { SpeechIdentity } from '@geldar/player-core/src/attention/classify.ts';
import type { Snapshot } from '@geldar/contract';
import { encodeCursor, FakeClock, type SimEvent } from '@geldar/mcp-mock';
import type { RunState } from '../../src/events/mapper.ts';
import { RingEventLog } from '../../src/events/player-log.ts';
import { handleStreamMessage } from '../../src/events/stream.ts';
import { createWaitState, type WaitDeps, type WaitOutcome, wait } from '../../src/tools/wait.ts';

/** The life the real events concern (agent_id in the fixture). */
export const REAL_LIFE = 'ag_test_01';

const NO_SPACING = { minSpacingMs: 0, intentRunTooLongMs: 600_000 };

/** The real Body events of live run 5 as wire messages, oldest first (fixtures/real-body-events.json). */
export function realMessages(): unknown[] {
  const file = JSON.parse(
    readFileSync(new URL('./real-body-events.json', import.meta.url), 'utf8'),
  ) as { events: unknown[] };
  return file.events;
}

/** One player's event log and running intents, after the stream handler has taken the messages. */
export interface FedStream {
  log: RingEventLog;
  runs: Map<string, RunState>;
  invalid: number;
}

/** Feeds the messages through handleStreamMessage at stream sequences 1, 2, ... (the test's ids). */
export async function feedStream(messages: readonly unknown[]): Promise<FedStream> {
  const log = new RingEventLog();
  const runs = new Map<string, RunState>();
  const counters = { invalid: 0 };
  const ctx = {
    map: { identity: {} as SpeechIdentity, runs },
    log,
    lives: () => [REAL_LIFE],
  };
  for (const [index, raw] of messages.entries()) {
    await handleStreamMessage(index + 1, raw, ctx, counters);
  }
  return { log, runs, invalid: counters.invalid };
}

/** The kinds the life's log holds, as `seq:kind`, oldest first. */
export async function logKinds(log: RingEventLog): Promise<string[]> {
  const { events } = await log.since(REAL_LIFE, 0);
  return events.map((e: SimEvent) => `${e.seq}:${e.kind}`);
}

/** The player-facing events a `wait` returns, as `seq:type`, from a result that carries them. */
export function resultTypes(out: WaitOutcome): string[] {
  if (!out.ok) return [`error:${out.error}`];
  return out.result.events.map((e) => `${e.seq}:${e.type}`);
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * One `wait` from the cursor `cursorSeq` on a fed log. The events after the cursor wake it at once; when
 * none wakes it, the fake clock runs out the deadline, so the call never hangs.
 */
export async function waitAfter(
  fed: FedStream,
  cursorSeq: number,
  maxSeconds = 5,
): Promise<WaitOutcome> {
  const clock = new FakeClock(0);
  const deps: WaitDeps = {
    clock,
    keepAlive: { start: () => () => undefined },
    log: fed.log,
    body: { snapshot: async () => realSnapshot() },
    budget: { balance: async () => 5 },
    sleeps: { read: async () => ({ lastSleepDay: 85, cursor: 0 }) },
    runs: fed.runs,
    config: NO_SPACING,
    state: createWaitState(),
    pollMs: 1000,
  };
  const pending = wait(deps, {
    lifeId: REAL_LIFE,
    cursor: encodeCursor(cursorSeq),
    maxSeconds,
  });
  for (let i = 0; i <= maxSeconds; i++) {
    await flush();
    await clock.advance(1000);
  }
  return pending;
}

/** A minimal Body snapshot: the wait only reads its world time and its surroundings here. */
function realSnapshot(): Snapshot {
  return {
    world_time: { day: 85 },
    self: {},
    heard: [],
    events_since_last_thought: [],
    surroundings: { notable_blocks: [] },
  } as unknown as Snapshot;
}
