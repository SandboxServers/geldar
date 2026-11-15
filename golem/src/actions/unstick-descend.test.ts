import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setOwnerLookup } from './protected-blocks.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';
import { digDescend, MAX_DESCEND_DIGS, REFUSAL_TEXT, type Refusal } from './unstick-descend.ts';

/**
 * A stone pillar one block wide at x 0, z 0 with its top at y 70 (the Body stands on it at feet 71). The
 * ground is stone to y 60 everywhere else, so a walk east off the pillar drops to y 61 (3 blocks at feet 64).
 */
const TOP = 70;
const EMPTY = new Set(['air', 'water', 'lava']);

const keyOf = (cell: Vec3): string => `${cell.x},${cell.y},${cell.z}`;

function baseCell(cell: Vec3): string {
  if (cell.x === 0 && cell.z === 0) return cell.y <= TOP ? 'stone' : 'air';
  return cell.y <= 60 ? 'stone' : 'air';
}

/** A fake bot on the pillar. `cells` overrides the base world; a `null` override is an unloaded cell. */
function fakeBot(feetY = TOP + 1) {
  const cells = new Map<string, string | null>();
  const entities: Record<string, unknown> = {};
  const bot = {
    health: 20,
    game: { dimension: 'minecraft:overworld' },
    entity: { position: new Vec3(0, feetY, 0) },
    entities,
    blockAt(cell: Vec3) {
      const name = cells.has(keyOf(cell)) ? cells.get(keyOf(cell)) : baseCell(cell);
      if (name === null || name === undefined) return null;
      return {
        name,
        boundingBox: EMPTY.has(name) ? 'empty' : 'block',
        diggable: true,
        hardness: 1,
      };
    },
    async waitForTicks() {},
  };
  const digs: number[] = [];
  /** Digging a block makes it air, and the Body falls into that cell (one block). */
  const digOne = async (_block: unknown, at: Vec3): Promise<boolean> => {
    digs.push(at.y);
    cells.set(keyOf(at), 'air');
    bot.entity.position = at;
    return true;
  };
  return { bot: bot as unknown as Bot, cells, entities, digs, digOne, raw: bot };
}

function deps(fake: ReturnType<typeof fakeBot>, started = Date.now()) {
  return { bot: fake.bot, signal: new AbortController().signal, started, digOne: fake.digOne };
}

describe('dig_descend rung (decision 0333)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    setOwnerLookup(null);
  });

  function logged(log: { mock: { calls: unknown[][] } }) {
    return log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
  }

  it('digs down one block at a time and stops when a walk of three blocks or less is open', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    const result = await digDescend(deps(fake));
    expect(result).toEqual({
      dug: 7,
      walkable: true,
      stopped: 'a walk of 3 blocks or less is open',
    });
    expect(fake.digs).toEqual([70, 69, 68, 67, 66, 65, 64]);
    expect(fake.raw.entity.position.y).toBe(64);
    expect(logged(log).filter((line) => line.event === 'unstick_descend_step')).toHaveLength(7);
  });

  it('logs each step with the dug block name and the remaining drop', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    await digDescend(deps(fake));
    const steps = logged(log).filter((line) => line.event === 'unstick_descend_step');
    expect(steps[0]).toMatchObject({ event: 'unstick_descend_step', block: 'stone', step: 1 });
    expect(steps.at(-1)).toEqual({
      event: 'unstick_descend_step',
      block: 'stone',
      remaining: 3,
      step: 7,
    });
  });

  it('refuses water beside a soft block in the dig (liquid beside soft blocks too)', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    // Walls on the south side keep the feet-level walk closed, so only the column check decides.
    fake.cells.set('0,70,0', 'dirt');
    fake.cells.set('0,71,1', 'stone');
    fake.cells.set('0,72,1', 'stone');
    fake.cells.set('0,70,1', 'water');
    const result = await digDescend(deps(fake));
    expect(fake.digs).toEqual([]);
    expect(result.stopped).toBe(REFUSAL_TEXT.water);
    expect(logged(log)).toEqual([{ event: 'unstick_descend_refused', reason: 'water' }]);
  });

  it('does not stop on a drop of four or more blocks', async () => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot(65);
    const result = await digDescend(deps(fake));
    expect(result.walkable).toBe(true);
    expect(fake.raw.entity.position.y).toBe(64);
    expect(fake.digs).toEqual([64]);
  });

  it.each([
    ['lava', (c: Map<string, string | null>) => c.set('1,70,0', 'lava')],
    ['lava', (c: Map<string, string | null>) => c.set('0,69,0', 'lava')],
    ['water', (c: Map<string, string | null>) => c.set('0,69,0', 'water')],
    ['unloaded', (c: Map<string, string | null>) => c.set('0,69,0', null)],
    ['unloaded', (c: Map<string, string | null>) => c.set('-1,70,0', null)],
    [
      'void',
      (c: Map<string, string | null>) => {
        for (let y = -64; y <= 69; y++) c.set(`0,${y},0`, 'air');
      },
    ],
    ['gravel', (c: Map<string, string | null>) => c.set('0,73,0', 'gravel')],
    ['undiggable', (c: Map<string, string | null>) => c.set('0,70,0', 'bedrock')],
  ] as const)('refuses the dig when %s is in reach (no dig is made)', async (reason, setup) => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    setup(fake.cells);
    const result = await digDescend(deps(fake));
    expect(fake.digs).toEqual([]);
    expect(result).toEqual({ dug: 0, walkable: false, stopped: REFUSAL_TEXT[reason as Refusal] });
    expect(logged(log)).toEqual([{ event: 'unstick_descend_refused', reason }]);
  });

  it('refuses another player’s block (decision 0164) and digs nothing', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    setOwnerLookup(() => ({ known: true, owner: 'SomeoneElse' }));
    const fake = fakeBot();
    const result = await digDescend(deps(fake));
    expect(fake.digs).toEqual([]);
    expect(result.stopped).toBe(REFUSAL_TEXT.ownership);
    expect(logged(log)).toEqual([{ event: 'unstick_descend_refused', reason: 'ownership' }]);
  });

  it('refuses while a hostile mob is within 8 blocks, and not at 9', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const near = fakeBot();
    near.entities.zombie = { type: 'hostile', position: new Vec3(8, 71, 0) };
    expect(await digDescend(deps(near))).toMatchObject({ dug: 0, stopped: REFUSAL_TEXT.hostile });
    expect(near.digs).toEqual([]);
    expect(logged(log)).toEqual([{ event: 'unstick_descend_refused', reason: 'hostile' }]);
    const far = fakeBot();
    far.entities.zombie = { type: 'hostile', position: new Vec3(9, 71, 0) };
    expect((await digDescend(deps(far))).walkable).toBe(true);
  });

  it('stops at the cap of blocks dug in one call, and logs it', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot(81);
    for (let y = 71; y <= 80; y++) fake.cells.set(`0,${y},0`, 'stone');
    const result = await digDescend(deps(fake));
    expect(result).toEqual({
      dug: MAX_DESCEND_DIGS,
      walkable: false,
      stopped: REFUSAL_TEXT['cap reached'],
    });
    expect(fake.raw.entity.position.y).toBe(81 - MAX_DESCEND_DIGS);
    expect(logged(log).at(-1)).toEqual({ event: 'unstick_descend_refused', reason: 'cap reached' });
  });

  it('returns partial progress when the time budget runs out mid-descent', async () => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const fake = fakeBot();
    const digSlowly = async (block: unknown, at: Vec3) => {
      vi.setSystemTime(Date.now() + 8_000);
      return fake.digOne(block, at);
    };
    const result = await digDescend({ ...deps(fake, 0), digOne: digSlowly });
    expect(result.stopped).toBe('the time budget is spent');
    expect(result.walkable).toBe(false);
    expect(result.dug).toBeGreaterThan(0);
    expect(result.dug).toBeLessThan(7);
    expect(fake.raw.entity.position.y).toBe(TOP + 1 - result.dug);
  });

  it('stops at once when the call is already aborted', async () => {
    const fake = fakeBot();
    const controller = new AbortController();
    controller.abort();
    const result = await digDescend({ ...deps(fake), signal: controller.signal });
    expect(result).toEqual({ dug: 0, walkable: false, stopped: 'the call was stopped' });
    expect(fake.digs).toEqual([]);
  });
});
