/**
 * The section cache for one Kino target: the latest chunk_section for each section and the block_updates
 * that followed it. A pane that joins a target the plugin already reads is served from here instead of a
 * resync, which would make the plugin publish the whole window again to every pane.
 *
 * Invariant: the cache holds every window message delivered since its last reset, less the sections the
 * plugin has left the window (see evictOutside), so the cached messages followed by the live feed give a
 * joining pane what the plugin has sent. Anything that breaks that drops the cache and leaves it unservable
 * until the next resync (the plugin then sends the whole window again): a cap overflow, a block_update for a
 * section it has no snapshot of, a target_moved it cannot place, or a message it cannot read. Only
 * chunk_section, block_update, hello and target_moved are looked at; the rest passes.
 *
 * Window math (KinoFeed.java, queueWindow and inBand): for a target at chunk (cx, cz) in section sy with view
 * radius R, a section at chunk (x, z) and section y is in the window when d = max(|x - cx|, |z - cz|) <= R and
 * sy - below(d) <= y <= sy + above(d). below(d) is 1 and above(d) is 6 for d <= 4 (the near chunks); beyond
 * that both are 2. The plugin also clamps y to the world's section range; the cache does not know that range,
 * so its band is never narrower than the plugin's. The eviction uses the same rule, so a section the plugin
 * still holds is never evicted, and a section it has dropped is not kept.
 */

/** Sections kept per target (a 16x16x16 section each). Past this the cache is dropped. */
export const SECTION_CAP = 4096;
/** Block updates kept per section after its latest snapshot. Past this the cache is dropped. */
export const UPDATES_PER_SECTION_CAP = 64;
/** Bytes of feed text kept per target (snapshots and updates). Past this the cache is dropped. */
export const CACHE_BYTE_BUDGET = 32 * 1024 * 1024;

/** Chunks from the target inside which the full vertical band is kept (the plugin's NEAR_CHUNKS). */
const NEAR_CHUNKS = 4;

export interface SectionCacheOptions {
  sectionCap?: number;
  updatesPerSection?: number;
  byteBudget?: number;
}

/** A section by chunk x, chunk z and section y. */
interface Loc {
  cx: number;
  cz: number;
  sy: number;
}

interface Section extends Loc {
  snapshot: string;
  updates: string[];
  /** Bytes of the snapshot and its updates. */
  bytes: number;
}

type Position = { x: unknown; y: unknown; z: unknown };

/** The location of a section from its chunk and section coordinates; undefined unless all are integers. */
function locate(chunkX: unknown, chunkZ: unknown, sectionY: unknown): Loc | undefined {
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ) || !Number.isInteger(sectionY))
    return undefined;
  return { cx: chunkX as number, cz: chunkZ as number, sy: sectionY as number };
}

const keyOf = (l: Loc): string => `${l.cx},${l.cz},${l.sy}`;

/** Sections read below the target's section at horizontal distance d (chunks), as the plugin reads them. */
const below = (d: number): number => (d <= NEAR_CHUNKS ? 1 : 2);
/** Sections read above the target's section at horizontal distance d (chunks), as the plugin reads them. */
const above = (d: number): number => (d <= NEAR_CHUNKS ? 6 : 2);

/** The view radius from hello: an integer from 1 to 8; undefined otherwise. */
function viewRadius(v: unknown): number | undefined {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 8
    ? (v as number)
    : undefined;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class SectionCache {
  private sections = new Map<string, Section>();
  private bytes = 0;
  private servable = true;
  /** The view radius of the feed, from its hello; the plugin keeps it for the feed's life. */
  private radius: number | undefined;
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
      const loc = locate(m.chunk_x, m.chunk_z, m.section_y);
      if (loc === undefined) {
        this.invalidate();
        return;
      }
      this.snapshot(loc, json);
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
        locate(Math.floor(x / 16), Math.floor((z as number) / 16), Math.floor((y as number) / 16)),
        json,
      );
    } else if (m.type === 'hello') {
      // A new read of the target starts with its window: earlier sections are not kept.
      this.clearSections();
      this.radius = viewRadius(m.view_radius);
    } else if (m.type === 'target_moved') {
      this.moved(m);
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

  /**
   * The target moved to the chunk and section of (x, y, z): the sections outside the new window are evicted with
   * their updates, and the rest stay servable. Without the radius or the coordinates the window cannot be placed.
   */
  private moved(m: Record<string, unknown>): void {
    const { x, y, z } = m;
    if (this.radius === undefined || !isNumber(x) || !isNumber(y) || !isNumber(z)) {
      this.invalidate();
      return;
    }
    this.evictOutside(this.radius, Math.floor(x / 16), Math.floor(z / 16), Math.floor(y / 16));
  }

  /** Drops the sections outside the window of a target at (cx, cz) in section sy, by the plugin's rule. */
  private evictOutside(radius: number, cx: number, cz: number, sy: number): void {
    for (const [key, s] of this.sections) {
      const d = Math.max(Math.abs(s.cx - cx), Math.abs(s.cz - cz));
      const inside = d <= radius && s.sy >= sy - below(d) && s.sy <= sy + above(d);
      if (inside) continue;
      this.sections.delete(key);
      this.bytes -= s.bytes;
    }
  }

  private snapshot(loc: Loc, json: string): void {
    const key = keyOf(loc);
    const bytes = Buffer.byteLength(json);
    const old = this.sections.get(key);
    if (old === undefined && this.sections.size >= this.sectionCap) {
      this.invalidate();
      return;
    }
    this.bytes += bytes - (old?.bytes ?? 0);
    // A new snapshot supersedes the updates before it.
    this.sections.set(key, { ...loc, snapshot: json, updates: [], bytes });
    if (this.bytes > this.byteBudget) this.invalidate();
  }

  private update(loc: Loc | undefined, json: string): void {
    const s = loc === undefined ? undefined : this.sections.get(keyOf(loc));
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
