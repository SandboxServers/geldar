import { describe, expect, it } from 'vitest';
import type { GolemConfig } from '../../config.ts';
import {
  assertThrowawayTarget,
  BENCH_RCON_PORT,
  type BotSession,
  benchName,
  FILL_TRIES,
  type MuffleDeps,
  muffleLayout,
  parseSeq,
  runMuffleChat,
  THROWAWAY_FLAG,
  WALLS,
} from './muffle-chat.ts';

/** The ProximityRule raw gate (HEARING_RADIUS_BLOCKS): a listener past it is never judged. */
const HEARING_RADIUS = 32;

interface FakeOptions {
  /** The first this many fill commands reply `not loaded`. Infinity makes every fill do so. */
  notLoaded?: number;
  /** The reply of every fill that is not `not loaded`. */
  fillReply?: string;
  /** The 1-based bot start that throws. */
  startFailsAt?: number;
}

/** A fake RCON source and bot starter. Records every command, in order. */
function fakeDeps(opts: FakeOptions = {}): { deps: MuffleDeps; commands: string[] } {
  const commands: string[] = [];
  let fills = 0;
  let starts = 0;
  const deps: MuffleDeps = {
    connect: async () => ({
      command: async (cmd: string) => {
        commands.push(cmd);
        if (cmd.startsWith('fill ')) {
          fills += 1;
          if (fills <= (opts.notLoaded ?? 0)) return 'Chunk not loaded at that position';
          return opts.fillReply ?? 'Successfully filled 7 blocks';
        }
        if (cmd === 'tick query') {
          return 'Target tick rate: 20.0 per second.\nAverage time per tick: 0.1ms (Target: 50.0ms)';
        }
        if (cmd.startsWith('whitelist add')) return 'Added to the whitelist';
        return '';
      },
      close: async () => undefined,
    }),
    startBot: async (spot): Promise<BotSession> => {
      starts += 1;
      if (opts.startFailsAt === starts) throw new Error('bot refused');
      const bot = { username: spot.name, on: () => undefined, chat: () => undefined };
      return { bot: bot as never, stop: async () => undefined };
    },
  };
  return { deps, commands };
}

const CFG = {
  mcHost: '127.0.0.1',
  mcPort: 26565,
  rconHost: '127.0.0.1',
  rconPort: BENCH_RCON_PORT,
} as GolemConfig;

/** Runs the layout with no chat and no wait, against a fake source. */
function runFake(bots: number, opts: FakeOptions) {
  const { deps, commands } = fakeDeps(opts);
  const run = runMuffleChat({
    bots,
    cfg: CFG,
    throwawayFlag: false,
    lines: 0,
    intervalMs: 0,
    deps,
  });
  return { run, commands };
}

describe('assertThrowawayTarget', () => {
  it('accepts the bench RCON port without the flag', () => {
    expect(() => assertThrowawayTarget(BENCH_RCON_PORT, false)).not.toThrow();
  });

  it('refuses any other port without the flag, including the phase0 RCON port', () => {
    expect(() => assertThrowawayTarget(25575, false)).toThrow(/refusing/);
    expect(() => assertThrowawayTarget(26565, false)).toThrow(/refusing/);
  });

  it('accepts another port only with the throwaway flag', () => {
    expect(() => assertThrowawayTarget(25575, true)).not.toThrow();
    expect(THROWAWAY_FLAG).toBe('--i-know-this-is-a-throwaway');
  });
});

describe('runMuffleChat guard', () => {
  it('refuses before it opens any connection, on the phase0 RCON port', async () => {
    const cfg = { mcHost: '127.0.0.1', mcPort: 25565, rconHost: '127.0.0.1', rconPort: 25575 };
    await expect(
      runMuffleChat({ bots: 9, cfg: cfg as GolemConfig, throwawayFlag: false }),
    ).rejects.toThrow(/refusing/);
  });
});

describe('muffleLayout', () => {
  it('builds 9 bots: a speaker, seven row listeners and the sealed listener', () => {
    const layout = muffleLayout(9);
    expect(layout.spots).toHaveLength(9);
    expect(layout.spots[0]).toMatchObject({ role: 'speaker', distance: 0, blocks: [] });
    const listeners = layout.spots.slice(1);
    expect(listeners.map((s) => s.distance)).toEqual([2, 5, 9, 13, 17, 21, 25, 31]);
  });

  it('builds 15 bots with a second row 2 blocks north', () => {
    const layout = muffleLayout(15);
    expect(layout.spots).toHaveLength(15);
    const second = layout.spots.filter((s) => s.z === 2);
    expect(second).toHaveLength(6);
    expect(second.map((s) => s.distance)).toEqual([2.83, 5.39, 9.22, 13.15, 17.12, 21.1]);
  });

  it('puts every listener within the 32-block raw hearing gate of the speaker', () => {
    for (const bots of [9, 15] as const) {
      for (const spot of muffleLayout(bots).spots) {
        expect(spot.distance).toBeLessThanOrEqual(HEARING_RADIUS);
      }
    }
  });

  it('lists the walls between the speaker and each listener, nearest first', () => {
    const at = (distance: number) => muffleLayout(9).spots.find((s) => s.distance === distance);
    expect(at(2)?.blocks).toEqual([]);
    expect(at(5)?.blocks).toEqual(['stone']);
    expect(at(13)?.blocks).toEqual(['stone', 'glass', 'oak_planks']);
    expect(at(25)?.blocks).toEqual([
      'stone',
      'glass',
      'oak_planks',
      'white_wool',
      'tinted_glass',
      'stone_brick_slab',
    ]);
  });

  it('puts the sealed listener behind every wall and its stone shell', () => {
    const sealed = muffleLayout(9).spots.at(-1);
    expect(sealed?.distance).toBe(31);
    expect(sealed?.blocks).toEqual([...WALLS.map((w) => w.block), 'stone']);
  });

  it('keeps the sealed room inside the walls and its listener inside the room', () => {
    const boxes = muffleLayout(9).boxes;
    const room = boxes.find((b) => b.block === 'stone' && b.from.x === 28);
    const hollow = boxes.find((b) => b.block === 'air' && b.from.x === 29);
    expect(room).toMatchObject({ from: { x: 28, y: 64, z: -2 }, to: { x: 34, y: 68, z: 2 } });
    expect(hollow).toMatchObject({ from: { x: 29, y: 65, z: -1 }, to: { x: 33, y: 67, z: 1 } });
  });

  it('gives unique, valid Minecraft usernames', () => {
    const names = muffleLayout(15).spots.map((s) => s.name);
    expect(new Set(names).size).toBe(15);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_]{3,16}$/);
    expect(benchName(0)).toBe('MuffleBench00');
  });

  it('refuses any other bot count', () => {
    expect(() => muffleLayout(10)).toThrow(RangeError);
    expect(() => muffleLayout(1)).toThrow(RangeError);
  });

  it('keeps every fill box inside the x and z range the world border allows', () => {
    for (const box of muffleLayout(15).boxes) {
      expect(Math.abs(box.from.x)).toBeLessThan(100);
      expect(Math.abs(box.to.z)).toBeLessThan(100);
    }
  });
});

describe('runMuffleChat commands', () => {
  it('force-loads the layout before the first fill', async () => {
    const { run, commands } = runFake(9, {});
    await run;
    const forceload = commands.findIndex((c) => c.startsWith('forceload add '));
    const firstFill = commands.findIndex((c) => c.startsWith('fill '));
    expect(forceload).toBeGreaterThanOrEqual(0);
    expect(forceload).toBeLessThan(firstFill);
  });

  it('sends the exact force-load box, from the origin offsets', async () => {
    const { run, commands } = runFake(9, {});
    await run;
    expect(commands).toContain('forceload add 996 994 1046 1006');
  });

  it('fills a wall at the origin offset and sign: from x 3 is absolute x 1003, z -3..3 is 997..1003', async () => {
    const { run, commands } = runFake(9, {});
    await run;
    expect(commands).toContain('fill 1003 65 997 1003 67 1003 stone');
  });

  it('teleports each listener east of the origin by its offset, with the sealed one at x 1031', async () => {
    const { run, commands } = runFake(9, {});
    await run;
    expect(commands).toContain('tp MuffleBench04 1013 65 1000');
    expect(commands).toContain('tp MuffleBench08 1031 65 1000');
  });

  it('teleports the 15-bot second row north of the origin: z 1002', async () => {
    const { run, commands } = runFake(15, {});
    await run;
    expect(commands).toContain('tp MuffleBench08 1002 65 1002');
  });

  it('retries the whole fill set when a fill reports not loaded, then succeeds', async () => {
    const boxes = muffleLayout(9).boxes.length;
    const { run, commands } = runFake(9, { notLoaded: 1 });
    await run;
    const fills = commands.filter((c) => c.startsWith('fill ')).length;
    expect(fills).toBe(2 * boxes);
  });

  it('gives up after the last allowed attempt, when every fill stays not loaded', async () => {
    const boxes = muffleLayout(9).boxes.length;
    const { run, commands } = runFake(9, { notLoaded: Number.POSITIVE_INFINITY });
    await expect(run).rejects.toThrow(/did not build/);
    expect(commands.filter((c) => c.startsWith('fill ')).length).toBe(FILL_TRIES * boxes);
  }, 15_000);

  it('throws when a fill reply is not a success', async () => {
    const { run } = runFake(9, { fillReply: 'Unknown block type' });
    await expect(run).rejects.toThrow(/layout fill failed/);
  });

  it('removes every whitelist entry when a bot fails to start', async () => {
    const { run, commands } = runFake(9, { startFailsAt: 2 });
    await expect(run).rejects.toThrow(/bot refused/);
    for (const spot of muffleLayout(9).spots) {
      expect(commands).toContain(`whitelist remove ${spot.name}`);
    }
  });
});

describe('parseSeq', () => {
  it('reads the sequence number of a bench line and nothing else', () => {
    expect(parseSeq('mh8a L7 alpha bravo charlie')).toBe(7);
    expect(parseSeq('hello there')).toBeNull();
    expect(parseSeq('xmh8a L7 alpha')).toBeNull();
  });
});
