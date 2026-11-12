import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** The recovery steps one stall episode can take, in the order the watchdog takes them. */
export type RecoveryStep = 'stopDigging' | 'replan' | 'jump';

/** Where a diagnostic line goes, and the clock that rate-limits it (injectable for tests). */
export interface DiagSink {
  log: (line: string) => void;
  now: () => number;
}

/** The Body's own log: a JSON line on stdout, which `docker logs` shows with the other body events. */
export const DEFAULT_DIAG_SINK: DiagSink = {
  log: (line) => console.log(line),
  now: () => Date.now(),
};

/** At most one stall_diag line per body in this many ms. */
export const DIAG_INTERVAL_MS = 10_000;

/** What the caller knows that the bot object does not. */
export interface StallFacts {
  reason: string;
  stalledTicks?: number;
  msSinceMove?: number;
  recovery?: readonly RecoveryStep[];
  toward?: { x: number; z: number };
}

/** A node of the last planned path, as `path_update` hands it over. */
interface PathNodeLike {
  x: number;
  y: number;
  z: number;
  toBreak?: unknown[];
}

/** What the pathfinder last reported for one body. */
interface PathTrail {
  status?: string | undefined;
  reset?: string | undefined;
  path: PathNodeLike[];
}

/** The slice of a bot the diagnostic reads. Every field may be absent on a test fake. */
interface DiagBot {
  entity?: {
    position?: Vec3;
    velocity?: Vec3;
    yaw?: number;
    pitch?: number;
    onGround?: boolean;
    isInWater?: boolean;
  };
  controlState?: Record<string, boolean>;
  targetDigBlock?: unknown;
  pathfinder?: { isMining?: () => boolean; goal?: { constructor?: { name?: string } } | null };
  blockAt?: (pos: Vec3) => { name?: string } | null | undefined;
  time?: { age?: number };
}

type Listener = (value: unknown) => void;

const trails = new WeakMap<object, PathTrail>();
const lastLineAt = new WeakMap<object, number>();

/** Records the pathfinder's `path_update` and `path_reset` for this body. Calling it again is a no-op. */
export function watchPathEvents(bot: Bot): void {
  if (trails.has(bot)) return;
  const trail: PathTrail = { path: [] };
  trails.set(bot, trail);
  const emitter = bot as unknown as { on?: (event: string, listener: Listener) => unknown };
  if (typeof emitter.on !== 'function') return;
  emitter.on('path_update', (value) => {
    const update = value as { status?: string; path?: PathNodeLike[] } | null | undefined;
    trail.status = update?.status;
    trail.path = update?.path ?? [];
  });
  emitter.on('path_reset', (reason) => {
    trail.reset = String(reason);
  });
}

const round = (value: number | undefined, places: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

function vec(
  value: { x: number; y: number; z: number } | undefined,
): Record<string, number | null> | null {
  if (!value) return null;
  return { x: round(value.x, 3), y: round(value.y, 3), z: round(value.z, 3) };
}

/** The name of the block at a cell, or null when the bot cannot read it (unloaded, fake). */
function nameAt(bot: DiagBot, x: number, y: number, z: number): string | null {
  try {
    return bot.blockAt?.(new Vec3(x, y, z))?.name ?? null;
  } catch {
    return null;
  }
}

const SIDES: Record<string, readonly [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

/** The axis step (one block) toward `toward`, on the axis with the larger distance. */
function stepToward(from: Vec3, toward: { x: number; z: number }): [number, number] {
  const dx = toward.x - from.x;
  const dz = toward.z - from.z;
  if (Math.abs(dx) >= Math.abs(dz)) return [Math.sign(dx), 0];
  return [0, Math.sign(dz)];
}

/** Names of the blocks around the feet cell: the four sides at feet and head height, the cell above, and the step-up cell. */
function blocksAround(bot: DiagBot, at: Vec3, toward?: { x: number; z: number }) {
  const fx = Math.floor(at.x);
  const fy = Math.floor(at.y);
  const fz = Math.floor(at.z);
  const sides = (y: number) =>
    Object.fromEntries(
      Object.entries(SIDES).map(([side, [dx, dz]]) => [side, nameAt(bot, fx + dx, y, fz + dz)]),
    );
  const step = toward ? stepToward(at, toward) : null;
  return {
    feet: sides(fy),
    head: sides(fy + 1),
    feet_up: nameAt(bot, fx, fy + 1, fz),
    step_up: step ? nameAt(bot, fx + step[0], fy + 1, fz + step[1]) : null,
  };
}

/** The next three nodes; `dig` when the move breaks blocks, else `jump`, `fall` or `walk` by height. */
function nextNodes(
  start: { y: number } | undefined,
  path: PathNodeLike[],
): Array<{ x: number; y: number; z: number; type: string }> {
  const out: Array<{ x: number; y: number; z: number; type: string }> = [];
  let prev = start;
  for (const node of path.slice(0, 3)) {
    let type = 'walk';
    if (node.toBreak?.length) type = 'dig';
    else if (prev && node.y > prev.y) type = 'jump';
    else if (prev && node.y < prev.y) type = 'fall';
    out.push({ x: node.x, y: node.y, z: node.z, type });
    prev = node;
  }
  return out;
}

/** Every field of one stall_diag line, from the bot as it stands now. */
function snapshot(bot: Bot, facts: StallFacts): Record<string, unknown> {
  const b = bot as unknown as DiagBot;
  const trail = trails.get(bot);
  const entity = b.entity;
  const position = entity?.position;
  const isMining = b.pathfinder?.isMining?.() ?? null;
  return {
    reason: facts.reason,
    world_tick: b.time?.age ?? null,
    position: vec(position),
    velocity: vec(entity?.velocity),
    yaw: round(entity?.yaw, 3),
    pitch: round(entity?.pitch, 3),
    on_ground: entity?.onGround ?? null,
    in_water: entity?.isInWater ?? null,
    control: { ...(b.controlState ?? {}) },
    is_mining: isMining,
    dig_in_progress: Boolean(b.targetDigBlock) || isMining === true,
    goal: b.pathfinder?.goal?.constructor?.name ?? null,
    next_nodes: nextNodes(position, trail?.path ?? []),
    path_status: trail?.status ?? null,
    path_reset: trail?.reset ?? null,
    ticks_stalled: facts.stalledTicks ?? null,
    ms_since_move: facts.msSinceMove ?? null,
    blocks: position ? blocksAround(b, position, facts.toward) : null,
    recovery: facts.recovery ?? [],
  };
}

/**
 * Emits one `stall_diag` JSON line for this body, at most once per `DIAG_INTERVAL_MS` on the sink's
 * clock. Returns false when the line was rate-limited. A failure while reading the bot is logged as
 * `error` in the line; it never breaks the move that asked for the diagnostic.
 */
export function emitStallDiag(bot: Bot, facts: StallFacts, sink: DiagSink): boolean {
  const now = sink.now();
  const last = lastLineAt.get(bot);
  if (last !== undefined && now - last < DIAG_INTERVAL_MS) return false;
  lastLineAt.set(bot, now);
  let body: Record<string, unknown>;
  try {
    body = snapshot(bot, facts);
  } catch (error) {
    body = { reason: facts.reason, error: error instanceof Error ? error.message : String(error) };
  }
  sink.log(JSON.stringify({ event: 'stall_diag', ...body }));
  return true;
}

/** A diagnostic line on the Body's own log, for the callers that are not inside a move. */
export function reportStall(bot: Bot, facts: StallFacts): boolean {
  return emitStallDiag(bot, facts, DEFAULT_DIAG_SINK);
}
