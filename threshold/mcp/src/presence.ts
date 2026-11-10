/**
 * The presence store over the `geldar-presence` KV bucket (spec 5.15.2, Wave M design). The MCP
 * writes one `PresenceRecord` per life: awake while a wait is open or a call came within the last
 * 60 s, dim after that, and hibernating after 10 minutes with `desired_body: down`. The player host
 * starts the Body on `up` and stops it on `down`.
 */
import { PRESENCE_BUCKET, type PresenceRecord, validatePresenceRecord } from '@geldar/contract';
import type { PresenceStore } from './ports.ts';

/** How long after the last touch a life stays awake (spec 5.15.2: a call within 60 s). */
export const AWAKE_WINDOW_MS = 60_000;

/** How long after the last touch a life stays dim before it hibernates (10 minutes). */
export const HIBERNATE_AFTER_MS = 600_000;

/** A touch of an awake life this recent is not written again (the wait poll's write rate). */
export const TOUCH_SKIP_MS = 5_000;

/** The part of a KV bucket the presence store uses; the NATS KV bucket satisfies it. */
export interface PresenceBucket {
  get(key: string): Promise<{ string(): string; revision: number } | null>;
  put(key: string, value: string): Promise<number>;
  /** Every key in the bucket. */
  keys(): Promise<AsyncIterable<string>>;
  /** Writes `value` only while the key is still at `revision`; rejects when it has moved on. */
  update(key: string, value: string, revision: number): Promise<number>;
}

/** How many times `settle` reads and decides again after a lost compare-and-set write. */
export const SETTLE_ATTEMPTS = 3;

/** Opens or creates a KV bucket by name; the NATS `Kvm` satisfies it. */
export interface BucketManager {
  open(name: string): Promise<PresenceBucket>;
  create(name: string): Promise<PresenceBucket>;
}

/**
 * Opens the presence bucket, creating it first when it is not there. The MCP starts before the
 * player host, which opens the same bucket and fails when it is missing, so the MCP creates it.
 */
export async function openPresenceBucket(
  manager: BucketManager,
  name: string = PRESENCE_BUCKET,
): Promise<PresenceBucket> {
  try {
    return await manager.open(name);
  } catch {
    return manager.create(name);
  }
}

/** The presence record in a stored value, or null when it is not JSON or not a valid record. */
function parseRecord(text: string): PresenceRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const checked = validatePresenceRecord(parsed);
  return checked.ok ? checked.value : null;
}

/** The state and the Body's desired state for a life last touched at `lastMs`, seen at `nowMs`. */
export function presenceAt(
  lastMs: number,
  nowMs: number,
): Pick<PresenceRecord, 'state' | 'desired_body'> {
  const age = Math.max(0, nowMs - lastMs);
  if (age < AWAKE_WINDOW_MS) return { state: 'awake', desired_body: 'up' };
  if (age < HIBERNATE_AFTER_MS) return { state: 'dim', desired_body: 'up' };
  return { state: 'hibernating', desired_body: 'down' };
}

/** A `PresenceStore` over a KV bucket, with a clock the caller injects. */
export class KvPresenceStore implements PresenceStore {
  private readonly bucket: PresenceBucket;
  private readonly now: () => number;

  constructor(bucket: PresenceBucket, now: () => number) {
    this.bucket = bucket;
    this.now = now;
  }

  /** The stored record, or null when none is written or the stored value is not a record. */
  async read(lifeId: string): Promise<PresenceRecord | null> {
    return (await this.entry(lifeId))?.record ?? null;
  }

  /** Every life that has a presence record in the bucket, as keys (a restarted world seeds from them). */
  async lifeIds(): Promise<string[]> {
    const ids: string[] = [];
    for await (const key of await this.bucket.keys()) ids.push(key);
    return ids;
  }

  /** A call asks for the Body to be up. */
  async wantBody(lifeId: string, nowMs: number): Promise<void> {
    await this.write(lifeId, nowMs);
  }

  /**
   * A wait marks the life as watched now: awake, with the Body up. A life already awake with the
   * Body up and a touch under `TOUCH_SKIP_MS` old is left alone, so a wait's poll writes every few
   * seconds rather than every second; the 60 s window still runs from a touch at most that old.
   */
  async touch(lifeId: string): Promise<void> {
    const nowMs = this.now();
    const stored = await this.read(lifeId);
    const age = stored === null ? -1 : nowMs - Date.parse(stored.at);
    const fresh =
      stored !== null &&
      stored.state === 'awake' &&
      stored.desired_body === 'up' &&
      age >= 0 &&
      age < TOUCH_SKIP_MS;
    if (fresh) return;
    await this.write(lifeId, nowMs);
  }

  /**
   * Brings the stored state down to what the time since the last touch says. It keeps `at`, the
   * last touch, so the state keeps aging; it writes only when the state or `desired_body` changes.
   * The write is conditional on the revision it read: a write that lost a race (a touch landed in
   * between) reads again and decides again, at most `SETTLE_ATTEMPTS` times.
   */
  async settle(lifeId: string): Promise<PresenceRecord | null> {
    for (let attempt = 1; ; attempt++) {
      const entry = await this.entry(lifeId);
      if (entry === null || entry.record === null) return null;
      const { record, revision } = entry;
      const next = presenceAt(Date.parse(record.at), this.now());
      if (next.state === record.state && next.desired_body === record.desired_body) return record;
      const settled: PresenceRecord = { ...record, ...next };
      try {
        await this.bucket.update(lifeId, JSON.stringify(settled), revision);
        return settled;
      } catch (err) {
        if (attempt >= SETTLE_ATTEMPTS) throw err;
      }
    }
  }

  /** The stored record with its revision; the record is null when the stored value is not one. */
  private async entry(
    lifeId: string,
  ): Promise<{ record: PresenceRecord | null; revision: number } | null> {
    const stored = await this.bucket.get(lifeId);
    if (stored === null) return null;
    return { record: parseRecord(stored.string()), revision: stored.revision };
  }

  private async write(lifeId: string, atMs: number): Promise<void> {
    const record: PresenceRecord = {
      life_id: lifeId,
      state: 'awake',
      desired_body: 'up',
      at: new Date(atMs).toISOString(),
    };
    await this.bucket.put(lifeId, JSON.stringify(record));
  }
}
