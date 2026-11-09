/**
 * Projects `intent`, `action` and `receipt` events into the `intents`, `actions` and `receipts`
 * tables (spec section 7, Appendix D, decision 0020). The `events` row is written first by the
 * writer; this keeps the query tables in step with it.
 *
 * Rules: an upsert by primary key that only moves forward (accepted, then running, then one of
 * completed, failed or cancelled; the first final state stays), so redelivery and reordering
 * converge; at most one final receipt per action (a second one is rejected with a permanent
 * error, which the consumer dead-letters with the reason). An `interrupted` intent event is stored
 * as `cancelled` with an end reason that starts `interrupted:` (the table has no such state);
 * `paused` is not stored. The `accepted` event's goal, program, arguments, preconditions, wake_on
 * and limits fill the matching columns. `thought_id` and `checkpoint` stay null: no event carries
 * a thought id, and the running checkpoint lives in NATS KV (decision 0043). Other event types are
 * not projected.
 *
 * Latent: two sink replicas that each see the first event of a new intent or action can both find
 * no row (`FOR UPDATE` has no row to lock) and race on the insert; the loser fails on the primary
 * key and the redelivery then merges. Compose runs one sink, so this is documented, not handled.
 */
import {
  type ActionRecord,
  type IntentEventPayload,
  type Receipt,
  validateActionRecord,
  validateIntentEventPayload,
  validateReceipt,
  type WorldEvent,
} from '@geldar/contract';

/** A row of `intents`, the columns the Body's records fill. */
export interface IntentRow {
  intent_id: string;
  life_id: string;
  body_generation: number;
  state: string;
  started_tick: number | null;
  ended_tick: number | null;
  end_reason: string | null;
  goal: string | null;
  program: string | null;
  arguments: unknown;
  preconditions: unknown;
  wake_on: unknown;
  limits: unknown;
  /** Always null today: see the module comment. */
  checkpoint: unknown;
  /** Always null today: see the module comment. */
  thought_id: string | null;
}

/** What the projection reads and writes; Postgres in production, a map in the unit tests. */
export interface ProjectionStore {
  getIntent(intentId: string): Promise<IntentRow | undefined>;
  /** Insert or replace the row with this `intent_id`. */
  saveIntent(row: IntentRow): Promise<void>;
  /** The stored state of the action, if it has a row. */
  getAction(actionId: string): Promise<{ state: string } | undefined>;
  /** Insert or replace the row with this `action_id`. */
  saveAction(record: ActionRecord): Promise<void>;
  /** Every stored receipt of the action: id and phase. */
  getReceipts(actionId: string): Promise<{ receipt_id: string; phase: string }[]>;
  insertReceipt(receipt: Receipt): Promise<void>;
}

/**
 * Thrown for an event the projection refuses. `code` is a SQLSTATE of class 23, so the consumer
 * treats it as permanent: it dead-letters that event with this message and carries on.
 */
export class ProjectionRejectedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectionRejectedError';
    this.code = code;
  }
}

/** The event types this module writes tables for. Everything else goes to `events` only. */
export const PROJECTED_TYPES: ReadonlySet<string> = new Set(['intent', 'action', 'receipt']);

/** True when `projectEvent` does something for this event. */
export function isProjected(event: WorldEvent): boolean {
  return PROJECTED_TYPES.has(event.type);
}

/** How far along a state is. Equal ranks never overwrite each other (the first final state wins). */
const STATE_RANK: Readonly<Record<string, number>> = {
  accepted: 0,
  running: 1,
  completed: 2,
  failed: 2,
  cancelled: 2,
  interrupted: 2,
};

/** The row state an event state is stored as; undefined for a state the table does not hold. */
function rowState(state: string): string | undefined {
  if (state === 'interrupted') return 'cancelled';
  return state === 'paused' ? undefined : state;
}

function rejectInvalid(type: string, errors: readonly string[]): never {
  throw new ProjectionRejectedError(
    '23514',
    `${type} event payload is not valid: ${errors.join('; ')}`,
  );
}

/** The row after applying one change, or undefined when nothing changes. */
function mergeIntent(
  existing: IntentRow | undefined,
  change: IntentEventPayload,
): IntentRow | undefined {
  const stored = rowState(change.state);
  const rank = STATE_RANK[change.state];
  if (stored === undefined || rank === undefined) return undefined; // paused: events only
  const final = rank === 2;
  const endReason =
    change.state === 'interrupted'
      ? `interrupted:${change.detail === undefined ? '' : ` ${change.detail}`}`
      : (change.detail ?? null);
  const fields = {
    goal: change.goal ?? null,
    program: change.program ?? null,
    arguments: change.arguments ?? null,
    preconditions: change.preconditions ?? null,
    wake_on: change.wake_on ?? null,
    limits: change.limits ?? null,
  };
  if (existing === undefined) {
    return {
      intent_id: change.intent_id,
      life_id: change.life_id,
      body_generation: change.body_generation,
      state: stored,
      started_tick: final ? null : change.tick,
      ended_tick: final ? change.tick : null,
      end_reason: final ? endReason : null,
      ...fields,
      checkpoint: null,
      thought_id: null,
    };
  }
  const next = { ...existing };
  if (rank > (STATE_RANK[existing.state] ?? -1)) {
    next.state = stored;
    if (final) {
      next.ended_tick = change.tick;
      next.end_reason = endReason;
    }
  }
  // The intent's own fields come with the accepted event, which can arrive after a later one.
  for (const [name, value] of Object.entries(fields)) {
    if (value !== null && next[name as keyof typeof fields] === null) {
      (next as Record<string, unknown>)[name] = value;
    }
  }
  // An earlier non-final change that arrives late still tells when the intent started.
  if (!final && (next.started_tick === null || change.tick < next.started_tick)) {
    next.started_tick = change.tick;
  }
  return JSON.stringify(next) === JSON.stringify(existing) ? undefined : next;
}

async function projectIntent(event: WorldEvent, store: ProjectionStore): Promise<void> {
  const parsed = validateIntentEventPayload(event.payload);
  if (!parsed.ok) rejectInvalid('intent', parsed.errors);
  const change = parsed.value;
  const next = mergeIntent(await store.getIntent(change.intent_id), change);
  if (next !== undefined) await store.saveIntent(next);
}

async function projectAction(event: WorldEvent, store: ProjectionStore): Promise<void> {
  const parsed = validateActionRecord(event.payload);
  if (!parsed.ok) rejectInvalid('action', parsed.errors);
  const record = parsed.value;
  const existing = await store.getAction(record.action_id);
  if (
    existing !== undefined &&
    (STATE_RANK[record.state] ?? 0) <= (STATE_RANK[existing.state] ?? -1)
  ) {
    return; // a repeat, or an older state arriving late
  }
  await store.saveAction(record);
}

async function projectReceipt(event: WorldEvent, store: ProjectionStore): Promise<void> {
  const parsed = validateReceipt(event.payload);
  if (!parsed.ok) rejectInvalid('receipt', parsed.errors);
  const receipt = parsed.value;
  const stored = await store.getReceipts(receipt.action_id);
  const same = stored.find((row) => row.receipt_id === receipt.receipt_id);
  if (same?.phase === receipt.phase) return; // redelivery
  if (same !== undefined) {
    throw new ProjectionRejectedError(
      '23505',
      `receipt id ${receipt.receipt_id} is already stored as a ${same.phase} receipt of action ` +
        `${receipt.action_id}; the ${receipt.phase} receipt with the same id is rejected`,
    );
  }
  const clash = stored.find((row) =>
    receipt.phase === 'prepared' ? row.phase === 'prepared' : row.phase !== 'prepared',
  );
  if (clash !== undefined) {
    throw new ProjectionRejectedError(
      '23505',
      `action ${receipt.action_id} already has ${clash.phase} receipt ${clash.receipt_id}; ` +
        `second ${receipt.phase} receipt ${receipt.receipt_id} rejected (one final receipt per action)`,
    );
  }
  await store.insertReceipt(receipt);
}

/** Projects one event; a no-op for types that have no table. Rejects with `ProjectionRejectedError`. */
export async function projectEvent(event: WorldEvent, store: ProjectionStore): Promise<void> {
  if (event.type === 'intent') await projectIntent(event, store);
  else if (event.type === 'action') await projectAction(event, store);
  else if (event.type === 'receipt') await projectReceipt(event, store);
}

/** What the Postgres store needs from a client; `pg`'s `PoolClient` fits. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/** The store over one open transaction. Reads of intents and actions lock the row they find. */
export function pgProjectionStore(db: Queryable): ProjectionStore {
  return {
    async getIntent(intentId) {
      const { rows } = await db.query(
        `SELECT intent_id, life_id, body_generation, state, started_tick, ended_tick, end_reason,
                goal, program, arguments, preconditions, wake_on, limits, checkpoint, thought_id
           FROM intents WHERE intent_id = $1 FOR UPDATE`,
        [intentId],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      return {
        ...(row as unknown as IntentRow),
        started_tick: row.started_tick === null ? null : Number(row.started_tick),
        ended_tick: row.ended_tick === null ? null : Number(row.ended_tick),
      };
    },
    async saveIntent(row) {
      await db.query(
        `INSERT INTO intents (intent_id, life_id, body_generation, state, started_tick, ended_tick, end_reason,
           goal, program, arguments, preconditions, wake_on, limits, checkpoint, thought_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15)
         ON CONFLICT (intent_id) DO UPDATE SET life_id = EXCLUDED.life_id,
           body_generation = EXCLUDED.body_generation, state = EXCLUDED.state,
           started_tick = EXCLUDED.started_tick, ended_tick = EXCLUDED.ended_tick,
           end_reason = EXCLUDED.end_reason, goal = EXCLUDED.goal, program = EXCLUDED.program,
           arguments = EXCLUDED.arguments, preconditions = EXCLUDED.preconditions,
           wake_on = EXCLUDED.wake_on, limits = EXCLUDED.limits, checkpoint = EXCLUDED.checkpoint,
           thought_id = EXCLUDED.thought_id`,
        [
          row.intent_id,
          row.life_id,
          row.body_generation,
          row.state,
          row.started_tick,
          row.ended_tick,
          row.end_reason,
          row.goal,
          row.program,
          jsonOrNull(row.arguments),
          jsonOrNull(row.preconditions),
          jsonOrNull(row.wake_on),
          jsonOrNull(row.limits),
          jsonOrNull(row.checkpoint),
          row.thought_id,
        ],
      );
    },
    async getAction(actionId) {
      const { rows } = await db.query(
        'SELECT action_id, state FROM actions WHERE action_id = $1 FOR UPDATE',
        [actionId],
      );
      return rows[0] as { state: string } | undefined;
    },
    async saveAction(r) {
      await db.query(
        `INSERT INTO actions (action_id, intent_id, life_id, body_generation, sequence, source_snapshot_id,
           expires_tick, kind, args, snapshot_revision, state, result, receipt_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13)
         ON CONFLICT (action_id) DO UPDATE SET intent_id = EXCLUDED.intent_id, life_id = EXCLUDED.life_id,
           body_generation = EXCLUDED.body_generation, sequence = EXCLUDED.sequence,
           source_snapshot_id = EXCLUDED.source_snapshot_id, expires_tick = EXCLUDED.expires_tick,
           kind = EXCLUDED.kind, args = EXCLUDED.args, snapshot_revision = EXCLUDED.snapshot_revision,
           state = EXCLUDED.state, result = EXCLUDED.result, receipt_id = EXCLUDED.receipt_id`,
        [
          r.action_id,
          r.intent_id,
          r.life_id,
          r.body_generation,
          r.sequence,
          r.source_snapshot_id,
          r.expires_tick,
          r.kind,
          JSON.stringify(r.args),
          r.snapshot_revision,
          r.state,
          r.result === null ? null : JSON.stringify(r.result),
          r.receipt_id,
        ],
      );
    },
    async getReceipts(actionId) {
      const { rows } = await db.query(
        'SELECT receipt_id, phase FROM receipts WHERE action_id = $1',
        [actionId],
      );
      return rows as { receipt_id: string; phase: string }[];
    },
    async insertReceipt(r) {
      await db.query(
        `INSERT INTO receipts (receipt_id, action_id, life_id, kind, phase, item, count, credits, at, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          r.receipt_id,
          r.action_id,
          r.life_id,
          r.kind,
          r.phase,
          r.item ?? null,
          r.count ?? null,
          r.credits ?? null,
          r.at,
          r.detail ?? null,
        ],
      );
    },
  };
}
