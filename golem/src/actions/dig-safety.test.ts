import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { Block } from './bot-types.ts';
import { digSafetyRefusal, FALLING_BLOCKS, isFalling } from './dig-safety.ts';

/** Named cells of a fake world: "x,y,z" to a block name. Absent cells read as null (unloaded). */
type Cells = Record<string, string>;
type Props = Record<string, Record<string, unknown>>;

const key = (v: Vec3): string => `${v.x},${v.y},${v.z}`;

function fakeBot(cells: Cells, props: Props = {}): Bot {
  const blockAt = (v: Vec3) => {
    const name = cells[key(v)];
    if (name === undefined) return null;
    const p = props[key(v)];
    return {
      name,
      boundingBox: name === 'air' ? 'empty' : 'block',
      getProperties: p ? () => p : undefined,
    };
  };
  return { blockAt } as unknown as Bot;
}

const target = (name: string): Block => ({ name, boundingBox: 'block' }) as unknown as Block;
const AT = new Vec3(0, 64, 0);

/** A solid stone world around the target, with the Body's feet at (1,64,0) and head above. */
function pitWorld(targetName: string): Cells {
  const cells: Cells = { '0,64,0': targetName, '0,65,0': 'stone' };
  for (const [x, y, z] of [
    [2, 64, 0],
    [1, 64, 1],
    [1, 64, -1],
    [2, 65, 0],
    [1, 65, 1],
    [1, 65, -1],
    [1, 66, 0],
  ] as const) {
    cells[`${x},${y},${z}`] = 'stone';
  }
  return cells;
}

describe('digSafetyRefusal: falling blocks above the cell', () => {
  it('refuses a stack of two falling blocks when the Body is beside the column', () => {
    const bot = fakeBot({ '0,64,0': 'stone', '0,65,0': 'gravel', '0,66,0': 'gravel' });
    const why = digSafetyRefusal({
      bot,
      block: target('stone'),
      at: AT,
      own: [new Vec3(1, 64, 0), new Vec3(1, 65, 0)],
    });
    expect(why).toBe('stone is unsafe to dig: gravel above it would fall on you');
  });

  it('refuses a single falling block for a Body beside the column, on every side', () => {
    for (const [x, z] of [
      [-1, 0],
      [1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const bot = fakeBot({ '0,64,0': 'stone', '0,65,0': 'sand' });
      const own = [new Vec3(x, 64, z), new Vec3(x, 65, z)];
      expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own })).not.toBeNull();
    }
  });

  it('bounds a Body by the top of the whole stack, not only the first block', () => {
    // Two gravel blocks reach y 66, so the Body's head may be as high as y 68 (66 + 2).
    const bot = fakeBot({ '0,64,0': 'stone', '0,65,0': 'gravel', '0,66,0': 'gravel' });
    const own = [new Vec3(1, 67, 0), new Vec3(1, 68, 0)];
    expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own })).not.toBeNull();
    const higher = [new Vec3(1, 68, 0), new Vec3(1, 69, 0)];
    expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own: higher })).toBeNull();
  });

  it('allows the same stack when the Body is far from the column', () => {
    const bot = fakeBot({ '0,64,0': 'stone', '0,65,0': 'gravel', '0,66,0': 'gravel' });
    const own = [new Vec3(5, 64, 0), new Vec3(5, 65, 0)];
    expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own })).toBeNull();
  });

  it('bounds the Body height at the top of the stack, inclusive', () => {
    // One falling block at y 65: the Body's cells count up to y 67 (65 + 2), not 68.
    const bot = fakeBot({ '0,64,0': 'stone', '0,65,0': 'gravel' });
    const inside = [new Vec3(1, 66, 0), new Vec3(1, 67, 0)];
    const outside = [new Vec3(1, 68, 0), new Vec3(1, 69, 0)];
    expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own: inside })).not.toBeNull();
    expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own: outside })).toBeNull();
  });

  it('allows a stone stack, which does not fall', () => {
    const bot = fakeBot({ '0,64,0': 'stone', '0,65,0': 'stone' });
    const own = [new Vec3(1, 64, 0), new Vec3(1, 65, 0)];
    expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own })).toBeNull();
  });

  it('refuses a hanging pointed dripstone above, and not one standing up', () => {
    const own = [new Vec3(1, 64, 0), new Vec3(1, 65, 0)];
    const hanging = fakeBot(
      { '0,64,0': 'stone', '0,65,0': 'pointed_dripstone' },
      { '0,65,0': { vertical_direction: 'down' } },
    );
    const standing = fakeBot(
      { '0,64,0': 'stone', '0,65,0': 'pointed_dripstone' },
      { '0,65,0': { vertical_direction: 'up' } },
    );
    expect(digSafetyRefusal({ bot: hanging, block: target('stone'), at: AT, own })).not.toBeNull();
    expect(digSafetyRefusal({ bot: standing, block: target('stone'), at: AT, own })).toBeNull();
  });
});

describe('digSafetyRefusal: a falling target in a pit', () => {
  it('refuses a falling target when the Body is walled in at feet and head', () => {
    const bot = fakeBot(pitWorld('gravel'));
    const own = [new Vec3(1, 64, 0), new Vec3(1, 65, 0)];
    expect(digSafetyRefusal({ bot, block: target('gravel'), at: AT, own })).toBe(
      'gravel falls when dug, and you have no open cell beside you',
    );
  });

  it('allows it when any one side is open, at feet or head', () => {
    for (const open of ['2,64,0', '1,64,1', '1,64,-1', '2,65,0', '1,65,1', '1,65,-1']) {
      const cells = pitWorld('gravel');
      cells[open] = 'air';
      const bot = fakeBot(cells);
      const own = [new Vec3(1, 64, 0), new Vec3(1, 65, 0)];
      expect(digSafetyRefusal({ bot, block: target('gravel'), at: AT, own }), open).toBeNull();
    }
  });

  it('allows a stone target in the same pit', () => {
    const bot = fakeBot(pitWorld('stone'));
    const own = [new Vec3(1, 64, 0), new Vec3(1, 65, 0)];
    expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own })).toBeNull();
  });
});

describe('digSafetyRefusal: liquids and the shared list', () => {
  it('refuses a dig with water on a face of the cell', () => {
    const bot = fakeBot({ '0,64,0': 'stone', '0,64,1': 'water' });
    const own = [new Vec3(5, 64, 5), new Vec3(5, 65, 5)];
    expect(digSafetyRefusal({ bot, block: target('stone'), at: AT, own })).toBe(
      'stone is unsafe to dig: water would flow in on you',
    );
  });

  it('lists every falling name, concrete powder included, and no stalagmite', () => {
    for (const name of [...FALLING_BLOCKS, 'black_concrete_powder'])
      expect(isFalling(name)).toBe(true);
    expect(FALLING_BLOCKS.size).toBe(9);
    for (const name of ['stone', 'pointed_dripstone', 'concrete', undefined]) {
      expect(isFalling(name)).toBe(false);
    }
  });
});
