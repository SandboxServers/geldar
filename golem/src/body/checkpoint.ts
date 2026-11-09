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
}

type Write = { kind: 'put'; value: string } | { kind: 'delete' };

/**
 * Saves the running intent's checkpoint after each program step and deletes it when the intent
 * ends. Writes never block or throw into the step loop: they go out one at a time in the
 * background, a newer write replaces one still waiting, and a failure is logged and left for the
 * next step to redo. A Body that stops keeps its checkpoint (the executor does not report that end).
 */
export class CheckpointStore implements IntentObserver {
  private readonly kv: BodyKv;
  private readonly lifeId: string;
  private readonly generation: number;
  private readonly now: () => Date;
  private readonly log: (line: string) => void;
  private waiting: Write | null = null;
  private draining: Promise<void> | null = null;

  constructor(options: CheckpointStoreOptions) {
    this.kv = options.kv;
    this.lifeId = options.lifeId;
    this.generation = options.bodyGeneration;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((line) => console.warn(line));
  }

  /** Saves the state after a step. Returns at once. */
  stepped(step: StepSnapshot): void {
    try {
      const entry: CheckpointEntry = {
        life_id: this.lifeId,
        body_generation: this.generation,
        intent_id: step.intentId,
        intent: step.intent,
        program: step.intent.program,
        checkpoint: step.checkpoint,
        saved_at: this.now().toISOString(),
        expires_tick: step.expiresTick,
      };
      this.submit({ kind: 'put', value: JSON.stringify(entry) });
    } catch (error) {
      this.log(`checkpoint for ${this.lifeId} not saved: ${errorText(error)}`);
    }
  }

  /** Deletes the checkpoint: the intent ended. Returns at once. */
  ended(_intentId: string): void {
    this.submit({ kind: 'delete' });
  }

  /** Resolves once every write handed to the store so far has been tried. */
  async flush(): Promise<void> {
    while (this.draining) await this.draining;
  }

  /**
   * The stored entry for this life, or null when there is none or it cannot be read. A value
   * that does not parse as an entry is logged and treated as absent.
   */
  async load(): Promise<CheckpointEntry | null> {
    let record: KvRecord | null;
    try {
      record = await this.kv.get(this.lifeId);
    } catch (error) {
      this.log(`checkpoint for ${this.lifeId} not read: ${errorText(error)}`);
      return null;
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
      try {
        if (write.kind === 'put') await this.kv.put(this.lifeId, write.value);
        else await this.kv.delete(this.lifeId);
      } catch (error) {
        this.log(`checkpoint for ${this.lifeId} not written: ${errorText(error)}`);
      }
    }
    this.draining = null;
  }
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
  return sound ? (raw as CheckpointEntry) : null;
}
