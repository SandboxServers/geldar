/**
 * MH-8a muffle-chat: N bots on a throwaway bench shard, K of them speakers (default 1, the control) and the
 * rest listeners. The bots stand at known distances behind known walls, and each listener records which
 * (speaker, line) pairs it heard. The plugin's `muffle-bench` log lines are read separately (muffle-log.ts).
 * The plugin judges N-1 viewers per line: every viewer except the speaker, including the other K-1 speakers,
 * a few blocks away with no walls between them, so the log shows listeners=N-1. The `heard` counts here
 * cover only the listeners.
 *
 * Speakers: speaker 0 stands at the origin (z 0), where the one-speaker layout always stood. Speakers 1..K-1
 * stand at x 0 on z 2, -2, 1, -1 (SPEAKER_ROWS). Each extra speaker takes the place of one of the nearest
 * listeners, so the listeners that remain keep their known distances and walls from the origin. The
 * listeners are SHARED: every listener is judged against every speaker, not owned by one. A listener is
 * then at most hypot(31, 2) = 31.06 blocks from a speaker (the sealed listener against a z 2 speaker), so
 * every pair is inside the 32-block raw gate. Walls span z -3..3 and all speakers and listeners stand at
 * |z| <= 2, so every wall between a speaker and a listener is crossed: the wall lists are the same for every
 * speaker. Distances from the origin are the ones in `Spot.distance`; the extra speakers shift the others.
 *
 * Modes: `steady` staggers the speakers inside each chat interval (speaker k starts at k * interval / K).
 * `burst` has all K speakers send in the same server tick, back to back in one event-loop turn, once per
 * round, to find the worst per-tick cost. K=1 steady is the control: one line per interval, as before.
 *
 * Straddle: a burst's K lines are sent in one event-loop turn, but they can reach the server over a few ms, so
 * a 50 ms tick boundary can split one burst across two ticks. Read `linesPerTick` max and p95 together with
 * `worst` (the tick with the largest summed ns, from muffle-log.ts). Do not read `worst` alone as the burst cost.
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
/** Bot counts the layout supports. With one speaker that is 8 or 14 listeners. */
export const BENCH_SIZES = [9, 15] as const;
/** z of each speaker, in the order they are used. Speaker 0 is the origin. All lie inside the wall span. */
export const SPEAKER_ROWS = [0, 2, -2, 1, -1] as const;
export const CHAT_MODES = ['steady', 'burst'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
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
  /** How many of `spots` are speakers. They come first: spots[0..speakers-1]. */
  speakers: number;
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

interface Place {
  role: Spot['role'];
  x: number;
  z: number;
  blocks: string[];
}

/** The listener places of an N-bot layout with one speaker, nearest first in the row, then the sealed one. */
function listenerPlaces(bots: number): Place[] {
  return [
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
}

/**
 * The fixed layout for 9 or 15 bots with `speakers` speakers (1 to 5, fewer than the bots). Pure: the same
 * input gives the same spots and boxes. The K-1 extra speakers take the places of the K-1 listeners nearest
 * the origin (ties keep list order), so the rest keep their known distances.
 */
export function muffleLayout(bots: number, speakers = 1): Layout {
  if (!(BENCH_SIZES as readonly number[]).includes(bots)) {
    throw new RangeError(`bots must be 9 or 15, got ${bots}`);
  }
  if (!Number.isInteger(speakers) || speakers < 1 || speakers > SPEAKER_ROWS.length) {
    throw new RangeError(`speakers must be 1 to ${SPEAKER_ROWS.length}, got ${speakers}`);
  }
  const listeners = listenerPlaces(bots);
  const nearest = listeners
    .map((p, i) => ({ i, d: Math.hypot(p.x, p.z) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, speakers - 1)
    .map((e) => e.i);
  const dropped = new Set(nearest);
  const kept = listeners.filter((_, i) => !dropped.has(i));
  const originSpeaker: Place = { role: 'speaker', x: 0, z: 0, blocks: [] };
  const extraSpeakers: Place[] = SPEAKER_ROWS.slice(1, speakers).map((z) => ({
    role: 'speaker',
    x: 0,
    z,
    blocks: [],
  }));
  const places: Place[] = [originSpeaker, ...extraSpeakers, ...kept];
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
  return { bots, speakers, spots, boxes };
}

/** One chat line to send: which speaker (index into the speakers), its sequence number, and when (ms from start). */
export interface ChatEvent {
  atMs: number;
  speaker: number;
  seq: number;
}

/**
 * The chat schedule for `lines` rounds. Steady: every speaker sends once per interval, speaker k starts k * interval / K
 * after the round starts, so the sends are staggered. Burst: every speaker sends at the round start, so they
 * share one tick. Pure. With one speaker and steady, this is one line per interval at the round start.
 */
export function chatSchedule(
  speakers: number,
  lines: number,
  intervalMs: number,
  mode: ChatMode,
): ChatEvent[] {
  const events: ChatEvent[] = [];
  for (let seq = 1; seq <= lines; seq++) {
    const roundStart = (seq - 1) * intervalMs;
    for (let speaker = 0; speaker < speakers; speaker++) {
      const offset = mode === 'steady' ? Math.round((speaker * intervalMs) / speakers) : 0;
      events.push({ atMs: roundStart + offset, speaker, seq });
    }
  }
  return events;
}

/** Groups a schedule into the sends that share a start time: each group is one event-loop turn of chat calls. */
export function sendGroups(events: readonly ChatEvent[]): ChatEvent[][] {
  const groups: ChatEvent[][] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.atMs === event.atMs) last.push(event);
    else groups.push([event]);
  }
  return groups;
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
  /** Speakers, 1 (the control) to 5. Default 1. */
  speakers?: number;
  /** Default steady. */
  mode?: ChatMode;
  cfg: GolemConfig;
  throwawayFlag: boolean;
  /** Lines per speaker. */
  lines?: number;
  intervalMs?: number;
  log?: (line: string) => void;
  deps?: MuffleDeps;
}

export interface MuffleRunResult {
  layout: Layout;
  /** Lines sent in total: lines per speaker times the speakers. */
  sent: number;
  /** Distinct (speaker, line) pairs each listener heard, by bot name. */
  heard: Record<string, number>;
  mspt: number | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until the clock reads `at` (a Date.now() value). Returns at once when it has passed. */
const sleepUntil = (at: number): Promise<void> => sleep(Math.max(0, at - Date.now()));

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
  const layout = muffleLayout(opts.bots, opts.speakers ?? 1);
  const mode = opts.mode ?? 'steady';
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
    const heard = new Map<string, Set<string>>();
    const speakers = bots.slice(0, layout.speakers);
    const speakerNames = new Set(layout.spots.slice(0, layout.speakers).map((s) => s.name));
    layout.spots.slice(layout.speakers).forEach((spot, i) => {
      const seen = new Set<string>();
      heard.set(spot.name, seen);
      (bots[layout.speakers + i] as Bot).on('chat', (username: string, message: string) => {
        const seq = speakerNames.has(username) ? parseSeq(message) : null;
        if (seq !== null) seen.add(`${username}#${seq}`);
      });
    });
    const lines = opts.lines ?? CHAT_LINES;
    const interval = opts.intervalMs ?? CHAT_INTERVAL_MS;
    const start = Date.now();
    for (const group of sendGroups(chatSchedule(layout.speakers, lines, interval, mode))) {
      await sleepUntil(start + (group[0]?.atMs ?? 0));
      // One group is one event-loop turn: its chat calls are back to back, with no await between them.
      for (const event of group) {
        (speakers[event.speaker] as Bot).chat(`mh8a L${event.seq} alpha bravo charlie`);
      }
    }
    await sleepUntil(start + lines * interval + interval);
    const mspt = parseMspt(await ctl.tickQuery());
    const sent = lines * layout.speakers;
    log(
      `sent ${sent} lines from ${layout.speakers} speakers (${mode}) to ${layout.spots.length - layout.speakers} listeners`,
    );
    return {
      layout,
      sent,
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
