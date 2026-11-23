// Seen-map store (BLD-18). Each life's sections are kept in KV, one key per section, under that life's id
// (decision 0424). Dirty sections are flushed on an interval, compressed. Death erases nothing. The next life of
// the same agent reads its predecessor's sections and merges them under its own life id, keeping each cell's
// last-seen tick and marking it inherited. A different agent's sections are never read.
import { deflateSync, inflateSync } from 'node:zlib';
import { errorText } from '../../actions/outcome.ts';
import { type CellRef, SECTION_SIZE, Section, type SeenCell, sectionOf } from './section.ts';

/** Dirty sections are flushed this often. */
export const FLUSH_INTERVAL_MS = 30_000;
/** One stored section value (compressed, base64) is under this many UTF-8 bytes (the KV value limit). */
export const SECTION_BYTE_LIMIT = 64 * 1024;
/** Clean sections kept in memory; the least recently seen are evicted beyond this. Dirty ones are never evicted. */
export const MEMORY_SECTION_LIMIT = 256;

const CELLS = SECTION_SIZE * SECTION_SIZE * SECTION_SIZE;
const MAX_TICK = 0xffffffff;

/** The slice of a KV bucket the seen store uses (a fake in tests). */
export interface SeenKv {
  /** Writes the value. Rejects when the write fails. */
  put(key: string, value: string): Promise<unknown>;
  /** The live value, or null when the key is missing or deleted. */
  get(key: string): Promise<string | null>;
  /** Removes the key. */
  delete(key: string): Promise<void>;
  /** The live keys that start with `prefix`. */
  list(prefix: string): Promise<string[]>;
}

/** The life a new life succeeds, and the agent it belongs to. */
export interface Predecessor {
  lifeId: string;
  agentId: string;
}

export interface SeenStoreOptions {
  kv: SeenKv;
  lifeId: string;
  agentId: string;
  /** Finds the predecessor life in the life registry. Null or absent for a first life. */
  predecessor?: () => Promise<Predecessor | null>;
  memoryLimit?: number;
}

/** A cell as read: the block name, its last-seen tick, and whether it was inherited from a predecessor life. */
export interface StoredCell extends SeenCell {
  inherited: boolean;
}

export interface FlushResult {
  written: number;
  failed: number;
  /** UTF-8 bytes of the sections written (the seen flush bytes metric). */
  bytes: number;
}

/** One cell as stored: local index, block name, last-seen tick, inherited flag (1 or 0). */
type Cell = [local: number, name: string, tick: number, inherited: 0 | 1];
/** A cell as read: the inherited flag is absent in a section written before the flag existed (read as 0). */
type StoredTuple = [local: number, name: string, tick: number, inherited?: 0 | 1];

interface Entry {
  section: Section;
  inherited: Uint8Array;
  dirty: boolean;
  version: number;
  latest: number;
}

/** The KV key of one section of a life: `<life_id>.<sx>.<sy>.<sz>`. */
export function sectionKey(lifeId: string, ref: CellRef): string {
  return `${lifeId}.${ref.sx}.${ref.sy}.${ref.sz}`;
}

function newEntry(): Entry {
  return {
    section: new Section(),
    inherited: new Uint8Array(CELLS),
    dirty: false,
    version: 0,
    latest: 0,
  };
}

function isCell(value: unknown): value is StoredTuple {
  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4)) return false;
  const [local, name, tick, inherited] = value;
  return (
    Number.isInteger(local) &&
    (local as number) >= 0 &&
    (local as number) < CELLS &&
    typeof name === 'string' &&
    name.length > 0 &&
    Number.isInteger(tick) &&
    (tick as number) >= 0 &&
    (tick as number) <= MAX_TICK &&
    (inherited === undefined || inherited === 0 || inherited === 1)
  );
}

/** Reads a stored section. Anything unreadable (not base64 or deflate, not JSON, a bad cell) gives null. */
function decodeCells(value: string): Cell[] | null {
  try {
    const parsed = JSON.parse(inflateSync(Buffer.from(value, 'base64')).toString('utf8')) as {
      v?: unknown;
      cells?: unknown;
    };
    if (parsed.v !== 1 || !Array.isArray(parsed.cells)) return null;
    if (!parsed.cells.every(isCell)) return null;
    return parsed.cells.map(
      ([local, name, tick, inherited]): Cell => [local, name, tick, inherited === 1 ? 1 : 0],
    );
  } catch {
    return null;
  }
}

/** Compresses a section's cells. A value over the byte limit is refused: it is never written. */
function encodeEntry(entry: Entry): string {
  const cells: Cell[] = [];
  for (let local = 0; local < CELLS; local++) {
    const cell = entry.section.get(local);
    if (cell) cells.push([local, cell.name, cell.lastSeen, entry.inherited[local] === 1 ? 1 : 0]);
  }
  const value = deflateSync(JSON.stringify({ v: 1, cells })).toString('base64');
  const bytes = Buffer.byteLength(value);
  if (bytes > SECTION_BYTE_LIMIT) {
    throw new RangeError(`section is ${bytes} bytes, over ${SECTION_BYTE_LIMIT}`);
  }
  return value;
}

function absorb(entry: Entry, local: number, name: string, tick: number, inherited: 0 | 1): void {
  entry.section.set(local, name, tick, inherited === 1);
  entry.inherited[local] = inherited;
  entry.latest = Math.max(entry.latest, tick);
  entry.dirty = true;
  entry.version++;
}

function entryFromCells(cells: Cell[]): Entry {
  const entry = newEntry();
  for (const [local, name, tick, inherited] of cells) absorb(entry, local, name, tick, inherited);
  entry.dirty = false;
  entry.version = 0;
  return entry;
}

export class SeenStore {
  private readonly kv: SeenKv;
  private readonly lifeId: string;
  private readonly agentId: string;
  private readonly predecessor: (() => Promise<Predecessor | null>) | undefined;
  private readonly memoryLimit: number;
  private readonly entries = new Map<string, Entry>();
  private inFlight: Promise<FlushResult> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Flush runs so far (for the BLD-29 measurement). */
  flushes = 0;
  /** Stored sections that could not be read and were dropped. */
  dropped = 0;

  constructor(opts: SeenStoreOptions) {
    this.kv = opts.kv;
    this.lifeId = opts.lifeId;
    this.agentId = opts.agentId;
    this.predecessor = opts.predecessor;
    this.memoryLimit = opts.memoryLimit ?? MEMORY_SECTION_LIMIT;
  }

  /** Loads a section of this life into memory, or a fresh one. A failed read throws and changes nothing. */
  private async entryFor(key: string): Promise<Entry> {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const loaded = await this.loadEntry(key);
    const raced = this.entries.get(key);
    if (raced) return raced;
    const entry = loaded ?? newEntry();
    this.entries.set(key, entry);
    return entry;
  }

  /** The stored section under `key`, or null when it is missing or unreadable (then dropped). */
  private async loadEntry(key: string): Promise<Entry | null> {
    const value = await this.kv.get(key);
    if (value === null) return null;
    const cells = decodeCells(value);
    if (cells === null) {
      this.dropped++;
      return null;
    }
    return entryFromCells(cells);
  }

  /**
   * Records a block seen (or placed or broken) by this life. A sighting by this life is not inherited; `inherited` is
   * set only when a predecessor's cell is recorded, and it is stored with the cell so a reload keeps the mark.
   */
  async record(
    x: number,
    y: number,
    z: number,
    name: string,
    tick: number,
    inherited = false,
  ): Promise<void> {
    const ref = sectionOf(x, y, z);
    const entry = await this.entryFor(sectionKey(this.lifeId, ref));
    absorb(entry, ref.local, name, tick, inherited ? 1 : 0);
  }

  /** Reads one cell of this life, from memory or KV. Undefined when the cell is unseen. */
  async read(x: number, y: number, z: number): Promise<StoredCell | undefined> {
    const ref = sectionOf(x, y, z);
    const key = sectionKey(this.lifeId, ref);
    const entry = this.entries.get(key) ?? (await this.loadEntry(key));
    const cell = entry?.section.get(ref.local);
    if (!entry || !cell) return undefined;
    return {
      name: cell.name,
      lastSeen: cell.lastSeen,
      inherited: entry.inherited[ref.local] === 1,
    };
  }

  /**
   * Merges the predecessor life's sections into this life, under this life's id. A cell this life already has is
   * kept. Returns the number of cells inherited. A predecessor of another agent is never read.
   */
  async inherit(): Promise<number> {
    const pred = this.predecessor ? await this.predecessor() : null;
    if (!pred || pred.agentId !== this.agentId || pred.lifeId === this.lifeId) return 0;
    const prefix = `${pred.lifeId}.`;
    let inherited = 0;
    for (const key of await this.kv.list(prefix)) {
      const value = await this.kv.get(key);
      if (value === null) continue;
      const cells = decodeCells(value);
      if (cells === null) {
        this.dropped++;
        continue;
      }
      const entry = await this.entryFor(`${this.lifeId}.${key.slice(prefix.length)}`);
      for (const [local, name, tick] of cells) {
        if (entry.section.get(local) !== undefined) continue;
        absorb(entry, local, name, tick, 1);
        inherited++;
      }
    }
    return inherited;
  }

  /** Writes every dirty section. A failed write leaves its section dirty for the next flush. Concurrent calls share one run. */
  flush(): Promise<FlushResult> {
    this.inFlight ??= this.writeDirty().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async writeDirty(): Promise<FlushResult> {
    this.flushes++;
    const result: FlushResult = { written: 0, failed: 0, bytes: 0 };
    for (const [key, entry] of this.entries) {
      if (!entry.dirty) continue;
      const version = entry.version;
      try {
        const value = encodeEntry(entry);
        await this.kv.put(key, value);
        if (entry.version === version) entry.dirty = false;
        result.written++;
        result.bytes += Buffer.byteLength(value);
      } catch {
        result.failed++;
      }
    }
    this.evict();
    return result;
  }

  /** Drops the least recently seen clean sections from memory until the limit holds. Reads still reach KV. */
  private evict(): void {
    if (this.entries.size <= this.memoryLimit) return;
    const clean = [...this.entries.entries()]
      .filter(([, entry]) => !entry.dirty)
      .sort((a, b) => a[1].latest - b[1].latest);
    for (const [key] of clean) {
      if (this.entries.size <= this.memoryLimit) break;
      this.entries.delete(key);
    }
  }

  /** Starts the flush interval (default FLUSH_INTERVAL_MS). */
  start(intervalMs = FLUSH_INTERVAL_MS): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

/**
 * Reads one stored section of a life (the agreed BLD-S3a name). Cells by local index. Null when the section is
 * missing or unreadable; a read failure throws, and nothing is dropped.
 */
export async function loadSection(
  kv: SeenKv,
  lifeId: string,
  ref: CellRef,
): Promise<Map<number, StoredCell> | null> {
  const value = await kv.get(sectionKey(lifeId, ref));
  if (value === null) return null;
  const cells = decodeCells(value);
  if (cells === null) return null;
  return new Map(
    cells.map(([local, name, lastSeen, inherited]) => [
      local,
      { name, lastSeen, inherited: inherited === 1 },
    ]),
  );
}

/** Removes every stored section of one life. Tries all of them; a failure throws, and the rest stay for a retry. */
export async function eraseLife(kv: SeenKv, lifeId: string): Promise<number> {
  let removed = 0;
  let failed = 0;
  let last = '';
  for (const key of await kv.list(`${lifeId}.`)) {
    try {
      await kv.delete(key);
      removed++;
    } catch (error) {
      failed++;
      last = errorText(error);
    }
  }
  if (failed > 0) throw new Error(`seen store: ${failed} section(s) not deleted: ${last}`);
  return removed;
}
