// Plan store (BLD-05): chunked KV storage of plans under the KV value limit (decision 0423, rule 6).
import { errorText } from '../actions/outcome.ts';

/** The most UTF-8 bytes one stored chunk may hold. */
export const CHUNK_LIMIT_BYTES = 64 * 1024;

/** The slice of a JetStream KV bucket the plan store uses (a fake in tests). */
export interface PlanKv {
  /** Writes the value and returns its revision. Rejects when the write fails. */
  put(key: string, value: string): Promise<number>;
  /** The live value, or null when the key is missing or deleted. */
  get(key: string): Promise<string | null>;
  /** Removes the key. */
  delete(key: string): Promise<void>;
}

/**
 * `store`: a read, write or delete failed, or a chunk is missing (the plan is failed: store).
 * `too_large`: a value is over its byte cap, so it was not written.
 */
export type PlanStoreCode = 'store' | 'too_large';

export class PlanStoreError extends Error {
  readonly code: PlanStoreCode;

  constructor(code: PlanStoreCode, message: string) {
    super(message);
    this.name = 'PlanStoreError';
    this.code = code;
  }
}

/** The KV key of one chunk of a plan: `<life_id>.<plan_id>.<seq>`. */
export function chunkKey(lifeId: string, planId: string, seq: number): string {
  return `${lifeId}.${planId}.${seq}`;
}

/** The UTF-8 size of one code point. */
function byteSize(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** The UTF-8 size of a string. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) bytes += byteSize(ch.codePointAt(0) ?? 0);
  return bytes;
}

/**
 * Cuts text into pieces of at most `limit` UTF-8 bytes. A cut falls between code points, never
 * inside a surrogate pair. Joining the pieces gives the text back.
 */
export function splitIntoChunks(text: string, limit = CHUNK_LIMIT_BYTES): string[] {
  const chunks: string[] = [];
  let start = 0;
  let index = 0;
  let bytes = 0;
  for (const ch of text) {
    const size = byteSize(ch.codePointAt(0) ?? 0);
    if (bytes + size > limit) {
      chunks.push(text.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += size;
    index += ch.length;
  }
  chunks.push(text.slice(start));
  return chunks;
}

/** Stores one chunk. A chunk over `CHUNK_LIMIT_BYTES` is refused before any write. */
export async function putPlanChunk(
  kv: PlanKv,
  lifeId: string,
  planId: string,
  seq: number,
  text: string,
): Promise<void> {
  const bytes = utf8Length(text);
  if (bytes > CHUNK_LIMIT_BYTES) {
    throw new PlanStoreError(
      'too_large',
      `plan chunk ${seq} is ${bytes} bytes, over ${CHUNK_LIMIT_BYTES}`,
    );
  }
  try {
    await kv.put(chunkKey(lifeId, planId, seq), text);
  } catch (error) {
    throw new PlanStoreError('store', `plan chunk ${seq} not written: ${errorText(error)}`);
  }
}

/** Reads one chunk. A missing or unreadable chunk is a `store` failure, never an empty one. */
export async function readPlanChunk(
  kv: PlanKv,
  lifeId: string,
  planId: string,
  seq: number,
): Promise<string> {
  let text: string | null;
  try {
    text = await kv.get(chunkKey(lifeId, planId, seq));
  } catch (error) {
    throw new PlanStoreError('store', `plan chunk ${seq} not read: ${errorText(error)}`);
  }
  if (text === null) throw new PlanStoreError('store', `plan chunk ${seq} is missing`);
  return text;
}

/** Stores a whole plan text as chunks 0..n-1. Returns n; the caller keeps n to read or delete it. */
export async function writePlan(
  kv: PlanKv,
  lifeId: string,
  planId: string,
  text: string,
): Promise<number> {
  const chunks = splitIntoChunks(text);
  for (const [seq, chunk] of chunks.entries()) {
    await putPlanChunk(kv, lifeId, planId, seq, chunk);
  }
  return chunks.length;
}

/** Reads a plan of `count` chunks back whole. Any missing chunk fails the read; there is no partial plan. */
export async function readPlan(
  kv: PlanKv,
  lifeId: string,
  planId: string,
  count: number,
): Promise<string> {
  const parts: string[] = [];
  for (let seq = 0; seq < count; seq++) {
    parts.push(await readPlanChunk(kv, lifeId, planId, seq));
  }
  return parts.join('');
}

/**
 * Removes all `count` chunks of a plan. It tries every chunk; if any delete fails the result is a
 * `store` failure, and the chunks that were not removed stay for a later try.
 */
export async function deletePlan(
  kv: PlanKv,
  lifeId: string,
  planId: string,
  count: number,
): Promise<void> {
  let failed = 0;
  let last = '';
  for (let seq = 0; seq < count; seq++) {
    try {
      await kv.delete(chunkKey(lifeId, planId, seq));
    } catch (error) {
      failed++;
      last = errorText(error);
    }
  }
  if (failed > 0) {
    throw new PlanStoreError('store', `${failed} plan chunk(s) not deleted: ${last}`);
  }
}
