import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { defaultBlock, type RealBlock } from './door-blocks.fakes.ts';
import { feetCell } from './feet-cell.ts';
import type { ActionContext } from './registry.ts';

type Bot = ActionContext['bot'];

/** A bot at `position` over a world of real blocks, keyed by `x,y,z`; every other cell is air. */
function botOver(position: Vec3, cells: Record<string, RealBlock>): Bot {
  const air = defaultBlock('air');
  return {
    entity: { position },
    blockAt: (at: Vec3) => cells[`${at.x},${at.y},${at.z}`] ?? air,
  } as unknown as Bot;
}

describe('feetCell', () => {
  it('is the cell above a dirt path the bot stands on (15/16 high)', () => {
    const bot = botOver(new Vec3(0.5, 62.9375, 0.5), { '0,62,0': defaultBlock('dirt_path') });
    expect(feetCell(bot)).toEqual(new Vec3(0, 63, 0));
  });

  it('is the cell above soul sand (7/8 high) and above a farmland block (15/16)', () => {
    const soul = botOver(new Vec3(0.5, 62.875, 0.5), { '0,62,0': defaultBlock('soul_sand') });
    expect(feetCell(soul)).toEqual(new Vec3(0, 63, 0));
    const farm = botOver(new Vec3(0.5, 62.9375, 0.5), { '0,62,0': defaultBlock('farmland') });
    expect(feetCell(farm)).toEqual(new Vec3(0, 63, 0));
  });

  it('stays in the partial block when the position is below its top', () => {
    const bot = botOver(new Vec3(0.5, 62.5, 0.5), { '0,62,0': defaultBlock('dirt_path') });
    expect(feetCell(bot)).toEqual(new Vec3(0, 62, 0));
  });

  it('is the cell of a full block position, unchanged on a whole block', () => {
    const onStone = botOver(new Vec3(0.5, 63, 0.5), { '0,62,0': defaultBlock('stone') });
    expect(feetCell(onStone)).toEqual(new Vec3(0, 63, 0));
    const inStone = botOver(new Vec3(0.5, 62.5, 0.5), { '0,62,0': defaultBlock('stone') });
    expect(feetCell(inStone)).toEqual(new Vec3(0, 62, 0));
  });

  it('is floor(position) over air', () => {
    expect(feetCell(botOver(new Vec3(0.5, 64.2, 0.5), {}))).toEqual(new Vec3(0, 64, 0));
  });
});
