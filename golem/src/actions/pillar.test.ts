import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { block, type FakeBlock, type Scene, scriptedBot } from './escape-ladder.fakes.ts';
import { moveNear } from './pathing.ts';
import { placeAction } from './place.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

interface PillarFakeOptions {
  /** Cells that hold something, by `x,y,z`. */
  blocks: Record<string, FakeBlock>;
  /** Whether the bot starts on the ground (it starts at (0.5, 64, 0.5) unless moved). */
  onGround?: boolean;
  /** The tick on which the bot lands, if it lands at all. */
  landTick?: number;
  /** The cell the placed dirt goes into; defaults to the cell the bot's feet were in. */
  placedAt?: string;
}

/**
 * A bot on the escape-ladder jump curve: a jump raises its feet a block, and placing puts the dirt
 * in `placedAt`. Its landing is scripted by `landTick`.
 */
function pillarFake(options: PillarFakeOptions) {
  const curve = [0.42, 0.753, 1.0, 1.166, 1.249];
  let airTicks = 0;
  const scene: Scene = {
    items: ['dirt'],
    blocks: options.blocks,
    physics: (s) => {
      if (s.ticks === options.landTick) Object.assign(s.entity, { onGround: true });
      if (!s.held || !s.controls.jump || fake.bot.placeBlock.mock.calls.length > 0) return;
      s.position.y = 64 + (curve[Math.min(airTicks, curve.length - 1)] ?? 1.249);
      airTicks++;
    },
  };
  const fake = scriptedBot(scene);
  Object.assign(fake.bot.entity, { onGround: options.onGround ?? true });
  const placedAt = options.placedAt ?? '0,64,0';
  fake.bot.placeBlock.mockImplementation(async () => {
    scene.blocks = { ...scene.blocks, [placedAt]: block('dirt') };
  });
  return fake;
}

type Fake = ReturnType<typeof pillarFake>;

/** Runs `place dirt` with a fresh signal; `at` defaults to the feet. */
const pillar = (
  fake: Fake,
  at: { x: number; y: number; z: number } | 'feet' = 'feet',
  timeScale = 1,
  signal = new AbortController().signal,
) => placeAction.run({ bot: fake.asBot, signal, timeScale }, { do: 'place', block: 'dirt', at });

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
});

describe('place at an explicit position equal to the feet cell (decision 0160)', () => {
  it('pillars from a named own-cell position, as it does from feet', async () => {
    const fake = pillarFake({ blocks: { '0,63,0': block('stone') } });
    const outcome = await pillar(fake, { x: 0, y: 64, z: 0 });
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    const [reference, face] = fake.bot.placeBlock.mock.calls[0] as unknown as [unknown, Vec3];
    expect(reference).toEqual(block('stone'));
    expect(face).toEqual(new Vec3(0, 1, 0));
    expect(fake.state.position.y - 64).toBeGreaterThanOrEqual(0.9);
  });
});

describe('pillar from a block edge and after landing', () => {
  it('steps onto the solid cell beside the feet, then pillars there', async () => {
    // The bot stands on the edge of the stone at (1,63,0): its hitbox overhangs the air at (0,63,0).
    const fake = pillarFake({ blocks: { '1,63,0': block('stone') }, placedAt: '1,64,0' });
    fake.state.position.set(0.8, 64, 0.5);
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      fake.state.position.set(1.5, 64, 0.5);
      return { ok: true, distance: 0.5 } as never;
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed', detail: { at: { x: 1, y: 64, z: 0 } } });
    expect(moveNear).toHaveBeenCalledWith(
      fake.bot,
      expect.objectContaining({ x: 1.5, z: 0.5 }),
      0.5,
      expect.anything(),
    );
    const [reference, face] = fake.bot.placeBlock.mock.calls[0] as unknown as [unknown, Vec3];
    expect(reference).toEqual(block('stone'));
    expect(face).toEqual(new Vec3(0, 1, 0));
    expect(fake.state.position.y - 64).toBeGreaterThanOrEqual(0.9);
  });

  it('refuses with the no-ground message when the step does not reach the edge cell', async () => {
    const fake = pillarFake({ blocks: { '1,63,0': block('stone') } });
    fake.state.position.set(0.8, 64, 0.5);
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'no solid block under your feet to build on',
    });
    expect(moveNear).toHaveBeenCalledTimes(1);
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('refuses with the no-ground message when no edge cell has two free cells above it', async () => {
    // The stone at (1,63,0) has a stone above it at (1,65,0): the cell at (1,64,0) has no headroom.
    const fake = pillarFake({ blocks: { '1,63,0': block('stone'), '1,65,0': block('stone') } });
    fake.state.position.set(0.8, 64, 0.5);
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'no solid block under your feet to build on',
    });
    expect(moveNear).not.toHaveBeenCalled();
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('pillars once the bot lands within 1 s', async () => {
    const fake = pillarFake({
      blocks: { '0,63,0': block('stone') },
      onGround: false,
      landTick: 3,
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
  });

  it('refuses with the not-on-the-ground message when still airborne after 1 s', async () => {
    const fake = pillarFake({ blocks: { '0,63,0': block('stone') }, onGround: false });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'you are not on the ground',
    });
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('is cancelled, and places nothing, when the signal aborts while waiting to land', async () => {
    const fake = pillarFake({ blocks: { '0,63,0': block('stone') }, onGround: false });
    const abort = new AbortController();
    fake.bot.waitForTicks.mockImplementationOnce(async () => {
      abort.abort();
    });
    const outcome = await pillar(fake, 'feet', 1, abort.signal);
    expect(outcome.status).toBe('cancelled');
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });
});

describe('pillar when another ranger shares the feet cell', () => {
  const ENTITY_MESSAGE = 'another entity stands where the block goes';

  /** The bot stands on the stone at (0,63,0); another ranger's box covers the feet cell (0,64,0). */
  function sharedCell(fake: Fake) {
    Object.assign(fake.bot.entities, {
      '1': { position: new Vec3(0.3, 64, 0.3), width: 0.6, height: 1.8 },
    });
  }

  it('steps to a free neighbour with solid ground, and pillars there', async () => {
    const fake = pillarFake({
      blocks: { '0,63,0': block('stone'), '1,63,0': block('stone') },
      placedAt: '1,64,0',
    });
    sharedCell(fake);
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      fake.state.position.set(1.5, 64, 0.5);
      return { ok: true, distance: 1 } as never;
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed', detail: { at: { x: 1, y: 64, z: 0 } } });
    expect(moveNear).toHaveBeenCalledTimes(1);
    expect(moveNear).toHaveBeenCalledWith(
      fake.bot,
      expect.objectContaining({ x: 1.5, z: 0.5 }),
      0.5,
      expect.anything(),
    );
    expect(fake.bot.placeBlock).toHaveBeenCalledTimes(1);
    expect(fake.state.position.y - 64).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps the another-entity refusal when the only free neighbour is also taken by a ranger', async () => {
    const fake = pillarFake({ blocks: { '0,63,0': block('stone'), '1,63,0': block('stone') } });
    sharedCell(fake);
    Object.assign(fake.bot.entities, {
      '2': { position: new Vec3(1.5, 64, 0.5), width: 0.6, height: 1.8 },
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked', message: ENTITY_MESSAGE });
    expect(moveNear).not.toHaveBeenCalled();
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('keeps the another-entity refusal when the step to the neighbour does not arrive', async () => {
    const fake = pillarFake({ blocks: { '0,63,0': block('stone'), '1,63,0': block('stone') } });
    sharedCell(fake);
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked', message: ENTITY_MESSAGE });
    expect(moveNear).toHaveBeenCalledTimes(1);
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });

  it('is cancelled, and places nothing, when the signal aborts during the step', async () => {
    const fake = pillarFake({ blocks: { '0,63,0': block('stone'), '1,63,0': block('stone') } });
    sharedCell(fake);
    const abort = new AbortController();
    vi.mocked(moveNear).mockImplementationOnce(async () => {
      abort.abort();
      return { ok: false, distance: 1 } as never;
    });
    const outcome = await pillar(fake, 'feet', 1, abort.signal);
    expect(outcome.status).toBe('cancelled');
    expect(fake.bot.placeBlock).not.toHaveBeenCalled();
  });
});
