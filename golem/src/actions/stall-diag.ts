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

/** The controls the line reports. mineflayer keeps them in non-enumerable getters, so a spread shows `{}`. */
const CONTROLS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'] as const;

/** A server position correction (mineflayer's `forcedMove`) counts toward `corrections_10s` for this long. */
const CORRECTION_WINDOW_MS = 10_000;

/** At most one forced_move line per body in this many ms. */
export const FORCED_MOVE_INTERVAL_MS = 5_000;

/** The corrections one body has had: wall-clock times in the window, and the world tick of the last. */
interface CorrectionTrail {
  recent: number[];
  lastTick: number | null;
  /** The body's position at the last physics tick, or after the last correction. */
  before: Vec3 | null;
}

const trails = new WeakMap<object, PathTrail>();
const lastLineAt = new WeakMap<object, number>();
const corrections = new WeakMap<object, CorrectionTrail>();
const lastForcedMoveAt = new WeakMap<object, number>();

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

/**
 * Counts the server's position corrections (mineflayer's `forcedMove`) for this body, and writes a
 * rate-limited `forced_move` line with the server position and the client position just before it.
 * Attach it once per body, where the body is created; calling it again is a no-op.
 */
export function watchCorrections(bot: Bot, sink: DiagSink = DEFAULT_DIAG_SINK): void {
  if (corrections.has(bot)) return;
  const trail: CorrectionTrail = { recent: [], lastTick: null, before: null };
  corrections.set(bot, trail);
  const emitter = bot as unknown as { on?: (event: string, listener: Listener) => unknown };
  if (typeof emitter.on !== 'function') return;
  emitter.on('physicsTick', () => {
    const position = (bot as unknown as DiagBot).entity?.position;
    if (position) trail.before = position.clone();
  });
  emitter.on('forcedMove', () => {
    const b = bot as unknown as DiagBot;
    const now = sink.now();
    const server = b.entity?.position;
    const before = trail.before;
    trail.recent = trail.recent.filter((at) => now - at < CORRECTION_WINDOW_MS);
    trail.recent.push(now);
    trail.lastTick = b.time?.age ?? null;
    // The client now stands where the server put it, until the next physics tick says otherwise.
    trail.before = server ? server.clone() : null;
    const last = lastForcedMoveAt.get(bot);
    if (last !== undefined && now - last < FORCED_MOVE_INTERVAL_MS) return;
    lastForcedMoveAt.set(bot, now);
    sink.log(
      JSON.stringify({
        event: 'forced_move',
        server: vec(server),
        client_before: vec(before ?? undefined),
      }),
    );
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

/** Names of the blocks around the feet cell: the feet cell and the one below it, the four sides at feet and head height, the cell above, and the step-up cell. */
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
    at: nameAt(bot, fx, fy, fz),
    below: nameAt(bot, fx, fy - 1, fz),
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

/** The controls that are held now, by name. */
function heldControls(bot: DiagBot): Record<string, true> {
  const held: Record<string, true> = {};
  for (const name of CONTROLS) {
    if (bot.controlState?.[name]) held[name] = true;
  }
  return held;
}

/** Every field of one stall_diag line, from the bot as it stands now, at wall-clock `now`. */
function snapshot(bot: Bot, facts: StallFacts, now: number): Record<string, unknown> {
  const b = bot as unknown as DiagBot;
  const trail = trails.get(bot);
  const correctionTrail = corrections.get(bot);
  const entity = b.entity;
  const position = entity?.position;
  const isMining = b.pathfinder?.isMining?.() ?? null;
  const tick = b.time?.age;
  const lastTick = correctionTrail?.lastTick;
  return {
    reason: facts.reason,
    world_tick: b.time?.age ?? null,
    position: vec(position),
    velocity: vec(entity?.velocity),
    yaw: round(entity?.yaw, 3),
    pitch: round(entity?.pitch, 3),
    on_ground: entity?.onGround ?? null,
    in_water: entity?.isInWater ?? null,
    control: heldControls(b),
    corrections_10s:
      correctionTrail?.recent.filter((at) => now - at < CORRECTION_WINDOW_MS).length ?? 0,
    ticks_since_correction: lastTick != null && tick != null ? tick - lastTick : null,
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
    body = snapshot(bot, facts, now);
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
