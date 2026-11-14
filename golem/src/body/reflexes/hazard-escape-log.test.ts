import { describe, expect, it } from 'vitest';
import type { DiagSink } from '../../actions/stall-diag.ts';
import { basicContext, basicView, floor, gridBot } from './basic.fakes.ts';
import { createHazardEscapeReflex, type EscapeMover } from './hazard-escape.ts';

/** A lava pool at the origin, the Body standing in it at y 64, ground all round. */
function lavaGrid(headLiquid: string | null = null): Record<string, string> {
  const grid = floor({}, 63, -10, 10);
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      grid[`${x},63,${z}`] = 'lava';
      grid[`${x},64,${z}`] = 'lava';
    }
  }
  if (headLiquid !== null) grid['0,65,0'] = headLiquid;
  return grid;
}

/** A diagnostic sink that keeps each line it is given, in order. */
function capture(): { diag: DiagSink; lines: () => Array<Record<string, unknown>> } {
  const raw: string[] = [];
  return {
    diag: {
      log: (line) => {
        raw.push(line);
      },
      now: () => 0,
    },
    lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('hazard_escape: the oxygen trace (one line at start, one at end)', () => {
  it('the start and end lines carry the exact x, y, z and the dimension', async () => {
    const { view, state } = basicView({
      inFluid: 'lava',
      position: { x: 0, y: 64, z: 0 },
      air: 12,
    });
    Object.defineProperties(view, {
      exactPosition: { value: { x: 0.5, y: 64.2, z: -2.7 }, configurable: true },
      dimension: { value: 'minecraft:the_nether', configurable: true },
    });
    const { ctx } = basicContext(view, gridBot(lavaGrid()).bot);
    const { diag, lines } = capture();
    const mover: EscapeMover = async () => {
      state.position = { x: 2, y: 64, z: 0 };
      state.inFluid = null;
      state.air = 15;
    };
    await createHazardEscapeReflex({ mover, diag }).run({ hazard: 'lava' }, ctx);
    const [start, end] = lines();
    for (const line of [start, end]) {
      expect(line).toMatchObject({ x: 0.5, y: 64.2, z: -2.7, dimension: 'minecraft:the_nether' });
    }
  });

  it('a Body in water with water over its head: in_water and head_liquid are both true', async () => {
    const grid = floor({}, 63, -10, 10);
    grid['0,64,0'] = 'water';
    grid['0,65,0'] = 'water';
    const { view, state } = basicView({
      inFluid: 'water',
      position: { x: 0, y: 64, z: 0 },
      air: 5,
    });
    const { ctx } = basicContext(view, gridBot(grid).bot);
    const { diag, lines } = capture();
    const swim: EscapeMover = async () => {
      state.inFluid = null;
      state.air = 15;
    };
    const outcome = await createHazardEscapeReflex({ mover: swim, swimmer: swim, diag }).run(
      { hazard: 'drowning', air: 5 },
      ctx,
    );
    expect(outcome).toEqual({ result: 'handled', detail: 'left drowning' });
    expect(lines()[0]).toMatchObject({ in_water: true, head_liquid: true, air_before: 5 });
  });

  it('a diag sink that throws does not stop the escape, and the outcome is the escape own', async () => {
    const { view, state } = basicView({
      inFluid: 'lava',
      position: { x: 0, y: 64, z: 0 },
      air: 12,
    });
    const { ctx } = basicContext(view, gridBot(lavaGrid()).bot);
    const diag: DiagSink = {
      log: () => {
        throw new Error('sink down');
      },
      now: () => 0,
    };
    const mover: EscapeMover = async () => {
      state.position = { x: 2, y: 64, z: 0 };
      state.inFluid = null;
      state.air = 15;
    };
    const outcome = await createHazardEscapeReflex({ mover, diag }).run({ hazard: 'lava' }, ctx);
    expect(outcome).toEqual({ result: 'handled', detail: 'left lava' });
  });

  it('the start line has the air before, the end line the air before and after', async () => {
    const grid = lavaGrid();
    const { view, state } = basicView({
      inFluid: 'lava',
      position: { x: 0, y: 64, z: 0 },
      air: 12,
    });
    const { ctx } = basicContext(view, gridBot(grid).bot);
    const { diag, lines } = capture();
    const mover: EscapeMover = async () => {
      state.position = { x: 2, y: 64, z: 0 };
      state.inFluid = null;
      state.air = 15;
    };
    const outcome = await createHazardEscapeReflex({ mover, diag }).run({ hazard: 'lava' }, ctx);
    expect(outcome).toEqual({ result: 'handled', detail: 'left lava' });
    const [start, end] = lines();
    expect(lines()).toHaveLength(2);
    expect(start).toMatchObject({
      event: 'hazard_escape',
      phase: 'start',
      hazard: 'lava',
      air_before: 12,
      in_water: false,
    });
    expect(end).toMatchObject({
      event: 'hazard_escape',
      phase: 'end',
      hazard: 'lava',
      result: 'handled',
      detail: 'left lava',
      air_before: 12,
      air_after: 15,
    });
  });

  it('says the head is in liquid when the cell above the feet is lava, and not when it is air', async () => {
    const { view } = basicView({ inFluid: 'lava', position: { x: 0, y: 64, z: 0 } });
    const headIn = capture();
    await createHazardEscapeReflex({ mover: async () => undefined, diag: headIn.diag }).run(
      { hazard: 'lava' },
      basicContext(view, gridBot(lavaGrid('lava')).bot).ctx,
    );
    expect(headIn.lines()[0]).toMatchObject({ phase: 'start', head_liquid: true });

    const headAir = capture();
    await createHazardEscapeReflex({ mover: async () => undefined, diag: headAir.diag }).run(
      { hazard: 'lava' },
      basicContext(view, gridBot(lavaGrid()).bot).ctx,
    );
    expect(headAir.lines()[0]).toMatchObject({ phase: 'start', head_liquid: false });
  });

  it('a run that gives up writes its end line with result abandoned, and nothing between', async () => {
    const { view } = basicView({ inFluid: 'lava', position: { x: 0, y: 64, z: 0 }, air: 20 });
    const { ctx } = basicContext(view, gridBot(lavaGrid()).bot);
    const { diag, lines } = capture();
    // The mover returns without moving the Body out: the run gives up after its walk.
    const outcome = await createHazardEscapeReflex({ mover: async () => undefined, diag }).run(
      { hazard: 'lava' },
      ctx,
    );
    expect(outcome.result).toBe('abandoned');
    expect(lines()).toHaveLength(2);
    expect(lines()[1]).toMatchObject({
      phase: 'end',
      result: 'abandoned',
      air_before: 20,
      air_after: 20,
    });
  });

  it('a run whose mover throws still writes its end line (result failed), and the throw goes on', async () => {
    const { view } = basicView({ inFluid: 'lava', position: { x: 0, y: 64, z: 0 }, air: 9 });
    const { ctx } = basicContext(view, gridBot(lavaGrid()).bot);
    const { diag, lines } = capture();
    const mover: EscapeMover = async () => {
      throw new Error('mover broke');
    };
    await expect(
      createHazardEscapeReflex({ mover, diag }).run({ hazard: 'lava' }, ctx),
    ).rejects.toThrow('mover broke');
    expect(lines()).toHaveLength(2);
    expect(lines()[1]).toMatchObject({ phase: 'end', result: 'failed', air_before: 9 });
  });
});
