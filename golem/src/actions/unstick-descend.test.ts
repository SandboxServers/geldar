import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setOwnerLookup } from './protected-blocks.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';
import {
  digDescend,
  MAX_DESCEND_DIGS,
  NOT_LANDED_TEXT,
  REFUSAL_TEXT,
  type Refusal,
} from './unstick-descend.ts';

/**
 * A stone pillar one block wide at x 0, z 0 with its top at y 70 (the Body stands on it at feet 71). The
 * ground is stone to y 60 everywhere else, so a walk east off the pillar drops to y 61 (3 blocks at feet 64).
 */
const TOP = 70;
/** Blocks with no collision box: the Body falls through them (vine, grass and ladder are not solid). */
const EMPTY = new Set([
  'air',
  'water',
  'lava',
  'fire',
  'sweet_berry_bush',
  'vine',
  'short_grass',
  'ladder',
]);

const keyOf = (cell: Vec3): string => `${cell.x},${cell.y},${cell.z}`;

function baseCell(cell: Vec3): string {
  if (cell.x === 0 && cell.z === 0) return cell.y <= TOP ? 'stone' : 'air';
  return cell.y <= 60 ? 'stone' : 'air';
}

/** A fake bot on the pillar. `cells` overrides the base world; a `null` override is an unloaded cell. */
function fakeBot(feetY = TOP + 1, landAfter?: number) {
  const cells = new Map<string, string | null>();
  const entities: Record<string, unknown> = {};
  let airTicks = 0;
  /** The top of the first non-air cell at or below the Body's column (the cells it has not passed). */
  const groundTop = (p: Vec3): number => {
    for (let c = Math.floor(p.y - 1); ; c--) {
      const block = bot.blockAt(new Vec3(p.x, c, p.z));
      if (block === null || block.boundingBox !== 'empty') return c + 1;
    }
  };
  /** One physics tick of the fall: gravity 0.08 a tick and drag 0.98 (Minecraft's), or a landing after `landAfter` ticks. */
  const stepTick = (): void => {
    const { entity } = bot;
    if (entity.onGround) return;
    airTicks++;
    const ground = groundTop(entity.position);
    const speed = (entity.velocity.y - 0.08) * 0.98;
    const next = entity.position.y + speed;
    const lands = landAfter === undefined ? next <= ground : airTicks >= landAfter;
    if (lands) {
      entity.position = new Vec3(entity.position.x, ground, entity.position.z);
      entity.onGround = true;
      entity.velocity = new Vec3(0, 0, 0);
    } else if (landAfter === undefined) {
      entity.position = new Vec3(entity.position.x, next, entity.position.z);
      entity.velocity = new Vec3(0, speed, 0);
    }
  };
  const bot = {
    health: 20,
    game: { dimension: 'minecraft:overworld' },
    entity: { position: new Vec3(0, feetY, 0), onGround: true, velocity: new Vec3(0, 0, 0) },
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
    async waitForTicks(ticks: number) {
      for (let i = 0; i < ticks; i++) stepTick();
    },
  };
  const digs: number[] = [];
  /** Digging the block under the feet makes it air, and the Body starts to fall (it lands in `stepTick`). */
  const digOne = async (_block: unknown, at: Vec3): Promise<boolean> => {
    digs.push(at.y);
    cells.set(keyOf(at), 'air');
    bot.entity.onGround = false;
    airTicks = 0;
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
    ['lava', (c: Map<string, string | null>) => c.set('1,71,0', 'lava')],
    ['landing', (c: Map<string, string | null>) => c.set('0,69,0', 'magma_block')],
    ['landing', (c: Map<string, string | null>) => c.set('0,69,0', 'cactus')],
    ['landing', (c: Map<string, string | null>) => c.set('0,69,0', 'fire')],
    ['landing', (c: Map<string, string | null>) => c.set('0,69,0', 'sweet_berry_bush')],
    ['landing', (c: Map<string, string | null>) => c.set('0,69,0', 'vine')],
    ['landing', (c: Map<string, string | null>) => c.set('0,69,0', 'short_grass')],
    ['landing', (c: Map<string, string | null>) => c.set('0,69,0', 'ladder')],
  ] as const)('refuses the dig when %s is in reach (no dig is made)', async (reason, setup) => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    setup(fake.cells);
    const result = await digDescend(deps(fake));
    expect(fake.digs).toEqual([]);
    expect(result).toEqual({ dug: 0, walkable: false, stopped: REFUSAL_TEXT[reason as Refusal] });
    expect(logged(log)).toEqual([{ event: 'unstick_descend_refused', reason }]);
  });

  /** Air in the pillar's column from the cell under the floor down to a landing `depth` blocks below the floor. */
  function hollowTo(fake: ReturnType<typeof fakeBot>, depth: number): void {
    for (let y = TOP - 1; y > TOP - depth; y--) fake.cells.set(`0,${y},0`, 'air');
  }

  it.each([4, 7, 50])(
    'refuses a 1-block floor over a hollow whose landing is %i blocks below it (fall, no dig)',
    async (depth) => {
      const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
      const fake = fakeBot();
      hollowTo(fake, depth);
      const result = await digDescend(deps(fake));
      expect(fake.digs).toEqual([]);
      expect(result).toEqual({ dug: 0, walkable: false, stopped: REFUSAL_TEXT.fall });
      expect(logged(log)).toEqual([{ event: 'unstick_descend_refused', reason: 'fall' }]);
    },
  );

  it('allows a floor whose solid landing is 2 blocks below it (the fall is 2)', async () => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    hollowTo(fake, 2);
    const result = await digDescend(deps(fake));
    expect(fake.digs[0]).toBe(TOP);
    expect(result.stopped).not.toBe(REFUSAL_TEXT.fall);
  });

  it('digs the next block once a 2-block fall has landed (the Body lands before the next dig)', async () => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    hollowTo(fake, 2);
    const result = await digDescend(deps(fake));
    expect(fake.digs.slice(0, 2)).toEqual([TOP, TOP - 2]);
    expect(result).toEqual({
      dug: 6,
      walkable: true,
      stopped: 'a walk of 3 blocks or less is open',
    });
  });

  it('digs on after a 3-block landing: the step completes and the rung continues', async () => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    hollowTo(fake, 3);
    const result = await digDescend(deps(fake));
    expect(fake.digs).toEqual([TOP, TOP - 3, 66, 65, 64]);
    expect(result).toEqual({
      dug: 5,
      walkable: true,
      stopped: 'a walk of 3 blocks or less is open',
    });
    expect(fake.raw.entity.position.y).toBe(64);
  });

  it('a 3-block landing is not misread while the Body is still falling (landing on tick 9)', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot(TOP + 1, 9);
    hollowTo(fake, 3);
    const result = await digDescend(deps(fake));
    expect(fake.digs.slice(0, 2)).toEqual([TOP, TOP - 3]);
    expect(result.stopped).not.toBe(REFUSAL_TEXT.undiggable);
    expect(logged(log).filter((line) => line.event === 'unstick_descend_refused')).toEqual([]);
  });

  it('allows a floor whose solid landing is exactly 3 blocks below it (the last allowed fall)', async () => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    hollowTo(fake, 3);
    const result = await digDescend(deps(fake));
    expect(fake.digs[0]).toBe(TOP);
    expect(result.stopped).not.toBe(REFUSAL_TEXT.fall);
  });

  it('refuses the fall when the health would fall under the margin for it (health 1 refuses, 2 allows)', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const low = fakeBot();
    hollowTo(low, 3);
    low.raw.health = 1;
    expect(await digDescend(deps(low))).toEqual({
      dug: 0,
      walkable: false,
      stopped: REFUSAL_TEXT.fall,
    });
    expect(low.digs).toEqual([]);
    expect(logged(log)).toEqual([{ event: 'unstick_descend_refused', reason: 'fall' }]);
    const margin = fakeBot();
    hollowTo(margin, 3);
    margin.raw.health = 2;
    expect((await digDescend(deps(margin))).stopped).not.toBe(REFUSAL_TEXT.fall);
    expect(margin.digs[0]).toBe(TOP);
  });

  it.each([
    [20, 'accepted'],
    [21, 'refused'],
  ])('a fall that lands on tick %i is %s (the bound is 20 ticks)', async (landAfter, outcome) => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot(TOP + 1, landAfter);
    const result = await digDescend(deps(fake));
    expect(fake.digs[0]).toBe(TOP);
    if (outcome === 'accepted') {
      expect(result.stopped).not.toBe(NOT_LANDED_TEXT);
    } else {
      expect(result).toEqual({ dug: 1, walkable: false, stopped: NOT_LANDED_TEXT });
    }
  });

  it('the fall bound scales with the time scale (20 ticks at 1, 40 at 2)', async () => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot(TOP + 1, 30);
    const result = await digDescend({ ...deps(fake), timeScale: 2 });
    expect(result.stopped).not.toBe(NOT_LANDED_TEXT);
    const slow = fakeBot(TOP + 1, 30);
    expect(await digDescend(deps(slow))).toEqual({
      dug: 1,
      walkable: false,
      stopped: NOT_LANDED_TEXT,
    });
  });

  it('a stop during the fall ends the call as stopped, not as not-landed', async () => {
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot(TOP + 1, Number.POSITIVE_INFINITY);
    const controller = new AbortController();
    const digAndStop = async (block: unknown, at: Vec3) => {
      const dug = await fake.digOne(block, at);
      controller.abort();
      return dug;
    };
    const result = await digDescend({
      ...deps(fake),
      signal: controller.signal,
      digOne: digAndStop,
    });
    expect(result).toEqual({ dug: 1, walkable: false, stopped: 'the call was stopped' });
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

  it('stops with the did-not-fall fact when a dig does not drop the Body', async () => {
    const log = vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
    const fake = fakeBot();
    const digInPlace = async (_block: unknown, at: Vec3): Promise<boolean> => {
      fake.digs.push(at.y);
      fake.cells.set(keyOf(at), 'air');
      return true;
    };
    const result = await digDescend({ ...deps(fake), digOne: digInPlace });
    expect(result).toEqual({ dug: 1, walkable: false, stopped: 'the Body did not fall' });
    expect(fake.digs).toEqual([TOP]);
    expect(logged(log)).toEqual([]);
  });

  it.each(['passive', 'player'])(
    'does not refuse for a non-hostile %s entity within 8 blocks',
    async (type) => {
      vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation(() => {});
      const fake = fakeBot();
      fake.entities.other = { type, position: new Vec3(3, 71, 0) };
      const result = await digDescend(deps(fake));
      expect(fake.digs[0]).toBe(TOP);
      expect(result.stopped).not.toBe(REFUSAL_TEXT.hostile);
    },
  );

  it('stops at once when the call is already aborted', async () => {
    const fake = fakeBot();
    const controller = new AbortController();
    controller.abort();
    const result = await digDescend({ ...deps(fake), signal: controller.signal });
    expect(result).toEqual({ dug: 0, walkable: false, stopped: 'the call was stopped' });
    expect(fake.digs).toEqual([]);
  });
});
