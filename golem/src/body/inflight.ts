import type { ActionRecord, Receipt } from '@geldar/contract';
import { errorText } from '../actions/outcome.ts';
import type { BodyKv } from './checkpoint.ts';
import { receiptIdFor } from './derived-id.ts';
import type { RecordSink } from './records.ts';

/** The detail of the aborted receipt and the failed record a restarted Body writes for an open give. */
export const INTERRUPTED_DETAIL =
  'the body stopped during the give; the items may be on the ground';

/** Longest wait for the record sink to send an outcome; past it the key stays open for the next start. */
const SEND_TIMEOUT_MS = 5_000;

/**
 * What `geldar-checkpoints/<life_id>.inflight` holds. `open`: an economic action has started and its
 * outcome is not yet sent, so the record is what the failed action and its receipt are built from.
 * `closed`: the outcome was sent; a start that finds it only deletes the key.
 */
export type InflightValue =
  | { phase: 'open'; record: ActionRecord; item: string; count: number }
  | { phase: 'closed'; action_id: string };

/** What an `InflightStore` is built from. */
export interface InflightStoreOptions {
  kv: BodyKv;
  lifeId: string;
  /** Where a recovered give's aborted receipt and failed record are published. */
  sink: RecordSink;
  /** The sink whose `flush` says the outcome was sent (the record queue under `sink`). Default `sink`. */
  flushable?: RecordSink;
  log?: (line: string) => void;
  /** The clock for the recovered receipt's `at`. Default `new Date()`. */
  now?: () => Date;
}

type Flushable = RecordSink & { flush?: () => Promise<void> };

/**
 * The in-flight marker of an economic action (a give), kept in the checkpoint bucket under
 * `<life_id>.inflight`. It is written after the `prepared` receipt and before the action runs, and
 * closed only after the outcome receipt is sent: `closed` is written, then the key is deleted. A
 * Body that starts and finds the key `open` knows the previous run died mid-give. It publishes the
 * aborted receipt and the failed record (same derived ids, so a repeat is a no-op) and then closes
 * the key. A `closed` key is only deleted. The key is the only record here: the Body has no
 * database. Operations run one at a time, so a close never deletes a key a later `begin` wrote.
 */
export class InflightStore {
  private readonly kv: BodyKv;
  private readonly key: string;
  private readonly sink: RecordSink;
  private readonly flushable: Flushable;
  private readonly log: (line: string) => void;
  private readonly now: () => Date;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: InflightStoreOptions) {
    this.kv = options.kv;
    this.key = `${options.lifeId}.inflight`;
    this.sink = options.sink;
    this.flushable = options.flushable ?? options.sink;
    this.log = options.log ?? ((line) => console.error(line));
    this.now = options.now ?? (() => new Date());
  }

  /** Writes the key for an economic action before it runs. Rejects when the write fails. */
  begin(record: ActionRecord, item: string, count: number): Promise<void> {
    const value: InflightValue = { phase: 'open', record: structuredClone(record), item, count };
    return this.serial(() => this.kv.put(this.key, JSON.stringify(value)).then(() => undefined));
  }

  /**
   * Called once the outcome receipt of the open give is handed to the sink. In the background: when
   * the sink has sent it, the key is marked `closed` and deleted. If the send does not finish in
   * time, or a write fails, the key stays and the next start handles it.
   */
  end(actionId: string): void {
    this.serial(async () => {
      if (!(await sent(this.flushable))) {
        this.log(`inflight: the outcome of ${actionId} was not sent in time; the key stays open`);
        return;
      }
      await this.close(actionId);
    }).catch(() => undefined);
  }

  /**
   * At a Body start, before anything else runs: closes the previous run's open give (publishes the
   * aborted receipt and the failed record, then closes the key), or only deletes a `closed` key.
   * Nothing is written when there is no key. Rejects when the bucket fails; the key stays.
   */
  recover(): Promise<void> {
    return this.serial(async () => {
      const entry = await this.kv.get(this.key);
      if (entry === null) return;
      const value = parseValue(entry.value);
      if (value === null) {
        this.log(`inflight: ${this.key} is unreadable and was deleted`);
      } else if (value.phase === 'open') {
        const { record, item, count } = value;
        this.sink.receipt(interruptedReceipt(record, item, count, this.now()));
        this.sink.actionChanged(interruptedRecord(record));
        if (!(await sent(this.flushable))) {
          this.log(`inflight: the interrupted give ${record.action_id} was not sent in time`);
          return;
        }
        await this.close(record.action_id);
        return;
      }
      await this.kv.delete(this.key);
    });
  }

  /** Marks the key `closed`, then deletes it. A key that a later `begin` wrote is not expected here. */
  private async close(actionId: string): Promise<void> {
    const closed: InflightValue = { phase: 'closed', action_id: actionId };
    await this.kv.put(this.key, JSON.stringify(closed));
    await this.kv.delete(this.key);
  }

  /** Runs `task` after every earlier operation; a failure is logged and the next operation still runs. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task);
    this.chain = run.then(
      () => undefined,
      (error: unknown) => this.log(`inflight: ${errorText(error)}`),
    );
    return run;
  }
}

/** The value read from the key, or null when it is not one this store wrote. */
function parseValue(text: string): InflightValue | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const fields = value as Record<string, unknown>;
  if (fields.phase === 'closed' && typeof fields.action_id === 'string') {
    return { phase: 'closed', action_id: fields.action_id };
  }
  if (
    fields.phase === 'open' &&
    typeof fields.record === 'object' &&
    fields.record !== null &&
    typeof fields.item === 'string' &&
    typeof fields.count === 'number'
  ) {
    return {
      phase: 'open',
      record: fields.record as ActionRecord,
      item: fields.item,
      count: fields.count,
    };
  }
  return null;
}

/** The aborted receipt for an open give; its id is the one the give's own outcome would have had. */
function interruptedReceipt(record: ActionRecord, item: string, count: number, at: Date): Receipt {
  return {
    receipt_id: receiptIdFor(record.action_id, 'aborted'),
    action_id: record.action_id,
    life_id: record.life_id,
    kind: record.kind,
    phase: 'aborted',
    at: at.toISOString(),
    item,
    count,
    detail: INTERRUPTED_DETAIL,
  } as Receipt;
}

/** The give's action record, failed with reason `interrupted`. */
function interruptedRecord(record: ActionRecord): ActionRecord {
  return {
    ...record,
    state: 'failed',
    result: {
      status: 'failed',
      reason: 'interrupted',
      message: INTERRUPTED_DETAIL,
      latency_ms: 0,
      world_ticks: null,
      detail: {},
    },
    receipt_id: receiptIdFor(record.action_id, 'aborted'),
  } as ActionRecord;
}

/** True once the sink has sent what it holds; false after `SEND_TIMEOUT_MS`. A sink with no flush is sent. */
async function sent(sink: Flushable): Promise<boolean> {
  if (typeof sink.flush !== 'function') return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), SEND_TIMEOUT_MS);
  });
  try {
    return await Promise.race([sink.flush().then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
