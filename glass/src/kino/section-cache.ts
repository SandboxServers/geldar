/**
 * The section cache for one Kino target: the latest chunk_section for each section and the block_updates
 * that followed it. A pane that joins a target the plugin already reads is served from here instead of a
 * resync, which would make the plugin publish the whole window again to every pane.
 *
 * Invariant: the cache holds every window message delivered since its last reset, so the cached messages
 * followed by the live feed give a joining pane what the plugin has sent. Anything that breaks that drops
 * the cache and leaves it unservable until the next resync (the plugin then sends the whole window again):
 * a target_moved, an overflow of a cap, a block_update for a section it has no snapshot of, or a message
 * it cannot read. Only chunk_section, block_update, hello and target_moved are looked at; the rest passes.
 */

/** Sections kept per target (a 16x16x16 section each). Past this the cache is dropped. */
export const SECTION_CAP = 4096;
/** Block updates kept per section after its latest snapshot. Past this the cache is dropped. */
export const UPDATES_PER_SECTION_CAP = 64;
/** Bytes of feed text kept per target (snapshots and updates). Past this the cache is dropped. */
export const CACHE_BYTE_BUDGET = 32 * 1024 * 1024;

export interface SectionCacheOptions {
  sectionCap?: number;
  updatesPerSection?: number;
  byteBudget?: number;
}

interface Section {
  snapshot: string;
  updates: string[];
  /** Bytes of the snapshot and its updates. */
  bytes: number;
}

type Position = { x: unknown; y: unknown; z: unknown };

/** Section key from a section's chunk and section coordinates; undefined unless all are integers. */
function sectionKey(chunkX: unknown, chunkZ: unknown, sectionY: unknown): string | undefined {
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ) || !Number.isInteger(sectionY))
    return undefined;
  return `${chunkX},${chunkZ},${sectionY}`;
}

export class SectionCache {
  private sections = new Map<string, Section>();
  private bytes = 0;
  private servable = true;
  private readonly sectionCap: number;
  private readonly updatesPerSection: number;
  private readonly byteBudget: number;

  constructor(o: SectionCacheOptions = {}) {
    this.sectionCap = o.sectionCap ?? SECTION_CAP;
    this.updatesPerSection = o.updatesPerSection ?? UPDATES_PER_SECTION_CAP;
    this.byteBudget = o.byteBudget ?? CACHE_BYTE_BUDGET;
  }

  /** Keeps one feed message if it changes the cache. Other kinds are ignored. */
  record(json: string): void {
    if (!this.servable) return;
    if (
      !json.includes('"chunk_section"') &&
      !json.includes('"block_update"') &&
      !json.includes('"hello"') &&
      !json.includes('"target_moved"')
    )
      return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(json) as Record<string, unknown>;
    } catch {
      this.invalidate();
      return;
    }
    if (m.type === 'chunk_section') {
      const key = sectionKey(m.chunk_x, m.chunk_z, m.section_y);
      if (key === undefined) {
        this.invalidate();
        return;
      }
      this.snapshot(key, json);
    } else if (m.type === 'block_update') {
      const pos = m.pos as Position | undefined;
      if (typeof pos !== 'object' || pos === null || !Number.isInteger(pos.x)) {
        this.invalidate();
        return;
      }
      const x = pos.x as number;
      const y = pos.y;
      const z = pos.z;
      if (!Number.isInteger(y) || !Number.isInteger(z)) {
        this.invalidate();
        return;
      }
      this.update(
        sectionKey(
          Math.floor(x / 16),
          Math.floor((z as number) / 16),
          Math.floor((y as number) / 16),
        ),
        json,
      );
    } else if (m.type === 'hello') {
      // A new read of the target starts with its window: earlier sections are not kept.
      this.clearSections();
    } else if (m.type === 'target_moved') {
      // The window shifts and only the sections that enter it are sent: the rest cannot be known.
      this.invalidate();
    }
  }

  /** The cached messages in order (each section's snapshot, then its updates), or null when there is nothing to serve. */
  replay(): string[] | null {
    if (!this.servable || this.sections.size === 0) return null;
    const out: string[] = [];
    for (const s of this.sections.values()) {
      out.push(s.snapshot);
      for (const u of s.updates) out.push(u);
    }
    return out;
  }

  /** A resync is being sent: the plugin answers with the whole window, so the cache starts over. */
  reset(): void {
    this.clearSections();
    this.servable = true;
  }

  /** Drops everything and refuses to serve until the next reset (a resync). */
  invalidate(): void {
    this.clearSections();
    this.servable = false;
  }

  private clearSections(): void {
    this.sections.clear();
    this.bytes = 0;
  }

  private snapshot(key: string, json: string): void {
    const bytes = Buffer.byteLength(json);
    const old = this.sections.get(key);
    if (old === undefined && this.sections.size >= this.sectionCap) {
      this.invalidate();
      return;
    }
    this.bytes += bytes - (old?.bytes ?? 0);
    // A new snapshot supersedes the updates before it.
    this.sections.set(key, { snapshot: json, updates: [], bytes });
    if (this.bytes > this.byteBudget) this.invalidate();
  }

  private update(key: string | undefined, json: string): void {
    const s = key === undefined ? undefined : this.sections.get(key);
    // No snapshot for the section: the cache cannot tell what the change applies to.
    if (s === undefined || s.updates.length >= this.updatesPerSection) {
      this.invalidate();
      return;
    }
    const bytes = Buffer.byteLength(json);
    s.updates.push(json);
    s.bytes += bytes;
    this.bytes += bytes;
    if (this.bytes > this.byteBudget) this.invalidate();
  }
}
