import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import type { SeenKv } from '../building/seen/store.ts';
import { fakeBot, fakeView, manualTicks } from './body.fakes.ts';
import { createBody } from './create-body.ts';

const LIFE = 'ag_seen_life1';
const NEXT = 'ag_seen_life2';
const AGENT = 'ag_seen';
/** The cone is covered over these sampled ticks (the recorder's budget is 64 rays a tick). */
const SAMPLED_TICKS = [10, 20, 30, 40];
/** Covers the wall at z -3 and the block behind it at z -6. */
const BOX = { min: { x: -4, y: 62, z: -8 }, max: { x: 4, y: 66, z: 0 } };

/** A stone wall across the cone at z -3; a diamond ore behind it at (0,64,-6); air elsewhere. */
function worldBlock(p: { x: number; y: number; z: number }): {
  name: string;
  boundingBox: string;
  light: number;
  skyLight: number;
} {
  const wall = p.z === -3 && p.y >= 56 && p.y <= 72 && p.x >= -30 && p.x <= 30;
  const hidden = p.z === -6 && p.x === 0 && p.y === 64;
  const name = wall ? 'stone' : hidden ? 'diamond_ore' : 'air';
  return { name, boundingBox: name === 'air' ? 'empty' : 'block', light: 15, skyLight: 15 };
}

/** An in-memory KV with the SeenKv shape. */
function memoryKv(): SeenKv & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    put: async (key, value) => {
      data.set(key, value);
      return 1;
    },
    get: async (key) => data.get(key) ?? null,
    delete: async (key) => {
      data.delete(key);
    },
    list: async (prefix) => [...data.keys()].filter((key) => key.startsWith(prefix)),
  };
}

function seenBody(opts: {
  building: boolean;
  kv?: SeenKv;
  lifeId?: string;
  predecessor?: { lifeId: string; agentId: string } | null;
}) {
  const ticks = manualTicks();
  const bot = fakeBot();
  const world = { getBlock: vi.fn((p: Vec3) => worldBlock(p)) };
  (bot as unknown as { world: unknown }).world = world;
  const self = bot.entity as unknown as { yaw: number; pitch: number };
  self.yaw = 0;
  self.pitch = 0;
  const made = createBody({
    lifeId: opts.lifeId ?? LIFE,
    bodyGeneration: 1,
    bot,
    ticks: ticks.source,
    currentRevision: () => 1,
    view: fakeView(),
    building: opts.building,
    seen: {
      agentId: AGENT,
      ...(opts.kv === undefined ? {} : { kv: opts.kv }),
      ...(opts.predecessor === undefined ? {} : { predecessor: opts.predecessor }),
    },
  });
  return { ...made, ticks, bot, world };
}

function sweep(ticks: { emit(age: number): void }): void {
  for (const tick of SAMPLED_TICKS) ticks.emit(tick);
}

describe('createBody with body_actions.building on: the seen map', () => {
  it('records a block in view, and the survey reports it', async () => {
    const made = seenBody({ building: true });
    sweep(made.ticks);
    await made.seen?.ready;
    const reply = made.seen?.survey(BOX, 50);
    expect(reply?.text).toContain('stone');
  });

  it('does not record a block behind a wall (no wall-hack)', () => {
    const made = seenBody({ building: true });
    sweep(made.ticks);
    expect(made.seen?.map.read(0, 64, -3)?.name).toBe('stone');
    expect(made.seen?.map.read(0, 64, -6)).toBeUndefined();
    expect(made.seen?.survey(BOX, 50).text).not.toContain('diamond_ore');
  });

  it('an observed change updates a seen cell, and a change to an unseen cell is not recorded', () => {
    const made = seenBody({ building: true });
    sweep(made.ticks);
    const emitter = made.bot as unknown as { emit(event: string, ...args: unknown[]): boolean };
    emitter.emit('blockUpdate', { name: 'stone' }, { name: 'air', position: new Vec3(0, 64, -3) });
    emitter.emit(
      'blockUpdate',
      { name: 'air' },
      { name: 'iron_block', position: new Vec3(0, 64, -6) },
    );
    expect(made.seen?.map.read(0, 64, -3)?.name).toBe('air');
    expect(made.seen?.map.read(0, 64, -6)).toBeUndefined();
  });

  it('death keeps the map in KV, and the next life reads its predecessor', async () => {
    const kv = memoryKv();
    const first = seenBody({ building: true, kv });
    sweep(first.ticks);
    (first.bot as unknown as { emit(event: string): boolean }).emit('death');
    await vi.waitFor(() =>
      expect([...kv.data.keys()].some((key) => key.startsWith(`${LIFE}.`))).toBe(true),
    );
    const second = seenBody({
      building: true,
      kv,
      lifeId: NEXT,
      predecessor: { lifeId: LIFE, agentId: AGENT },
    });
    await second.seen?.ready;
    expect(second.seen?.survey(BOX, 50).text).toContain('stone');
    expect(await first.seen?.eraseLife()).toBeGreaterThan(0);
    expect([...kv.data.keys()].some((key) => key.startsWith(`${LIFE}.`))).toBe(false);
  });

  it('a predecessor of another agent is never read', async () => {
    const kv = memoryKv();
    const first = seenBody({ building: true, kv });
    sweep(first.ticks);
    await first.seen?.flush();
    const second = seenBody({
      building: true,
      kv,
      lifeId: NEXT,
      predecessor: { lifeId: LIFE, agentId: 'ag_other' },
    });
    await second.seen?.ready;
    expect(second.seen?.survey(BOX, 50).text).not.toContain('stone');
  });
});

describe('createBody with body_actions.building off: nothing seen is built', () => {
  it('constructs no seen map and never reads the world for it', () => {
    const made = seenBody({ building: false });
    sweep(made.ticks);
    expect(made.seen).toBeNull();
    expect(made.world.getBlock).not.toHaveBeenCalled();
  });
});
