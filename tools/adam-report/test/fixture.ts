import type { ClientFactory } from '../src/db.ts';
import type {
  ActionRow,
  Criteria,
  EventRow,
  IntentRow,
  Manifest,
  ReceiptRow,
  ThoughtRow,
} from '../src/types.ts';

/** Shared test builders. Each returns a plain row; tests override only the fields they read. */

export const T0 = Date.UTC(2026, 10, 10, 12);
export const MIN_MS = 60_000;
/** One in-game day in the fixtures (the real length is not needed: days are read from `day`). */
export const DAY_MS = 20 * MIN_MS;

/** A contract-shaped snapshot (snapshot.schema.json): the agent's state sits under `self`. */
export function snap(
  o: { hunger?: number; held?: string | null; inventory?: [string, number][] } = {},
): Record<string, unknown> {
  return {
    snapshot_id: 'snap-1',
    agent_id: 'life-1',
    shard: 'mock',
    revision: 1,
    world_time: { day: 0, time_of_day: 'day', ticks: 0, weather: 'clear' },
    self: {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      hunger: o.hunger ?? 20,
      armor: [],
      held_item: o.held ?? null,
      inventory: (o.inventory ?? []).map(([item, count]) => ({ item, count })),
      effects: [],
      budget_remaining_thoughts: 10,
      days_since_sleep: 0,
    },
    surroundings: [],
    heard: [],
    events_since_last_thought: [],
  };
}

export function thought(id: string, o: Partial<ThoughtRow> = {}): ThoughtRow {
  return {
    thoughtId: id,
    atMs: T0,
    day: 0,
    tick: 0,
    wakeReason: 'timer',
    called: true,
    parsedOk: true,
    errored: false,
    latencyMs: 1000,
    snapshot: null,
    ...o,
  };
}

export function intent(id: string, o: Partial<IntentRow> = {}): IntentRow {
  return {
    intentId: id,
    state: 'completed',
    startedTick: 0,
    endedTick: 100,
    endReason: null,
    ...o,
  };
}

export function action(id: string, o: Partial<ActionRow> = {}): ActionRow {
  return {
    actionId: id,
    intentId: null,
    bodyGeneration: 1,
    state: 'completed',
    kind: 'mine',
    placeBlock: null,
    ...o,
  };
}

export function receipt(actionId: string, phase: string, atMs = T0): ReceiptRow {
  return { actionId, phase, atMs };
}

export function event(type: string, day: number, atMs = T0): EventRow {
  return { type, day, atMs };
}

export function manifest(o: Partial<Manifest> = {}): Manifest {
  return {
    runId: 'run-1',
    lifeId: 'life-1',
    worldSeed: 'seed-1',
    gitSha: 'abc1234',
    modelTags: [
      { tag: 'model-b', digest: 'sha256:bb' },
      { tag: 'model-a', digest: 'sha256:aa' },
    ],
    shardConfigHash: 'cfg-1',
    startTimeMs: T0,
    restarts: [],
    tpsTarget: 20,
    ...o,
  };
}

/** The criteria with every answer the owner gave in criteria.yaml, except the pending ones. */
export function criteria(o: Partial<Criteria> = {}): Criteria {
  return {
    survivalDays: 5,
    deathFailsRun: true,
    latencyP95MaxMs: 15000,
    latencyHardLimitMs: 25000,
    continuousHours: 24,
    continuousWorldDays: 5,
    maxGapSeconds: null,
    intentsWithoutCallMin: 3,
    modelFloorVerdict: null,
    ...o,
  };
}

/** Rows shaped as the loader's SELECTs return them (snake_case columns), keyed by table. */
export type DbTables = Partial<
  Record<'thoughts' | 'intents' | 'actions' | 'receipts' | 'events', Record<string, unknown>[]>
>;

/** One life's rows: three thoughts, one completed intent, one action with a committed receipt, one sleep. */
export function lifeTables(): DbTables {
  return {
    thoughts: [
      {
        thought_id: 'th-1',
        at: new Date(T0),
        world_day: 0,
        world_tick: 100,
        wake_reason: 'timer',
        snapshot: snap({ hunger: 18 }),
        called: true,
        parsed_ok: true,
        errored: false,
        latency_ms: 1200,
      },
      {
        thought_id: 'th-2',
        at: new Date(T0 + MIN_MS),
        world_day: 0,
        world_tick: 1300,
        wake_reason: 'event',
        snapshot: snap(),
        called: true,
        parsed_ok: true,
        errored: false,
        latency_ms: 2400,
      },
      {
        thought_id: 'th-3',
        at: new Date(T0 + 2 * MIN_MS),
        world_day: 0,
        world_tick: 2600,
        wake_reason: 'timer',
        snapshot: null,
        called: false,
        parsed_ok: false,
        errored: false,
        latency_ms: null,
      },
    ],
    intents: [
      {
        intent_id: 'in-1',
        state: 'completed',
        started_tick: 100,
        ended_tick: 900,
        end_reason: null,
      },
    ],
    actions: [
      {
        action_id: 'ac-1',
        intent_id: 'in-1',
        body_generation: 1,
        state: 'completed',
        kind: 'mine',
        place_block: null,
      },
    ],
    receipts: [{ action_id: 'ac-1', phase: 'committed', at: new Date(T0 + MIN_MS) }],
    events: [{ type: 'sleep', world_day: 0, at: new Date(T0 + MIN_MS) }],
  };
}

/**
 * A ClientFactory that answers the loader's SELECTs from `tables`, keyed by the table after FROM.
 * `failOn` names a table whose SELECT rejects, so a test can check the read-error path.
 */
export function fakeDb(tables: DbTables, failOn?: string): ClientFactory {
  return () => ({
    connect: async () => undefined,
    query: async (text: string) => {
      const table = /FROM (\w+)/.exec(text)?.[1];
      if (table === undefined) return { rows: [] };
      if (table === failOn) throw new Error(`fake database error on ${table}`);
      return { rows: tables[table as keyof DbTables] ?? [] };
    },
    end: async () => undefined,
  });
}
