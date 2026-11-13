import {
  blockownerChangedSubject,
  blockownerQuerySubject,
  validateBlockOwner,
} from '@geldar/contract';
import { type OwnerAnswer, setOwnerLookup, setOwnerPrefetch } from '../actions/protected-blocks.ts';

/**
 * The Body's client of the block ownership record (decision 0165): one cache per Body, filled by
 * `geldar.<shard>.blockowner.query` and kept current by `geldar.<shard>.blockowner.changed`. Planning
 * reads it synchronously (`ownerAt`); a miss asks for the chunk in the background, so the next plan
 * has it. A block the record cannot answer (no chunk, truncated, a failed query) is unknown, and
 * `goto` treats unknown as protected (decisions 0164, 0165).
 */

/** How long a query may take before its chunk is unknown. */
export const OWNER_REQUEST_TIMEOUT_MS = 300;
/** Chunks held per Body; the least recently used is dropped first. */
export const OWNER_CACHE_CHUNKS = 256;
/** A complete chunk is asked again after this long. */
export const OWNER_TTL_MS = 10 * 60_000;
/** A failed query is asked again after this long, so a silent plugin costs one request per window. */
export const OWNER_RETRY_MS = 5_000;
/** The longest a tier-2 walk waits for its neighbourhood's chunks before it plans with what it has. */
export const OWNER_PREFETCH_WAIT_MS = 300;
/**
 * Queries one Body has in flight at once. The plugin answers on one thread with a queue of 32, and
 * six Bodies at 18 chunks each would overflow it (a full queue answers truncated), so the rest wait.
 */
export const OWNER_QUERIES_IN_FLIGHT = 4;

/** The slice of a NATS connection the client uses (the Body's own connection in production). */
export interface OwnerTransport {
  request(
    subject: string,
    data: Uint8Array,
    opts: { timeout: number },
  ): Promise<{ data: Uint8Array }>;
  subscribe(
    subject: string,
    opts: { callback: (err: unknown, msg: { data: Uint8Array }) => void },
  ): { unsubscribe(): void };
}

export interface BlockOwnersOptions {
  transport: OwnerTransport;
  shard: string;
  now?: () => number;
  requestTimeoutMs?: number;
  prefetchWaitMs?: number;
  log?: (line: string) => void;
}

/** The ownership client of one Body. */
export interface BlockOwners {
  /** The owner of one block now: a complete cached chunk answers, anything else is unknown. Misses ask. */
  ownerAt(world: string, x: number, y: number, z: number): OwnerAnswer;
  /** Fetches one chunk unless it is fresh or already on its way. Never rejects. */
  ensureChunk(world: string, cx: number, cz: number): Promise<void>;
  /** Fetches the 3x3 chunks around each point and waits at most the wait, or until `signal` aborts. */
  prefetch(
    world: string,
    points: ReadonlyArray<{ x: number; z: number }>,
    signal: AbortSignal,
  ): Promise<void>;
  /** Drops the subscription and every chunk. */
  stop(): void;
  chunkCount(): number;
}

interface ChunkEntry {
  owners: Map<string, string>;
  /** False for a truncated reply: the owned list is partial, so every cell reads as unknown. */
  complete: boolean;
  /** True for a query that failed (no reply, bad reply): retried after OWNER_RETRY_MS. */
  failed: boolean;
  fetchedAt: number;
}

interface ChangedEvent {
  world: string;
  x: number;
  y: number;
  z: number;
  owner: string | null;
}

interface ReplyEvent {
  world: string;
  chunk_x: number;
  chunk_z: number;
  blocks: Array<{ x: number; y: number; z: number; owner: string }>;
  truncated: boolean;
}

const chunkOf = (block: number): number => Math.floor(block / 16);
const chunkKey = (world: string, cx: number, cz: number): string => `${world}|${cx}|${cz}`;
const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** The Bukkit world each dimension is (decision 0164); the plugin answers to these names. */
const BUKKIT_WORLDS = new Map<string, string>([
  ['overworld', 'world'],
  ['the_nether', 'world_nether'],
  ['the_end', 'world_the_end'],
]);
const NAMESPACE = 'minecraft:';

/**
 * The Bukkit world the bot is in, or null when its dimension is not one the record names: the
 * namespace is stripped first (`minecraft:overworld` and `overworld` are the same). Null means no
 * query: the ownership is unknown, so goto protects the block.
 */
export function bukkitWorldOf(bot: { game?: { dimension?: string } }): string | null {
  const dimension = bot.game?.dimension;
  if (dimension === undefined) return null;
  const name = dimension.startsWith(NAMESPACE) ? dimension.slice(NAMESPACE.length) : dimension;
  return BUKKIT_WORLDS.get(name) ?? null;
}

const applyChange = (owners: Map<string, string>, change: ChangedEvent): void => {
  const cell = cellKey(change.x, change.y, change.z);
  if (change.owner === null) owners.delete(cell);
  else owners.set(cell, change.owner);
};

/** Starts one Body's ownership client: subscribes to the change events and answers lookups. */
export function startBlockOwners(options: BlockOwnersOptions): BlockOwners {
  const { transport } = options;
  const now = options.now ?? Date.now;
  const requestTimeout = options.requestTimeoutMs ?? OWNER_REQUEST_TIMEOUT_MS;
  const waitMs = options.prefetchWaitMs ?? OWNER_PREFETCH_WAIT_MS;
  const log = options.log ?? (() => undefined);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  /** Insertion order is the LRU order: the first key is the least recently used. */
  const chunks = new Map<string, ChunkEntry>();
  const pending = new Map<string, Promise<void>>();
  /**
   * Change events that arrived while a chunk's query was in flight. The reply may predate them, so
   * they are applied on top of it when it lands (in arrival order); cleared when the query settles.
   */
  const racing = new Map<string, ChangedEvent[]>();
  let stopped = false;
  /** Queries in flight, and the ones waiting for a slot (first come, first sent). */
  let inFlight = 0;
  const waiting: Array<() => void> = [];
  const releaseSlot = (): void => {
    const next = waiting.shift();
    // The slot passes straight to the next waiter, so the count stays as it was.
    if (next) next();
    else inFlight--;
  };
  /** Runs one query now when a slot is free (its request leaves at once), else when one frees. */
  const runQuery = (query: () => Promise<void>): Promise<void> => {
    const run = (): Promise<void> => query().finally(releaseSlot);
    if (inFlight < OWNER_QUERIES_IN_FLIGHT) {
      inFlight++;
      return run();
    }
    return new Promise<void>((resolve) => waiting.push(resolve)).then(run);
  };

  const store = (key: string, entry: ChunkEntry): void => {
    chunks.delete(key);
    chunks.set(key, entry);
    if (chunks.size > OWNER_CACHE_CHUNKS) {
      const oldest = chunks.keys().next().value;
      if (oldest !== undefined) chunks.delete(oldest);
    }
  };

  const fetchChunk = async (world: string, cx: number, cz: number, key: string): Promise<void> => {
    const failed = (reason: string): void => {
      log(`block owner query for ${world} ${cx},${cz} failed: ${reason}`);
      store(key, { owners: new Map(), complete: false, failed: true, fetchedAt: now() });
    };
    let reply: unknown;
    try {
      const query = { world, chunk_x: cx, chunk_z: cz };
      const msg = await transport.request(
        blockownerQuerySubject(options.shard),
        encoder.encode(JSON.stringify(query)),
        { timeout: requestTimeout },
      );
      reply = JSON.parse(decoder.decode(msg.data));
    } catch (error) {
      failed(String(error));
      return;
    }
    const answer = reply as Partial<ReplyEvent> | null;
    if (
      !validateBlockOwner(reply) ||
      answer === null ||
      !Array.isArray(answer.blocks) ||
      answer.world !== world ||
      answer.chunk_x !== cx ||
      answer.chunk_z !== cz
    ) {
      failed('the reply does not match the contract');
      return;
    }
    const owners = new Map<string, string>();
    for (const block of answer.blocks) owners.set(cellKey(block.x, block.y, block.z), block.owner);
    for (const change of racing.get(key) ?? []) applyChange(owners, change);
    store(key, {
      owners,
      complete: answer.truncated !== true,
      failed: false,
      fetchedAt: now(),
    });
  };

  const ensureChunk = (world: string, cx: number, cz: number): Promise<void> => {
    const key = chunkKey(world, cx, cz);
    const inFlight = pending.get(key);
    if (inFlight !== undefined) return inFlight;
    const entry = chunks.get(key);
    if (entry !== undefined) {
      const age = now() - entry.fetchedAt;
      if (entry.failed ? age < OWNER_RETRY_MS : age < OWNER_TTL_MS) return Promise.resolve();
    }
    if (stopped) return Promise.resolve();
    racing.set(key, []);
    const job = runQuery(() => fetchChunk(world, cx, cz, key)).finally(() => {
      pending.delete(key);
      racing.delete(key);
    });
    pending.set(key, job);
    return job;
  };

  const ownerAt = (world: string, x: number, y: number, z: number): OwnerAnswer => {
    const cx = chunkOf(x);
    const cz = chunkOf(z);
    const key = chunkKey(world, cx, cz);
    // A no-op while the chunk is fresh or on its way; a miss or a stale chunk is asked for now.
    void ensureChunk(world, cx, cz);
    const entry = chunks.get(key);
    if (entry === undefined || !entry.complete) return { known: false };
    chunks.delete(key);
    chunks.set(key, entry);
    return { known: true, owner: entry.owners.get(cellKey(x, y, z)) ?? null };
  };

  const onChanged = (err: unknown, msg: { data: Uint8Array }): void => {
    if (err || stopped) return;
    let event: unknown;
    try {
      event = JSON.parse(decoder.decode(msg.data));
    } catch {
      return;
    }
    if (!validateBlockOwner(event) || !('x' in (event as object))) return;
    const change = event as ChangedEvent;
    const key = chunkKey(change.world, chunkOf(change.x), chunkOf(change.z));
    racing.get(key)?.push(change);
    const entry = chunks.get(key);
    if (entry !== undefined) applyChange(entry.owners, change);
  };

  const subscription = transport.subscribe(blockownerChangedSubject(options.shard), {
    callback: onChanged,
  });

  const prefetch = async (
    world: string,
    points: ReadonlyArray<{ x: number; z: number }>,
    signal: AbortSignal,
  ): Promise<void> => {
    const wanted = new Map<string, [number, number]>();
    // The chunk each point stands in goes first (the bot's, then the goal's), then the rest of the 3x3.
    for (const point of points) {
      wanted.set(chunkKey(world, chunkOf(point.x), chunkOf(point.z)), [
        chunkOf(point.x),
        chunkOf(point.z),
      ]);
    }
    for (const point of points) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cx = chunkOf(point.x) + dx;
          const cz = chunkOf(point.z) + dz;
          wanted.set(chunkKey(world, cx, cz), [cx, cz]);
        }
      }
    }
    const jobs = [...wanted.values()].map(([cx, cz]) => ensureChunk(world, cx, cz));
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, waitMs);
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener('abort', finish, { once: true });
      void Promise.all(jobs).then(finish);
    });
  };

  return {
    ownerAt,
    ensureChunk,
    prefetch,
    stop(): void {
      stopped = true;
      try {
        subscription.unsubscribe();
      } catch {
        // The connection may already be closed; nothing is left to undo.
      }
      chunks.clear();
    },
    chunkCount: () => chunks.size,
  };
}

/**
 * Wires one Body's ownership client into the goto planner: the lookup and the tier-2 prefetch. The
 * world is read at each call, so a portal changes it at once. A dimension with no Bukkit world is
 * unknown without a query. The returned `stop` clears both and drops the subscription (the Body is
 * stopped or replaced).
 */
export function wireBlockOwners(
  options: BlockOwnersOptions & { bot: { game?: { dimension?: string } } },
): { stop(): void } {
  const owners = startBlockOwners(options);
  setOwnerLookup((pos) => {
    const world = bukkitWorldOf(options.bot);
    if (world === null) return { known: false };
    return owners.ownerAt(world, pos.x, pos.y, pos.z);
  });
  setOwnerPrefetch((points, signal) => {
    const world = bukkitWorldOf(options.bot);
    return world === null ? Promise.resolve() : owners.prefetch(world, points, signal);
  });
  return {
    stop(): void {
      setOwnerLookup(null);
      setOwnerPrefetch(null);
      owners.stop();
    },
  };
}
