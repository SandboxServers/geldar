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
import { type Pos, TestControl } from '../../test-control.ts';
import { parseMspt, setTps } from '../tps.ts';

/** The only RCON port the bench may run against without the throwaway flag. */
export const BENCH_RCON_PORT = 26575;
export const THROWAWAY_FLAG = '--i-know-this-is-a-throwaway';
/** Bot counts the layout supports: the speaker plus 8 or 14 listeners. */
export const BENCH_SIZES = [9, 15] as const;
export const CHAT_LINES = 20;
export const CHAT_INTERVAL_MS = 2_000;

/** Absolute x and z of the layout's origin (the speaker stands here); y is absolute. */
export const ORIGIN = { x: 1000, z: 1000 };
const FLOOR_Y = 64;
const STAND_Y = 65;
const CEILING_Y = 70;

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
 * The walls, nearest first. Each spans z -3..3 from y 65. Block ids are plain (the fill command takes
 * no namespace or state). `stone_brick_slab` fills y 65..66 as bottom slabs, so y 67 is open there.
 * `white_carpet` at y 65 does not block sight: it is the non-blocking control.
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
/** The sealed room's listener: east of every wall, inside a stone shell whose front is at x 37. */
const SEALED_X = 40;
const ROOM_FRONT_X = 37;
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
    { from: { x: ROOM_FRONT_X, y: FLOOR_Y, z: -2 }, to: { x: 43, y: 68, z: 2 }, block: 'stone' },
    { from: { x: 38, y: STAND_Y, z: -1 }, to: { x: 42, y: 67, z: 1 }, block: 'air' },
  ];
  return { bots, spots, boxes };
}

/** A chat line's sequence number, or null when the message is not a bench line. */
export function parseSeq(message: string): number | null {
  const match = /^mh8a L(\d+) /.exec(message);
  return match ? Number(match[1]) : null;
}

export interface MuffleRunOptions {
  bots: number;
  cfg: GolemConfig;
  throwawayFlag: boolean;
  lines?: number;
  intervalMs?: number;
  log?: (line: string) => void;
}

export interface MuffleRunResult {
  layout: Layout;
  sent: number;
  /** Distinct chat lines each listener heard, by bot name. */
  heard: Record<string, number>;
  mspt: number | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Builds the world with fill, admits and places the bots, sends the chat and tallies what each listener heard. */
export async function runMuffleChat(opts: MuffleRunOptions): Promise<MuffleRunResult> {
  assertThrowawayTarget(opts.cfg.rconPort, opts.throwawayFlag);
  const layout = muffleLayout(opts.bots);
  const log = opts.log ?? (() => undefined);
  const password = await readRconPassword(opts.cfg);
  const rcon = await RconClient.connect({
    host: opts.cfg.rconHost,
    port: opts.cfg.rconPort,
    password,
  });
  const ctl = new TestControl(rcon);
  const managers: ConnectionManager[] = [];
  const admitted: string[] = [];
  try {
    await setTps(ctl, 20);
    for (const box of layout.boxes) {
      const at = (p: Pos): Pos => ({ x: ORIGIN.x + p.x, y: p.y, z: ORIGIN.z + p.z });
      await ctl.fill(at(box.from), at(box.to), box.block);
    }
    for (const spot of layout.spots) {
      await ctl.whitelistAdd(spot.name);
      admitted.push(spot.name);
    }
    const bots: Bot[] = [];
    for (const spot of layout.spots) {
      const manager = new ConnectionManager({
        host: opts.cfg.mcHost,
        port: opts.cfg.mcPort,
        username: spot.name,
        registry: registryFromConfig(opts.cfg),
        log: () => undefined,
      });
      managers.push(manager);
      bots.push(await manager.start());
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
    for (const manager of managers) await manager.stop().catch(() => undefined);
    for (const name of admitted) await ctl.whitelistRemove(name).catch(() => undefined);
    await ctl.tickRate(20).catch(() => undefined);
    await rcon.close().catch(() => undefined);
  }
}
