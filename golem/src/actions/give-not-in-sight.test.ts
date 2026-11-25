import { Vec3 } from 'vec3';
import { describe, expect, it, vi } from 'vitest';
import { NOT_IN_SIGHT } from './give.ts';
import { notInSightFacts } from './give-not-in-sight.ts';
import { setup } from './give-test-fixture.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

/** The parsed `not_in_sight` lines among the calls the diag sink saw. */
function notInSightLines(calls: unknown[][]): Record<string, unknown>[] {
  return calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes('"not_in_sight"'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('the operator diag line for a recipient not in sight', () => {
  it('names name_not_matched, with the loaded players, for a name no loaded player has', async () => {
    const { world, run, toss } = setup();
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const out = await run('Nobody');
    expect(out).toMatchObject({ status: 'failed', message: NOT_IN_SIGHT });
    expect(toss).not.toHaveBeenCalled();
    const lines = notInSightLines(log.mock.calls);
    expect(lines).toHaveLength(1);
    const self = world.bot.entity.position;
    const pike = new Vec3(0.5, 64, 2.5);
    expect(lines[0]).toMatchObject({
      event: 'not_in_sight',
      check: 'name_not_matched',
      to: 'Nobody',
      self: { x: self.x, y: self.y, z: self.z },
      entity: null,
      dist: null,
      los_block: null,
      los_block_pos: null,
      rays: null,
      loaded_players: [{ username: 'Pike', dist: Math.round(self.distanceTo(pike) * 100) / 100 }],
    });
    vi.restoreAllMocks();
  });

  it('names not_loaded for a name the server lists but the Body has not loaded', async () => {
    const { run } = setup();
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    // `Hidden` is in bot.players (the server's list) with no entity in view.
    const out = await run('Hidden');
    expect(out).toMatchObject({ status: 'failed', message: NOT_IN_SIGHT });
    expect(notInSightLines(log.mock.calls)[0]).toMatchObject({ check: 'not_loaded', entity: null });
    vi.restoreAllMocks();
  });

  it('names out_of_range_24 with the entity position and distance beyond 24 blocks', async () => {
    const { world, run } = setup();
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 30.5) };
    const out = await run('Pike');
    expect(out).toMatchObject({ status: 'failed', message: NOT_IN_SIGHT });
    const [line] = notInSightLines(log.mock.calls);
    expect(line).toMatchObject({
      check: 'out_of_range_24',
      to: 'Pike',
      entity: { x: 0.5, y: 64, z: 30.5, height: 1, pose: null },
      los_block: null,
    });
    expect(line?.dist).toBeGreaterThan(24);
    vi.restoreAllMocks();
  });

  it('names los_blocked with the first blocking block when a wall is between the eyes and the body', async () => {
    const { world, run } = setup();
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    world.set('stone', 0, 64, 1);
    world.set('stone', 0, 65, 1);
    world.set('stone', 1, 64, 1);
    world.set('stone', 1, 65, 1);
    const out = await run('Pike');
    expect(out).toMatchObject({ status: 'failed', message: NOT_IN_SIGHT });
    expect(notInSightLines(log.mock.calls)[0]).toMatchObject({
      check: 'los_blocked',
      entity: { x: 0.5, y: 64, z: 2.5, height: 1 },
      los_block: 'stone',
      los_block_pos: { x: 0, y: 65, z: 1 },
      rays: { feet: 'stone', middle: 'stone', eyes: 'stone' },
    });
    vi.restoreAllMocks();
  });

  it('a low border blocks the middle line but leaves the eyes line clear', async () => {
    const { world, run } = setup();
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    // A standing player five blocks off, behind one plank at foot height one block before it.
    world.entities[2] = {
      type: 'player',
      username: 'Pike',
      position: new Vec3(0.5, 64, 5.5),
      height: 1.8,
    };
    world.set('oak_planks', 0, 64, 4);
    const out = await run('Pike');
    expect(out).toMatchObject({ status: 'failed', message: NOT_IN_SIGHT });
    expect(notInSightLines(log.mock.calls)[0]).toMatchObject({
      check: 'los_blocked',
      los_block: 'oak_planks',
      los_block_pos: { x: 0, y: 64, z: 4 },
      rays: { feet: 'oak_planks', middle: 'oak_planks', eyes: null },
    });
    vi.restoreAllMocks();
  });

  it('lists at most 12 loaded players, the nearest first', async () => {
    const { world, run } = setup();
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    for (let k = 0; k < 14; k++) {
      world.entities[10 + k] = {
        type: 'player',
        username: `P${k}`,
        position: new Vec3(k + 1, 64, 20),
      };
    }
    await run('Nobody');
    const [line] = notInSightLines(log.mock.calls);
    const listed = line?.loaded_players as { username: string; dist: number }[];
    expect(listed).toHaveLength(12);
    expect(listed[0]?.username).toBe('P0');
    expect(listed.map((p) => p.dist)).toEqual([...listed.map((p) => p.dist)].sort((a, b) => a - b));
    vi.restoreAllMocks();
  });

  it('carries the world tick, read from the bot as the Body has it', () => {
    const bot = {
      username: 'Kestrel',
      entity: { position: new Vec3(0, 64, 0) },
      entities: {},
      players: {},
      time: { age: 4321 },
      world: { raycast: () => null },
    } as unknown as Parameters<typeof notInSightFacts>[0];
    expect(notInSightFacts(bot, 'Nobody')).toMatchObject({ tick: 4321, check: 'name_not_matched' });
  });

  it('a sink that throws never changes the refusal', async () => {
    const { world, run } = setup();
    world.entities[2] = { type: 'player', username: 'Pike', position: new Vec3(0.5, 64, 2.5) };
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    log.mockImplementation(() => {
      throw new Error('sink down');
    });
    const out = await run('Nobody');
    expect(out).toMatchObject({ status: 'failed', reason: 'not_found', message: NOT_IN_SIGHT });
    vi.restoreAllMocks();
  });
});
