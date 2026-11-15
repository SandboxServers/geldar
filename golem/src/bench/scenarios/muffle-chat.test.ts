import { describe, expect, it } from 'vitest';
import type { GolemConfig } from '../../config.ts';
import {
  assertThrowawayTarget,
  BENCH_RCON_PORT,
  type BotSession,
  benchName,
  chatSchedule,
  FILL_TRIES,
  type MuffleDeps,
  muffleLayout,
  parseSeq,
  runMuffleChat,
  sendGroups,
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
  /** Runs before the `tick query` reply, so a test can drive the listeners' chat handlers there. */
  beforeTickQuery?: (handlers: Map<string, ChatHandler>) => void;
}

type ChatHandler = (username: string, message: string) => void;

/**
 * A fake RCON source and bot starter. Records every command, in order. Each chat call appends `chat <name>` to
 * `events` and queues a microtask that appends `turn`, so a test can tell whether another turn ran between sends.
 * The chat handler each bot registers is kept in `handlers`, by bot name.
 */
function fakeDeps(opts: FakeOptions = {}): {
  deps: MuffleDeps;
  commands: string[];
  chats: { speaker: string; message: string }[];
  events: string[];
  handlers: Map<string, ChatHandler>;
} {
  const commands: string[] = [];
  const chats: { speaker: string; message: string }[] = [];
  const events: string[] = [];
  const handlers = new Map<string, ChatHandler>();
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
          opts.beforeTickQuery?.(handlers);
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
      const chat = (message: string) => {
        chats.push({ speaker: spot.name, message });
        events.push(`chat ${spot.name}`);
        queueMicrotask(() => events.push('turn'));
      };
      const on = (event: string, handler: ChatHandler) => {
        if (event === 'chat') handlers.set(spot.name, handler);
      };
      const bot = { username: spot.name, on, chat };
      return { bot: bot as never, stop: async () => undefined };
    },
  };
  return { deps, commands, chats, events, handlers };
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

  it('builds the layout when only the last allowed attempt succeeds', async () => {
    const boxes = muffleLayout(9).boxes.length;
    const { run, commands } = runFake(9, { notLoaded: (FILL_TRIES - 1) * boxes });
    await run;
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

/** Straight-line distance between two layout points, to 2 places, as the layout reports it. */
const between = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.round(Math.hypot(a.x - b.x, a.z - b.z) * 100) / 100;

describe('muffleLayout with speakers', () => {
  it('places 9 bots as 3 speakers and 6 listeners: the origin, z 2 and z -2', () => {
    const layout = muffleLayout(9, 3);
    expect(layout.speakers).toBe(3);
    expect(layout.spots).toHaveLength(9);
    const speakers = layout.spots.filter((s) => s.role === 'speaker');
    expect(speakers.map((s) => [s.x, s.z])).toEqual([
      [0, 0],
      [0, 2],
      [0, -2],
    ]);
    expect(layout.spots.slice(0, 3).every((s) => s.role === 'speaker')).toBe(true);
    expect(layout.spots.filter((s) => s.role === 'listener')).toHaveLength(6);
  });

  it('keeps the far listeners and the sealed one when 9 bots take 3 speakers', () => {
    const listeners = muffleLayout(9, 3).spots.filter((s) => s.role === 'listener');
    expect(listeners.map((s) => s.distance)).toEqual([9, 13, 17, 21, 25, 31]);
    expect(listeners.at(-1)?.blocks).toEqual([...WALLS.map((w) => w.block), 'stone']);
  });

  it('places 15 bots as 5 speakers and 10 listeners: z 0, 2, -2, 1 and -1', () => {
    const layout = muffleLayout(15, 5);
    expect(layout.speakers).toBe(5);
    expect(layout.spots).toHaveLength(15);
    expect(layout.spots.slice(0, 5).map((s) => [s.x, s.z])).toEqual([
      [0, 0],
      [0, 2],
      [0, -2],
      [0, 1],
      [0, -1],
    ]);
    expect(layout.spots.filter((s) => s.role === 'listener')).toHaveLength(10);
  });

  it('has exactly the requested number of speakers, for every count from 1 to 5', () => {
    for (const bots of [9, 15] as const) {
      for (let k = 1; k <= 5; k++) {
        const layout = muffleLayout(bots, k);
        expect(layout.spots.filter((s) => s.role === 'speaker')).toHaveLength(k);
        expect(layout.spots.filter((s) => s.role === 'listener')).toHaveLength(bots - k);
      }
    }
  });

  it('is the control at one speaker: the same layout as the default', () => {
    expect(muffleLayout(9, 1)).toEqual(muffleLayout(9));
    expect(muffleLayout(15, 1)).toEqual(muffleLayout(15));
  });

  it('keeps every listener within the 32-block raw gate of every speaker', () => {
    for (const bots of [9, 15] as const) {
      for (let k = 1; k <= 5; k++) {
        const spots = muffleLayout(bots, k).spots;
        const speakers = spots.filter((s) => s.role === 'speaker');
        for (const listener of spots.filter((s) => s.role === 'listener')) {
          for (const speaker of speakers) {
            expect(between(listener, speaker)).toBeLessThanOrEqual(HEARING_RADIUS);
          }
        }
      }
    }
  });

  it('gives every speaker and listener its own unique username', () => {
    const names = muffleLayout(15, 5).spots.map((s) => s.name);
    expect(new Set(names).size).toBe(15);
  });

  it('refuses a speaker count outside 1 to 5', () => {
    expect(() => muffleLayout(9, 0)).toThrow(RangeError);
    expect(() => muffleLayout(9, 6)).toThrow(RangeError);
    expect(() => muffleLayout(9, 1.5)).toThrow(RangeError);
  });
});

describe('chatSchedule', () => {
  it('bursts: every speaker sends in the same round start, for each round', () => {
    const events = chatSchedule(3, 2, 2000, 'burst');
    expect(events.map((e) => e.atMs)).toEqual([0, 0, 0, 2000, 2000, 2000]);
    const groups = sendGroups(events);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.map((e) => e.speaker))).toEqual([
      [0, 1, 2],
      [0, 1, 2],
    ]);
  });

  it('steps K speakers through one interval, staggered: k * interval / K', () => {
    const round = chatSchedule(3, 1, 2000, 'steady');
    expect(round.map((e) => e.atMs)).toEqual([0, 667, 1333]);
    expect(sendGroups(round)).toHaveLength(3);
  });

  it('staggers every round: the next round starts one interval after the first', () => {
    const events = chatSchedule(5, 2, 2000, 'steady');
    const second = events.filter((e) => e.seq === 2).map((e) => e.atMs);
    expect(second).toEqual([2000, 2400, 2800, 3200, 3600]);
  });

  it('keeps the control: one speaker, steady, one line per interval at the round start', () => {
    expect(chatSchedule(1, 3, 2000, 'steady')).toEqual([
      { atMs: 0, speaker: 0, seq: 1 },
      { atMs: 2000, speaker: 0, seq: 2 },
      { atMs: 4000, speaker: 0, seq: 3 },
    ]);
  });

  it('sends one line per speaker per round, no more and no fewer', () => {
    expect(chatSchedule(5, 4, 2000, 'burst')).toHaveLength(20);
    expect(chatSchedule(3, 20, 2000, 'steady')).toHaveLength(60);
  });
});

describe('runMuffleChat with speakers', () => {
  const CFG_BENCH = {
    mcHost: '127.0.0.1',
    mcPort: 26565,
    rconHost: '127.0.0.1',
    rconPort: BENCH_RCON_PORT,
  } as GolemConfig;

  it('teleports the extra speakers to z 2 and z -2 of the origin', async () => {
    const { deps, commands } = fakeDeps();
    await runMuffleChat({
      bots: 9,
      speakers: 3,
      cfg: CFG_BENCH,
      throwawayFlag: false,
      lines: 0,
      intervalMs: 0,
      deps,
    });
    expect(commands).toContain('tp MuffleBench01 1000 65 1002');
    expect(commands).toContain('tp MuffleBench02 1000 65 998');
  });

  it('burst: sends K chat calls per round, one speaker line each, all K speakers', async () => {
    const { deps, chats } = fakeDeps();
    const result = await runMuffleChat({
      bots: 9,
      speakers: 3,
      mode: 'burst',
      cfg: CFG_BENCH,
      throwawayFlag: false,
      lines: 2,
      intervalMs: 0,
      deps,
    });
    expect(result.sent).toBe(6);
    expect(chats.map((c) => c.speaker)).toEqual([
      'MuffleBench00',
      'MuffleBench01',
      'MuffleBench02',
      'MuffleBench00',
      'MuffleBench01',
      'MuffleBench02',
    ]);
    expect(chats[0]?.message).toBe('mh8a L1 alpha bravo charlie');
    expect(chats[5]?.message).toBe('mh8a L2 alpha bravo charlie');
  });

  it('burst: all K chat calls of a round run in one turn, before any other turn', async () => {
    // One round: with intervalMs 0 two rounds would share a send group, so one round is what this checks.
    const { deps, events } = fakeDeps();
    await runMuffleChat({
      bots: 9,
      speakers: 3,
      mode: 'burst',
      cfg: CFG_BENCH,
      throwawayFlag: false,
      lines: 1,
      intervalMs: 0,
      deps,
    });
    const firstTurn = events.indexOf('turn');
    expect(events.slice(0, firstTurn)).toEqual([
      'chat MuffleBench00',
      'chat MuffleBench01',
      'chat MuffleBench02',
    ]);
    expect(events.filter((e) => e.startsWith('chat '))).toHaveLength(3);
  });

  it('burst: two rounds a nonzero interval apart each run in their own turn', async () => {
    const { deps, chats, events } = fakeDeps();
    const started = Date.now();
    await runMuffleChat({
      bots: 9,
      speakers: 3,
      mode: 'burst',
      cfg: CFG_BENCH,
      throwawayFlag: false,
      lines: 2,
      intervalMs: 50,
      deps,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(events.slice(0, 3).every((e) => e.startsWith('chat '))).toBe(true);
    expect(events.slice(3, 6)).toEqual(['turn', 'turn', 'turn']);
    expect(events.slice(6, 9).every((e) => e.startsWith('chat '))).toBe(true);
    expect(chats.slice(0, 3).every((c) => c.message.startsWith('mh8a L1 '))).toBe(true);
    expect(chats.slice(3).every((c) => c.message.startsWith('mh8a L2 '))).toBe(true);
  });

  it('steady: each speaker sends each of its lines once', async () => {
    const { deps, chats } = fakeDeps();
    const result = await runMuffleChat({
      bots: 9,
      speakers: 3,
      cfg: CFG_BENCH,
      throwawayFlag: false,
      lines: 2,
      intervalMs: 0,
      deps,
    });
    expect(result.sent).toBe(6);
    for (const name of ['MuffleBench00', 'MuffleBench01', 'MuffleBench02']) {
      expect(chats.filter((c) => c.speaker === name)).toHaveLength(2);
    }
  });

  it('control: one speaker sends its lines alone, as before', async () => {
    const { deps, chats } = fakeDeps();
    const result = await runMuffleChat({
      bots: 9,
      cfg: CFG_BENCH,
      throwawayFlag: false,
      lines: 3,
      intervalMs: 0,
      deps,
    });
    expect(result.sent).toBe(3);
    expect(chats.map((c) => c.speaker)).toEqual([
      'MuffleBench00',
      'MuffleBench00',
      'MuffleBench00',
    ]);
  });

  it('refuses a speaker count outside 1 to 5 before it opens any connection', async () => {
    const { deps, commands } = fakeDeps();
    await expect(
      runMuffleChat({ bots: 9, speakers: 6, cfg: CFG_BENCH, throwawayFlag: false, deps }),
    ).rejects.toThrow(RangeError);
    expect(commands).toEqual([]);
  });
});

describe('runMuffleChat heard count', () => {
  it('counts distinct (speaker, line) pairs per listener, and only lines from speakers', async () => {
    const { deps } = fakeDeps({
      beforeTickQuery: (handlers) => {
        // setTps asks for the tick rate before any bot starts: only the later query sees the handlers.
        if (!handlers.has('MuffleBench02')) return;
        const listener = handlers.get('MuffleBench02') as ChatHandler;
        const other = handlers.get('MuffleBench03') as ChatHandler;
        listener('MuffleBench00', 'mh8a L1 alpha bravo charlie');
        listener('MuffleBench01', 'mh8a L1 alpha bravo charlie'); // the second speaker, same line number
        listener('MuffleBench00', 'mh8a L1 alpha bravo charlie'); // a duplicate: not counted again
        listener('Steve', 'mh8a L2 alpha bravo charlie'); // not a speaker
        listener('MuffleBench02', 'mh8a L3 alpha bravo charlie'); // a listener is not a speaker either
        listener('MuffleBench00', 'hello L2 alpha bravo charlie'); // malformed: no bench prefix
        listener('MuffleBench00', 'mh8a L2 alpha bravo charlie'); // a distinct line
        other('MuffleBench00', 'mh8a L1 alpha bravo charlie');
      },
    });
    const result = await runMuffleChat({
      bots: 9,
      speakers: 2,
      cfg: CFG,
      throwawayFlag: false,
      lines: 0,
      intervalMs: 0,
      deps,
    });
    expect(result.heard.MuffleBench02).toBe(3);
    expect(result.heard.MuffleBench03).toBe(1);
  });
});

describe('parseSeq', () => {
  it('reads the sequence number of a bench line and nothing else', () => {
    expect(parseSeq('mh8a L7 alpha bravo charlie')).toBe(7);
    expect(parseSeq('hello there')).toBeNull();
    expect(parseSeq('xmh8a L7 alpha')).toBeNull();
  });
});
