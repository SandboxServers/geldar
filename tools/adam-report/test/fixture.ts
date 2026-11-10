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
