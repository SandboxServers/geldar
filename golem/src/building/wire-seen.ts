// Seen-block wiring (BLD-38d). Built only with body_actions.building on. Each sampled tick the recorder reads the
// bot's own view (the viewport cone, line of sight only: no wall-hack). An observed block change updates only a
// cell this life has already seen, so a change behind a wall reveals nothing new. The map is kept for the life;
// death flushes it and leaves it in place; a restart of the same life reloads its own stored sections; the next
// life inherits the predecessor's sections when they match.
import type { Bot } from 'mineflayer';
import type { TickSource } from '../body/runtime.ts';
import type { GolemMetrics } from '../metrics.ts';
import { viewFromBot } from '../perception/view/viewport.ts';
import { cellInView, newRecorder, recordSeen } from './seen/recorder.ts';
import { SECTION_SIZE, SeenMap, sectionOf } from './seen/section.ts';
import {
  eraseLife as eraseStoredLife,
  FLUSH_INTERVAL_MS,
  type FlushResult,
  loadSection,
  type Predecessor,
  type SeenKv,
  SeenStore,
} from './seen/store.ts';
import { type SurveyBox, type SurveyReply, surveyBox } from './seen/survey.ts';

export interface SeenWiringOptions {
  bot: Bot;
  ticks: TickSource;
  lifeId: string;
  /** The Body's metrics: one seen flush and its bytes per store flush. Absent: none kept. */
  metrics?: GolemMetrics;
  /** The seen KV bucket. Absent: the map is kept in memory and nothing is written. */
  kv?: SeenKv;
  agentId?: string;
  /** The life this one succeeds. Read only when its agent is this agent. */
  predecessor?: Predecessor | null;
  flushIntervalMs?: number;
  log?: (line: string) => void;
}

interface Change {
  x: number;
  y: number;
  z: number;
  name: string;
  tick: number;
}

/** A seen map that also keeps the cells recorded since the last flush (when a store is kept). */
class TrackedSeenMap extends SeenMap {
  readonly changed = new Map<string, Change>();
  private readonly track: boolean;

  constructor(track: boolean) {
    super();
    this.track = track;
  }

  override record(x: number, y: number, z: number, name: string, tick: number): void {
    super.record(x, y, z, name, tick);
    if (this.track) this.changed.set(`${x},${y},${z}`, { x, y, z, name, tick });
  }

  /** Puts back a stored cell of this life without marking it changed: nothing is written for it again. */
  restore(x: number, y: number, z: number, name: string, tick: number): void {
    super.record(x, y, z, name, tick);
  }
}

export interface SeenWiring {
  /** The life's map: what the recorder and the survey see. */
  readonly map: SeenMap;
  /** Settles when the predecessor's cells are in the map (at once when there is none). */
  readonly ready: Promise<void>;
  /** The survey of a box at `nowTick`. Cells never seen read unknown. */
  survey(box: SurveyBox, nowTick: number): SurveyReply;
  /** Writes the cells changed since the last flush. Null when no KV is kept. */
  flush(): Promise<FlushResult | null>;
  /** Removes this life's stored sections; returns how many were removed (0 without a KV). */
  eraseLife(): Promise<number>;
  /** Stops the flush timer and the tick and block listeners. */
  stop(): void;
}

/**
 * Copies the stored cells of one life into the map, where the map has no cell there yet. `put` writes each cell:
 * an inherited cell is tracked as a change, a life's own cell reloaded on restart is not.
 */
async function loadLifeInto(
  kv: SeenKv,
  lifeId: string,
  map: SeenMap,
  put: (x: number, y: number, z: number, name: string, tick: number) => void,
): Promise<number> {
  const prefix = `${lifeId}.`;
  let count = 0;
  for (const key of await kv.list(prefix)) {
    const parts = key.slice(prefix.length).split('.').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) continue;
    const [sx, sy, sz] = parts as [number, number, number];
    const cells = await loadSection(
      kv,
      lifeId,
      sectionOf(sx * SECTION_SIZE, sy * SECTION_SIZE, sz * SECTION_SIZE),
    );
    if (cells === null) continue;
    for (const [local, cell] of cells) {
      const x = sx * SECTION_SIZE + (local % SECTION_SIZE);
      const y = sy * SECTION_SIZE + (Math.floor(local / SECTION_SIZE) % SECTION_SIZE);
      const z = sz * SECTION_SIZE + Math.floor(local / (SECTION_SIZE * SECTION_SIZE));
      if (map.read(x, y, z) !== undefined) continue;
      put(x, y, z, cell.name, cell.lastSeen);
      count++;
    }
  }
  return count;
}

/** Builds the seen map of one life, its recorder on the bot's view, and its store. Does not start anything itself. */
export function createSeenWiring(opts: SeenWiringOptions): SeenWiring {
  const log = opts.log ?? (() => undefined);
  const map = new TrackedSeenMap(opts.kv !== undefined);
  const recorder = newRecorder(map);
  const store =
    opts.kv === undefined
      ? null
      : new SeenStore({ kv: opts.kv, lifeId: opts.lifeId, agentId: opts.agentId ?? opts.lifeId });
  let lastTick = 0;

  async function flush(): Promise<FlushResult | null> {
    if (store === null) return null;
    const batch = [...map.changed.entries()];
    map.changed.clear();
    for (const [key, change] of batch) {
      try {
        await store.record(change.x, change.y, change.z, change.name, change.tick);
      } catch {
        // Kept for the next flush unless a newer change to the same cell is already waiting.
        if (!map.changed.has(key)) map.changed.set(key, change);
      }
    }
    const result = await store.flush();
    opts.metrics?.seenFlush(result.bytes);
    return result;
  }

  const offTicks = opts.ticks((tick) => {
    lastTick = tick;
    if (tick % recorder.everyTicks !== 0) return;
    try {
      const { world, pose } = viewFromBot(opts.bot);
      recordSeen(recorder, world, pose, tick);
    } catch (error) {
      log(`seen record failed: ${String(error)}`);
    }
  });

  const timer =
    store === null
      ? undefined
      : setInterval(() => {
          flush().catch((error: unknown) => log(`seen flush failed: ${String(error)}`));
        }, opts.flushIntervalMs ?? FLUSH_INTERVAL_MS);

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    offTicks();
    if (timer !== undefined) clearInterval(timer);
  };

  const emitter = opts.bot as unknown as {
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };
  if (typeof emitter.on === 'function') {
    emitter.on('blockUpdate', (_old: unknown, next: unknown) => {
      const block = next as {
        name?: string;
        position?: { x: number; y: number; z: number };
      } | null;
      if (!block?.name || !block.position || stopped) return;
      const x = Math.floor(block.position.x);
      const y = Math.floor(block.position.y);
      const z = Math.floor(block.position.z);
      if (map.read(x, y, z) === undefined) return;
      // A change to an already-seen cell is taken only while the cell is in view now (review fix 3).
      // Out of view it stays as the Body last saw it, stale, and the plan verifies it live.
      try {
        const { world, pose } = viewFromBot(opts.bot);
        if (!cellInView(world, pose, x, y, z)) return;
      } catch (error) {
        log(`seen change not read: ${String(error)}`);
        return;
      }
      map.record(x, y, z, block.name, lastTick);
    });
    emitter.on('death', () => {
      flush().catch((error: unknown) => log(`seen flush on death failed: ${String(error)}`));
    });
    emitter.on('end', () => {
      stop();
      flush().catch((error: unknown) => log(`seen flush on end failed: ${String(error)}`));
    });
  }

  // This life's own stored cells come first (a restart of the same life), then the predecessor fills the gaps.
  const pred = opts.predecessor;
  const kv = opts.kv;
  const ready: Promise<void> = (
    kv === undefined
      ? Promise.resolve()
      : loadLifeInto(kv, opts.lifeId, map, (x, y, z, name, tick) =>
          map.restore(x, y, z, name, tick),
        )
  )
    .then(
      () => undefined,
      (error: unknown) => log(`seen reload failed: ${String(error)}`),
    )
    .then(() => {
      if (
        kv === undefined ||
        !pred ||
        opts.agentId === undefined ||
        pred.agentId !== opts.agentId ||
        pred.lifeId === opts.lifeId
      ) {
        return undefined;
      }
      return loadLifeInto(kv, pred.lifeId, map, (x, y, z, name, tick) =>
        map.record(x, y, z, name, tick),
      ).then(
        () => undefined,
        (error: unknown) => log(`seen inheritance failed: ${String(error)}`),
      );
    });

  return {
    map,
    ready,
    survey: (box, nowTick) => surveyBox(map, box, nowTick),
    flush,
    eraseLife: async () => (opts.kv === undefined ? 0 : eraseStoredLife(opts.kv, opts.lifeId)),
    stop,
  };
}
