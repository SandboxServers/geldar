import { describe, expect, it } from 'vitest';
import type { DiagSink } from '../../actions/stall-diag.ts';
import { basicContext, basicView, floor, gridBot } from './basic.fakes.ts';
import { createHazardEscapeReflex, type EscapeMover } from './hazard-escape.ts';

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

/** Water at the Body's feet and head (y 64, 65) with a named stack over the head and under the feet. */
function waterStack(): Record<string, string> {
  const grid = floor({}, 60, -10, 10);
  grid['0,62,0'] = 'gravel';
  grid['0,63,0'] = 'dirt';
  grid['0,64,0'] = 'water';
  grid['0,65,0'] = 'water';
  grid['0,66,0'] = 'stone';
  grid['0,67,0'] = 'oak_planks';
  grid['0,68,0'] = 'cobblestone';
  // A solid floor under the cell to the east, so it is a safe air exit one step away (not a void).
  grid['1,63,0'] = 'stone';
  return grid;
}

describe('hazard_escape: operator lines for the mover and the surroundings', () => {
  it('the start line names the mover, the three blocks over the head and the two under the feet', async () => {
    const { view, state } = basicView({
      inFluid: 'water',
      position: { x: 0, y: 64, z: 0 },
      air: 5,
    });
    const { ctx } = basicContext(view, gridBot(waterStack()).bot);
    const { diag, lines } = capture();
    const swim: EscapeMover = async () => {
      state.inFluid = null;
      state.air = 15;
    };
    await createHazardEscapeReflex({ mover: swim, swimmer: swim, diag }).run(
      { hazard: 'drowning', air: 5 },
      ctx,
    );
    const [start] = lines();
    expect(start).toMatchObject({
      event: 'hazard_escape',
      phase: 'start',
      mover: 'swim_up',
      threshold: 12,
      above_head: ['stone', 'oak_planks', 'cobblestone'],
      below_feet: ['dirt', 'gravel'],
      nearest_air: { direction: 'east', distance: 1 },
    });
  });

  it('a walk out of lava names walk_out as its mover', async () => {
    const grid = floor({}, 63, -10, 10);
    grid['0,64,0'] = 'lava';
    const { view, state } = basicView({
      inFluid: 'lava',
      position: { x: 0, y: 64, z: 0 },
      air: 20,
    });
    const { ctx } = basicContext(view, gridBot(grid).bot);
    const { diag, lines } = capture();
    const mover: EscapeMover = async () => {
      state.inFluid = null;
    };
    await createHazardEscapeReflex({ mover, diag }).run({ hazard: 'lava' }, ctx);
    expect(lines()[0]).toMatchObject({ phase: 'start', mover: 'walk_out' });
  });

  it('a lateral fallback writes one operator line with its direction and height gained', async () => {
    const { view, state } = basicView({
      inFluid: 'water',
      position: { x: 0, y: 64, z: 0 },
      air: 5,
    });
    const { ctx } = basicContext(view, gridBot(waterStack()).bot);
    const { diag, lines } = capture();
    const swimmer: EscapeMover = async (walk) => {
      walk.note?.({ direction: 'east', distance: 6, dy_gained: 0 });
      state.inFluid = null;
      state.air = 15;
    };
    const noop: EscapeMover = async () => undefined;
    await createHazardEscapeReflex({ mover: noop, swimmer, diag }).run(
      { hazard: 'drowning', air: 5 },
      ctx,
    );
    const lateral = lines().filter((line) => line.phase === 'lateral');
    expect(lateral).toHaveLength(1);
    expect(lateral[0]).toMatchObject({
      event: 'hazard_escape',
      direction: 'east',
      distance: 6,
      dy_gained: 0,
    });
  });
});
