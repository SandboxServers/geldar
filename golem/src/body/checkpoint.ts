import type { Thought } from '@geldar/contract';
import type { KV } from '@nats-io/kv';
import { errorText } from '../actions/outcome.ts';
import type { IntentObserver, StepSnapshot } from './executor.ts';
import type { ProgramCheckpoint } from './program.ts';

type Intent = NonNullable<Thought['intent']>;

/** The JetStream KV bucket that holds each life's running-intent checkpoint, keyed by `life_id`. */
export const CHECKPOINT_BUCKET = 'geldar-checkpoints';

/** One stored value: its text and the bucket revision it was read at. */
export interface KvRecord {
  value: string;
  revision: number;
}

/** The slice of a JetStream KV bucket the Body's restart state uses (a fake in tests). */
export interface BodyKv {
  /** The live value, or null when the key is missing or deleted. */
  get(key: string): Promise<KvRecord | null>;
  /** Writes only when the key does not exist; rejects otherwise. Returns the new revision. */
  create(key: string, value: string): Promise<number>;
  /** Writes only when the key is still at `revision`; rejects otherwise. Returns the new revision. */
  update(key: string, value: string, revision: number): Promise<number>;
  put(key: string, value: string): Promise<number>;
  delete(key: string): Promise<void>;
}

/** Adapts a real JetStream KV bucket to `BodyKv`. */
export function natsBodyKv(kv: KV): BodyKv {
  return {
    async get(key) {
      const entry = await kv.get(key);
      if (entry === null || entry.operation !== 'PUT') return null;
      return { value: entry.string(), revision: entry.revision };
    },
    create: (key, value) => kv.create(key, value),
    update: (key, value, revision) => kv.update(key, value, revision),
    put: (key, value) => kv.put(key, value),
    delete: (key) => kv.delete(key),
  };
}

/** What `geldar-checkpoints/<life_id>` holds: enough to resume the running intent. */
export interface CheckpointEntry {
  life_id: string;
  body_generation: number;
  intent_id: string;
  /** The intent as the executor accepted it. */
  intent: Intent;
  /** The program name (`intent.program`), kept for a reader that does not parse the intent. */
  program: string;
  /** The program's saved state; null when it had none. */
  checkpoint: ProgramCheckpoint | null;
  /** ISO wall-clock time of the save. */
  saved_at: string;
  /** World tick from which the intent is past its `max_world_ticks`. */
  expires_tick: number;
  /** Block operations spent so far, so a resumed intent keeps its used budget. */
  block_operations_used: number;
}

/** What a `CheckpointStore` is built from. */
export interface CheckpointStoreOptions {
  kv: BodyKv;
  lifeId: string;
  /** The generation of this Body, stored in every entry. */
  bodyGeneration: number;
  now?: () => Date;
  /** Where failed writes are reported; default `console.warn`. */
  log?: (line: string) => void;
  /** Tries per delete and per `load`; default 4. */
  attempts?: number;
  /** First wait between tries in ms, doubling each time; default 100. */
  retryDelayMs?: number;
}

/** A write waiting its turn; a put carries the content it would store, minus the save time. */
type Write = { kind: 'put'; value: string; content: string } | { kind: 'delete' };

/** The stored checkpoint could not be read after the retries (the bucket failed, not "no entry"). */
export class CheckpointUnreadable extends Error {}

/** Of a run of failed writes, one in this many is logged (the first always is). */
const LOG_EVERY_FAILURE = 30;

/**
 * Saves the running intent's checkpoint after each program step and deletes it when the intent
 * ends. Writes never block or throw into the step loop: they go out one at a time in the
 * background, a newer write replaces one still waiting, and a failed put is logged (the first of a
 * run, then one in 30) and left for the next step to redo. A step whose entry equals the last one
 * stored is not written again. A failed delete is retried with backoff, since a stale entry would
 * be resumed after the next restart. A Body that stops keeps its checkpoint (the executor does not
 * report that end).
 */
export class CheckpointStore implements IntentObserver {
  private readonly kv: BodyKv;
  private readonly lifeId: string;
  private readonly generation: number;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private waiting: Write | null = null;
  private draining: Promise<void> | null = null;
  /** Content of the newest put handed over and not known to have failed; null after a delete. */
  private lastContent: string | null = null;
  private failures = 0;

  constructor(options: CheckpointStoreOptions) {
    this.kv = options.kv;
    this.lifeId = options.lifeId;
    this.generation = options.bodyGeneration;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((line) => console.warn(line));
    this.attempts = options.attempts ?? 4;
    this.retryDelayMs = options.retryDelayMs ?? 100;
  }

  /** Saves the state after a step, unless it is what is already stored. Returns at once. */
  stepped(step: StepSnapshot): void {
    try {
      const entry: CheckpointEntry = {
        life_id: this.lifeId,
        body_generation: this.generation,
        intent_id: step.intentId,
        intent: step.intent,
        program: step.intent.program,
        checkpoint: step.checkpoint,
        saved_at: '',
        expires_tick: step.expiresTick,
        block_operations_used: step.blockOperationsUsed,
      };
      const content = JSON.stringify(entry);
      if (content === this.lastContent) return;
      this.lastContent = content;
      entry.saved_at = this.now().toISOString();
      this.submit({ kind: 'put', value: JSON.stringify(entry), content });
    } catch (error) {
      this.log(`checkpoint for ${this.lifeId} not saved: ${errorText(error)}`);
    }
  }

  /** Deletes the checkpoint: the intent ended. Returns at once. */
  ended(_intentId: string): void {
    this.lastContent = null;
    this.submit({ kind: 'delete' });
  }

  /** Resolves once every write handed to the store so far has been tried. */
  async flush(): Promise<void> {
    while (this.draining) await this.draining;
  }

  /**
   * The stored entry for this life, or null when there is none. A value that does not parse as an
   * entry is logged and treated as absent. A bucket that fails is tried `attempts` times, then
   * throws `CheckpointUnreadable`: an unreadable bucket is not an empty one.
   */
  async load(): Promise<CheckpointEntry | null> {
    let record: KvRecord | null = null;
    let last: unknown = null;
    let delay = this.retryDelayMs;
    for (let attempt = 1; ; attempt++) {
      try {
        record = await this.kv.get(this.lifeId);
        break;
      } catch (error) {
        last = error;
        this.log(`checkpoint for ${this.lifeId} not read (try ${attempt}): ${errorText(error)}`);
        if (attempt >= this.attempts) {
          throw new CheckpointUnreadable(
            `checkpoint for ${this.lifeId} unreadable after ${attempt} tries: ${errorText(last)}`,
          );
        }
        await sleep(delay);
        delay *= 2;
      }
    }
    if (record === null) return null;
    const entry = parseEntry(record.value);
    if (entry === null) this.log(`checkpoint for ${this.lifeId} is not a valid entry; ignored`);
    return entry;
  }

  /** Removes the stored entry (an expired or unusable one). Failures are logged. */
  async discard(): Promise<void> {
    try {
      await this.kv.delete(this.lifeId);
    } catch (error) {
      this.log(`checkpoint for ${this.lifeId} not deleted: ${errorText(error)}`);
    }
  }

  private submit(write: Write): void {
    this.waiting = write;
    this.draining ??= this.drain();
  }

  private async drain(): Promise<void> {
    while (this.waiting) {
      const write = this.waiting;
      this.waiting = null;
      if (write.kind === 'put') await this.put(write);
      else await this.remove();
    }
    this.draining = null;
  }

  private async put(write: Extract<Write, { kind: 'put' }>): Promise<void> {
    try {
      await this.kv.put(this.lifeId, write.value);
      this.failures = 0;
    } catch (error) {
      // Not stored: the next step must write it again even if its content is the same.
      if (this.lastContent === write.content) this.lastContent = null;
      if (this.failures++ % LOG_EVERY_FAILURE === 0) {
        this.log(`checkpoint for ${this.lifeId} not written: ${errorText(error)}`);
      }
    }
  }

  /** Deletes with backoff; a newer write that arrives meanwhile makes the retry pointless. */
  private async remove(): Promise<void> {
    let delay = this.retryDelayMs;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.kv.delete(this.lifeId);
        return;
      } catch (error) {
        if (attempt >= this.attempts) {
          this.log(
            `checkpoint for ${this.lifeId} not deleted after ${attempt} tries, a stale entry stays: ${errorText(error)}`,
          );
          return;
        }
        if (this.waiting) return;
        await sleep(delay);
        delay *= 2;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Parses a stored value; null when it is not JSON or lacks a field `resume` relies on. */
export function parseEntry(text: string): CheckpointEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const intent = e.intent as Record<string, unknown> | null | undefined;
  const sound =
    typeof e.life_id === 'string' &&
    Number.isInteger(e.body_generation) &&
    typeof e.intent_id === 'string' &&
    typeof e.program === 'string' &&
    typeof e.saved_at === 'string' &&
    typeof e.expires_tick === 'number' &&
    Number.isFinite(e.expires_tick) &&
    typeof intent === 'object' &&
    intent !== null &&
    typeof intent.program === 'string' &&
    (e.checkpoint === null || (typeof e.checkpoint === 'object' && !Array.isArray(e.checkpoint)));
  if (!sound) return null;
  // An entry saved before the budget was kept resumes with none used.
  const used = e.block_operations_used;
  const entry = raw as CheckpointEntry;
  entry.block_operations_used =
    typeof used === 'number' && Number.isFinite(used) && used > 0 ? used : 0;
  return entry;
}
