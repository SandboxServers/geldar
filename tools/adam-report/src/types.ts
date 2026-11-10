/** Row shapes the report reads. Timestamps are epoch milliseconds; the loader converts them. */

export interface LiteSnapshot {
  hunger: number | null;
  heldItem: string | null;
  inventory: { item: string; count: number }[];
}

export interface ThoughtRow {
  thoughtId: string;
  atMs: number;
  day: number;
  tick: number;
  wakeReason: string;
  /** True when a model call was made (`model_input` is not null). A tired cycle is false. */
  called: boolean;
  parsedOk: boolean;
  errored: boolean;
  latencyMs: number | null;
  snapshot: LiteSnapshot | null;
}

export interface IntentRow {
  intentId: string;
  state: string;
  startedTick: number | null;
  endedTick: number | null;
  endReason: string | null;
}

export interface ActionRow {
  actionId: string;
  intentId: string | null;
  bodyGeneration: number | null;
  state: string;
  /** The action's `do` verb (kind), for example place or mine. */
  kind: string;
  /** For a place action, the block it places (args.block); null for any other action. */
  placeBlock: string | null;
}

export interface ReceiptRow {
  actionId: string;
  phase: string;
  atMs: number;
}

/** A row of the `events` table for one life: only `death` and `sleep` are read. */
export interface EventRow {
  type: string;
  day: number;
  atMs: number;
}

export interface RunData {
  thoughts: ThoughtRow[];
  intents: IntentRow[];
  actions: ActionRow[];
  receipts: ReceiptRow[];
  events: EventRow[];
}

export interface Restart {
  atMs: number;
  kind: 'planned' | 'body';
}

/** The run manifest written by `adam-run start` (W6-13). Field names are the file's. */
export interface Manifest {
  runId: string;
  lifeId: string;
  worldSeed: string;
  gitSha: string;
  modelTags: { tag: string; digest: string }[];
  shardConfigHash: string;
  startTimeMs: number;
  restarts: Restart[];
  tpsTarget: number;
}

export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN';

export type Value = number | string | boolean | null;

export interface Measure {
  id: string;
  title: string;
  verdict: Verdict;
  /** The query window the numbers cover, stated in words. */
  window: string;
  values: Record<string, Value>;
  note: string;
}

/** The answers the owner gave (criteria.yaml). A null value means not answered. */
export interface Criteria {
  survivalDays: number | null;
  deathFailsRun: boolean | null;
  latencyP95MaxMs: number | null;
  latencyHardLimitMs: number | null;
  continuousHours: number | null;
  continuousWorldDays: number | null;
  maxGapSeconds: number | null;
  intentsWithoutCallMin: number | null;
  modelFloorVerdict: string | null;
}

export const PENDING = 'not computed: definition pending';
