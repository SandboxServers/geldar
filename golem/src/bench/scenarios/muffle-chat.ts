/**
 * MH-8a muffle-chat: one speaker and N-1 listener bots on a throwaway bench shard. The bots stand at
 * known distances behind known walls, the speaker sends chat at a fixed cadence, and each listener
 * records which lines it heard. The plugin's `muffle-bench` log lines are read separately (muffle-log.ts).
 *
 * RCON whitelist/tp/fill here is a test-harness operator control on a throwaway bench shard only; it is
 * never used on a real shard. Principle 1 concerns the real world.
 *
 * This is a standalone multi-bot run, not a registered Scenario: the Scenario interface drives one bot.
 * Nothing here is referenced from colo.yml, deploy scripts or any production config.
 */
import type { Bot } from 'mineflayer';
import { type GolemConfig, readRconPassword } from '../../config.ts';
import { ConnectionManager } from '../../connection.ts';
import { RconClient } from '../../rcon.ts';
import { registryFromConfig } from '../../registry.ts';
import { type CommandSource, type Pos, TestControl } from '../../test-control.ts';
import { parseMspt, setTps } from '../tps.ts';

/** The only RCON port the bench may run against without the throwaway flag. */
export const BENCH_RCON_PORT = 26575;
export const THROWAWAY_FLAG = '--i-know-this-is-a-throwaway';
/** Bot counts the layout supports: the speaker plus 8 or 14 listeners. */
export const BENCH_SIZES = [9, 15] as const;
export const CHAT_LINES = 20;
export const CHAT_INTERVAL_MS = 2_000;
/** A fill that reports `not loaded` is retried this many times, this far apart (as arena.ts does). */
export const FILL_TRIES = 20;
export const FILL_RETRY_MS = 250;

/** Absolute x and z of the layout's origin (the speaker stands here); y is absolute. */
export const ORIGIN = { x: 1000, z: 1000 };
const FLOOR_Y = 64;
const STAND_Y = 65;
const CEILING_Y = 70;
/** The layout box force-loaded before any fill, in layout coordinates (x -4..46, z -6..6). */
const LOADED = { from: { x: -4, z: -6 }, to: { x: 46, z: 6 } };

/**
 * Refuses unless the RCON port is the bench port or the throwaway flag is given. Throws before any
 * connection is opened, so a mistyped port on a real shard changes nothing.
 */
export function assertThrowawayTarget(rconPort: number, throwawayFlag: boolean): void {
  if (rconPort === BENCH_RCON_PORT || throwawayFlag) return;
  throw new Error(
    `refusing: RCON port ${rconPort} is not the bench port ${BENCH_RCON_PORT}; ` +
      `pass ${THROWAWAY_FLAG} only for a throwaway shard`,
  );
}

/** A wall across the speaker's line: x is the plane, `top` the highest y filled. */
interface WallPlan {
  x: number;
  block: string;
  top: number;
}

/**
 * The walls, nearest first. Each spans z -3..3 from y 65 up to `top`. Block ids are plain (the fill command
 * takes no namespace or state). The `stone_brick_slab` wall has top 66: only y 65..66 are filled there,
 * and y 67 is left open. `white_carpet` at y 65 does not block sight: it is the non-blocking control.
 */
export const WALLS: readonly WallPlan[] = [
  { x: 3, block: 'stone', top: 67 },
  { x: 7, block: 'glass', top: 67 },
  { x: 11, block: 'oak_planks', top: 67 },
  { x: 15, block: 'white_wool', top: 67 },
  { x: 19, block: 'tinted_glass', top: 67 },
  { x: 23, block: 'stone_brick_slab', top: 66 },
  { x: 27, block: 'white_carpet', top: 65 },
];

/** Listener columns on the speaker's row (z 0), in blocks east of the speaker. */
export const LINE_X = [2, 5, 9, 13, 17, 21, 25] as const;
/**
 * The sealed room's listener, 31 blocks out so it is inside the 32-block raw hearing gate
 * (ProximityRule.HEARING_RADIUS_BLOCKS). The room is a stone shell with its front wall at x 28 and its
 * back wall at x 34, a roof at y 68 and an air hollow at x 29..33, y 65..67, z -1..1.
 */
const SEALED_X = 31;
const ROOM_FRONT_X = 28;
const ROOM_BACK_X = 34;
const ROOM_ROOF_Y = 68;
/**
 * The second row (N=15 only) is 2 blocks north, still inside the walls' z span, and takes the first six
 * columns: 1 speaker + 7 + 6 + the sealed listener = 15 bots.
 */
const SECOND_ROW_Z = 2;

/** A fill box in layout coordinates (relative to ORIGIN, y absolute). */
export interface Box {
  from: Pos;
  to: Pos;
  block: string;
}

/** One bot: its role, its place, its straight-line distance and the blocks on the line to the speaker. */
export interface Spot {
  name: string;
  role: 'speaker' | 'listener';
  x: number;
  z: number;
  distance: number;
  blocks: string[];
}

export interface Layout {
  bots: number;
  spots: Spot[];
  boxes: Box[];
}

/** The bot name for slot `i` (0 is the speaker). Within the 3-16 character Minecraft username rule. */
export function benchName(i: number): string {
  return `MuffleBench${String(i).padStart(2, '0')}`;
}

function blocksBefore(x: number): string[] {
  return WALLS.filter((w) => w.x < x).map((w) => w.block);
}

function wallBoxes(): Box[] {
  return WALLS.map((w) => ({
    from: { x: w.x, y: STAND_Y, z: -3 },
    to: { x: w.x, y: w.top, z: 3 },
    block: w.block,
  }));
}

/** The fixed layout for 9 or 15 bots. Pure: the same input gives the same spots and boxes. */
export function muffleLayout(bots: number): Layout {
  if (!(BENCH_SIZES as readonly number[]).includes(bots)) {
    throw new RangeError(`bots must be 9 or 15, got ${bots}`);
  }
  const places: { role: Spot['role']; x: number; z: number; blocks: string[] }[] = [
    { role: 'speaker', x: 0, z: 0, blocks: [] },
    ...LINE_X.map((x) => ({ role: 'listener' as const, x, z: 0, blocks: blocksBefore(x) })),
    ...(bots === 15
      ? LINE_X.slice(0, -1).map((x) => ({
          role: 'listener' as const,
          x,
          z: SECOND_ROW_Z,
          blocks: blocksBefore(x),
        }))
      : []),
    {
      role: 'listener',
      x: SEALED_X,
      z: 0,
      blocks: [...blocksBefore(SEALED_X), 'stone'],
    },
  ];
  const spots: Spot[] = places.map((p, i) => ({
    name: benchName(i),
    role: p.role,
    x: p.x,
    z: p.z,
    distance: Math.round(Math.hypot(p.x, p.z) * 100) / 100,
    blocks: p.blocks,
  }));
  const boxes: Box[] = [
    { from: { x: -4, y: FLOOR_Y, z: -6 }, to: { x: 46, y: FLOOR_Y, z: 6 }, block: 'stone' },
    { from: { x: -4, y: STAND_Y, z: -6 }, to: { x: 46, y: CEILING_Y, z: 6 }, block: 'air' },
    ...wallBoxes(),
    {
      from: { x: ROOM_FRONT_X, y: FLOOR_Y, z: -2 },
      to: { x: ROOM_BACK_X, y: ROOM_ROOF_Y, z: 2 },
      block: 'stone',
    },
    {
      from: { x: ROOM_FRONT_X + 1, y: STAND_Y, z: -1 },
      to: { x: ROOM_BACK_X - 1, y: ROOM_ROOF_Y - 1, z: 1 },
      block: 'air',
    },
  ];
  return { bots, spots, boxes };
}

/** A chat line's sequence number, or null when the message is not a bench line. */
export function parseSeq(message: string): number | null {
  const match = /^mh8a L(\d+) /.exec(message);
  return match ? Number(match[1]) : null;
}

/** An RCON session: commands in, replies out, and a close. RconClient is one. */
export interface RconSession extends CommandSource {
  close(): Promise<void>;
}

/** One started bot and the way to stop it. */
export interface BotSession {
  bot: Bot;
  stop(): Promise<void>;
}

/** The connections runMuffleChat opens. The default opens a real RCON client and real bots; tests pass fakes. */
export interface MuffleDeps {
  connect(cfg: GolemConfig): Promise<RconSession>;
  startBot(spot: Spot, cfg: GolemConfig): Promise<BotSession>;
}

const DEFAULT_DEPS: MuffleDeps = {
  connect: async (cfg) =>
    RconClient.connect({
      host: cfg.rconHost,
      port: cfg.rconPort,
      password: await readRconPassword(cfg),
    }),
  startBot: async (spot, cfg) => {
    const manager = new ConnectionManager({
      host: cfg.mcHost,
      port: cfg.mcPort,
      username: spot.name,
      registry: registryFromConfig(cfg),
      log: () => undefined,
    });
    try {
      return { bot: await manager.start(), stop: () => manager.stop() };
    } catch (err) {
      await manager.stop().catch(() => undefined);
      throw err;
    }
  },
};

export interface MuffleRunOptions {
  bots: number;
  cfg: GolemConfig;
  throwawayFlag: boolean;
  lines?: number;
  intervalMs?: number;
  log?: (line: string) => void;
  deps?: MuffleDeps;
}

export interface MuffleRunResult {
  layout: Layout;
  sent: number;
  /** Distinct chat lines each listener heard, by bot name. */
  heard: Record<string, number>;
  mspt: number | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Force-loads the layout, then runs every fill of the layout. A fill that reports `not loaded` is retried
 * (the whole set, up to FILL_TRIES times). Throws unless every fill reply is a success.
 */
export async function buildLayout(ctl: TestControl, layout: Layout): Promise<void> {
  const at = (p: Pos): Pos => ({ x: ORIGIN.x + p.x, y: p.y, z: ORIGIN.z + p.z });
  await ctl.forceload(
    ORIGIN.x + LOADED.from.x,
    ORIGIN.z + LOADED.from.z,
    ORIGIN.x + LOADED.to.x,
    ORIGIN.z + LOADED.to.z,
  );
  for (let attempt = 1; ; attempt++) {
    const replies: string[] = [];
    for (const box of layout.boxes) {
      replies.push(await ctl.fill(at(box.from), at(box.to), box.block));
    }
    if (!replies.some((r) => /not loaded/i.test(r))) {
      const failed = replies.find((r) => !/Successfully filled|No blocks were filled/.test(r));
      if (failed !== undefined) throw new Error(`layout fill failed: ${failed.trim()}`);
      return;
    }
    if (attempt >= FILL_TRIES) {
      throw new Error('layout did not build: its chunks stayed unloaded');
    }
    await sleep(FILL_RETRY_MS);
  }
}

/** Builds the world with fill, admits and places the bots, sends the chat and tallies what each listener heard. */
export async function runMuffleChat(opts: MuffleRunOptions): Promise<MuffleRunResult> {
  assertThrowawayTarget(opts.cfg.rconPort, opts.throwawayFlag);
  const layout = muffleLayout(opts.bots);
  const log = opts.log ?? (() => undefined);
  const deps = opts.deps ?? DEFAULT_DEPS;
  const rcon = await deps.connect(opts.cfg);
  const ctl = new TestControl(rcon);
  const sessions: BotSession[] = [];
  const admitted: string[] = [];
  try {
    await setTps(ctl, 20);
    await buildLayout(ctl, layout);
    for (const spot of layout.spots) {
      await ctl.whitelistAdd(spot.name);
      admitted.push(spot.name);
    }
    const bots: Bot[] = [];
    for (const spot of layout.spots) {
      const session = await deps.startBot(spot, opts.cfg);
      sessions.push(session);
      bots.push(session.bot);
    }
    for (const spot of layout.spots) {
      await ctl.tp(spot.name, ORIGIN.x + spot.x, STAND_Y, ORIGIN.z + spot.z);
    }
    const heard = new Map<string, Set<number>>();
    const speaker = bots[0] as Bot;
    layout.spots.slice(1).forEach((spot, i) => {
      const seen = new Set<number>();
      heard.set(spot.name, seen);
      (bots[i + 1] as Bot).on('chat', (username: string, message: string) => {
        const seq = username === speaker.username ? parseSeq(message) : null;
        if (seq !== null) seen.add(seq);
      });
    });
    const lines = opts.lines ?? CHAT_LINES;
    for (let seq = 1; seq <= lines; seq++) {
      speaker.chat(`mh8a L${seq} alpha bravo charlie`);
      await sleep(opts.intervalMs ?? CHAT_INTERVAL_MS);
    }
    await sleep(opts.intervalMs ?? CHAT_INTERVAL_MS);
    const mspt = parseMspt(await ctl.tickQuery());
    log(`sent ${lines} lines to ${layout.spots.length - 1} listeners`);
    return {
      layout,
      sent: lines,
      heard: Object.fromEntries([...heard].map(([name, seen]) => [name, seen.size])),
      mspt,
    };
  } finally {
    for (const session of sessions) await session.stop().catch(() => undefined);
    for (const name of admitted) await ctl.whitelistRemove(name).catch(() => undefined);
    await ctl.tickRate(20).catch(() => undefined);
    await rcon.close().catch(() => undefined);
  }
}
