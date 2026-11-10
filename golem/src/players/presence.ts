/**
 * Follows the presence record of one life in the `geldar-presence` bucket (spec 5.2, 5.15.2): the
 * MCP writes `desired_body: up` while the player is awake and `down` once it hibernates. A record
 * that fails the contract, or names another life, is logged and ignored. A deleted key is not an
 * instruction, so an `always` player keeps its Body after its record is purged.
 */
import { type PresenceRecord, validatePresenceRecord } from '@geldar/contract';

/** What the host does for one record. */
export interface PresenceHandlers {
  /** Starts the player's Body (a no-op while it runs). */
  up(): Promise<void>;
  /** Stops the player's Body (a no-op while it is down). */
  down(): Promise<void>;
}

export interface PresenceWatchOptions {
  lifeId: string;
  /** The presence values of this life, in order: a record's JSON text, or null for a deletion. */
  entries: AsyncIterable<string | null>;
  handlers: PresenceHandlers;
  /** Ends the watch at once; the entries iterator is left behind. */
  signal: AbortSignal;
  log: (line: Record<string, unknown>) => void;
}

/** The record in a presence value, or null when it is not a valid record of `lifeId`. */
export function parsePresence(value: string, lifeId: string): PresenceRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const checked = validatePresenceRecord(parsed);
  if (!checked.ok || checked.value.life_id !== lifeId) return null;
  return checked.value;
}

/** Calls `up` or `down` for each presence record of the life until the signal aborts or the entries end. */
export async function watchPresence(options: PresenceWatchOptions): Promise<void> {
  const { lifeId, handlers, signal, log } = options;
  const iterator = options.entries[Symbol.asyncIterator]();
  const aborted = new Promise<IteratorResult<string | null>>((resolve) => {
    signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), {
      once: true,
    });
  });
  try {
    while (!signal.aborted) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done === true || signal.aborted) break;
      if (next.value === null) continue;
      const record = parsePresence(next.value, lifeId);
      if (record === null) {
        log({ event: 'presence_ignored', life_id: lifeId });
        continue;
      }
      log({
        event: 'presence',
        life_id: lifeId,
        state: record.state,
        desired_body: record.desired_body,
      });
      if (record.desired_body === 'up') await handlers.up();
      else await handlers.down();
    }
  } finally {
    // Not awaited: a pending `next` would hold the return until the next record arrives.
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}
