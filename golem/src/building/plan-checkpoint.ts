// Plan checkpoint (BLD-05): the cursor, counts and a short skipped summary of a running plan.
// Stored under `<life_id>.plan` in the checkpoint bucket, in the background and with retries
// (the pattern of body/checkpoint.ts). Never more than 4 KiB.
import { errorText } from '../actions/outcome.ts';
import { type PlanKv, PlanStoreError, utf8Length } from './plan-store.ts';

/** The most UTF-8 bytes one stored plan checkpoint may hold. */
export const CHECKPOINT_LIMIT_BYTES = 4 * 1024;

/** One cell the plan skipped, with the reason code (`changed`, `missing_materials`, ...). */
export interface SkippedCell {
  at: [number, number, number];
  code: string;
}

/** What the lane saves: where the plan is and what it has done. */
export interface PlanCheckpointState {
  life_id: string;
  plan_id: string;
  /** Chunk count of the stored plan (`readPlan` needs it). */
  chunks: number;
  /** Index of the next cell to run. */
  cursor: number;
  /** Cells by outcome code. */
  counts: Record<string, number>;
  /** Every skipped cell; the encoded form keeps only what fits. */
  skipped: SkippedCell[];
}

/** The stored form: the summary is cut to fit, and `skipped_dropped` counts what was cut. */
export interface PlanCheckpoint extends PlanCheckpointState {
  skipped_dropped: number;
}

/** The key of a life's plan checkpoint in the checkpoint bucket. */
export function checkpointKey(lifeId: string): string {
  return `${lifeId}.plan`;
}

/**
 * Encodes a checkpoint to at most `limit` bytes. The skipped summary keeps its first entries in
 * order and the rest are counted in `skipped_dropped`. A checkpoint whose fixed fields alone are
 * over the limit is refused with `too_large`.
 */
export function encodeCheckpoint(
  state: PlanCheckpointState,
  limit = CHECKPOINT_LIMIT_BYTES,
): string {
  const encode = (kept: SkippedCell[]): string =>
    JSON.stringify({
      ...state,
      skipped: kept,
      skipped_dropped: state.skipped.length - kept.length,
    });
  if (utf8Length(encode([])) > limit) {
    throw new PlanStoreError(
      'too_large',
      `plan checkpoint without its summary is over ${limit} bytes`,
    );
  }
  const kept: SkippedCell[] = [];
  for (const cell of state.skipped) {
    if (utf8Length(encode([...kept, cell])) > limit) break;
    kept.push(cell);
  }
  return encode(kept);
}

/** Parses a stored checkpoint; null when it is not JSON or lacks a field the resume reads. */
export function parseCheckpoint(text: string): PlanCheckpoint | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const sound =
    typeof e.life_id === 'string' &&
    typeof e.plan_id === 'string' &&
    Number.isInteger(e.chunks) &&
    Number.isInteger(e.cursor) &&
    typeof e.counts === 'object' &&
    e.counts !== null &&
    Array.isArray(e.skipped) &&
    Number.isInteger(e.skipped_dropped);
  return sound ? (raw as PlanCheckpoint) : null;
}

/** Reads a life's plan checkpoint; null when there is none or it does not parse. */
export async function loadCheckpoint(kv: PlanKv, lifeId: string): Promise<PlanCheckpoint | null> {
  const text = await kv.get(checkpointKey(lifeId));
  return text === null ? null : parseCheckpoint(text);
}

/** Of a run of failed writes, one in this many is logged (the first always is). */
const LOG_EVERY_FAILURE = 30;

export interface PlanCheckpointWriterOptions {
  kv: PlanKv;
  lifeId: string;
  /** Where failed writes are reported; default `console.warn`. */
  log?: (line: string) => void;
  /** Tries per write, the first included; default 4. */
  attempts?: number;
  /** First wait between tries in ms, doubling each time; default 100. */
  retryDelayMs?: number;
}

/**
 * Saves a plan checkpoint without blocking the lane. A save returns at once; the newest waiting
 * state replaces an older one not yet written. A write is retried with backoff; after the last
 * allowed try it is logged (the first of a run, then one in 30) and the next save writes again.
 * A state already stored is not written again.
 */
export class PlanCheckpointWriter {
  private readonly kv: PlanKv;
  private readonly lifeId: string;
  private readonly key: string;
  private readonly log: (line: string) => void;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private waiting: string | null = null;
  private draining: Promise<void> | null = null;
  /** Text of the newest write handed over and not known to have failed. */
  private lastText: string | null = null;
  private failures = 0;

  constructor(options: PlanCheckpointWriterOptions) {
    this.kv = options.kv;
    this.lifeId = options.lifeId;
    this.key = checkpointKey(options.lifeId);
    this.log = options.log ?? ((line) => console.warn(line));
    this.attempts = options.attempts ?? 4;
    this.retryDelayMs = options.retryDelayMs ?? 100;
  }

  /** Queues a save of the state. Returns at once. */
  save(state: PlanCheckpointState): void {
    let text: string;
    try {
      text = encodeCheckpoint(state);
    } catch (error) {
      this.log(`plan checkpoint for ${this.lifeId} not saved: ${errorText(error)}`);
      return;
    }
    if (text === this.lastText) return;
    this.lastText = text;
    this.waiting = text;
    this.draining ??= this.drain();
  }

  /** Resolves once every save handed over so far has been tried. */
  async flush(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    while (this.waiting !== null) {
      const text = this.waiting;
      this.waiting = null;
      await this.put(text);
    }
    this.draining = null;
  }

  private async put(text: string): Promise<void> {
    let delay = this.retryDelayMs;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.kv.put(this.key, text);
        this.failures = 0;
        return;
      } catch (error) {
        if (attempt >= this.attempts) {
          if (this.lastText === text) this.lastText = null;
          if (this.failures++ % LOG_EVERY_FAILURE === 0) {
            this.log(
              `plan checkpoint for ${this.lifeId} not written after ${attempt} tries: ${errorText(error)}`,
            );
          }
          return;
        }
        if (this.waiting !== null) return;
        await sleep(delay);
        delay *= 2;
      }
    }
  }
}

/** Queues a save of the state through a writer. Returns at once. */
export function saveCheckpoint(writer: PlanCheckpointWriter, state: PlanCheckpointState): void {
  writer.save(state);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
