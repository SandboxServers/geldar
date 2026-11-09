import type { BodyKv } from './checkpoint.ts';

/** The JetStream KV bucket that holds each life's `body_generation`, keyed by `life_id`. */
export const GENERATION_BUCKET = 'geldar-body-generation';

/** How `nextGeneration` retries. */
export interface GenerationOptions {
  /** Attempts before giving up; default 20. */
  attempts?: number;
  /** Wait between attempts in ms; default 25. */
  retryDelayMs?: number;
}

/**
 * Takes the next `body_generation` for a life: reads the stored value, writes value + 1 only if
 * the key is still at the revision read (the first start creates the key at 1), and retries when
 * another start got there first or the bucket fails. Two starts that race therefore never get
 * the same number. Throws once `attempts` are used up, or when the stored value is not a count
 * (guessing would risk reusing a generation).
 */
export async function nextGeneration(
  kv: BodyKv,
  lifeId: string,
  options: GenerationOptions = {},
): Promise<number> {
  const attempts = options.attempts ?? 20;
  const delay = options.retryDelayMs ?? 25;
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const record = await kv.get(lifeId);
      if (record === null) {
        await kv.create(lifeId, '1');
        return 1;
      }
      const current = Number(record.value);
      if (!Number.isInteger(current) || current < 0) {
        throw new GenerationCorrupt(`body generation for ${lifeId} is "${record.value}"`);
      }
      await kv.update(lifeId, String(current + 1), record.revision);
      return current + 1;
    } catch (error) {
      if (error instanceof GenerationCorrupt) throw error;
      last = error;
    }
  }
  throw new Error(`could not take a body generation for ${lifeId} in ${attempts} attempts`, {
    cause: last,
  });
}

/** The stored generation is not a count: not retried. */
class GenerationCorrupt extends Error {}
