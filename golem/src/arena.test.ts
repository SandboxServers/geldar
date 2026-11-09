import { describe, expect, it } from 'vitest';
import { arenaFor, buildArena } from './arena.ts';
import { TestControl } from './test-control.ts';

/** A fake control whose fill answers "not loaded" for the first `notLoaded` fill commands. */
function fakeArenaControl(notLoaded: number) {
  let fills = 0;
  const sent: string[] = [];
  const control = new TestControl({
    command: async (cmd: string) => {
      sent.push(cmd);
      if (!cmd.startsWith('fill ')) return 'ok';
      fills += 1;
      return fills <= notLoaded
        ? 'Cannot fill: position not loaded'
        : 'Successfully filled 961 blocks';
    },
  });
  return { control, sent };
}

describe('arenaFor', () => {
  it('centers slot 2 at x 928, y 200, z 800', () => {
    expect(arenaFor(2).center).toEqual({ x: 928, y: 200, z: 800 });
  });

  it('spans the 31 by 31 platform from stone_bricks at y 199 to air at y 220', () => {
    const arena = arenaFor(0);
    expect(arena.min).toEqual({ x: 785, y: 199, z: 785 });
    expect(arena.max).toEqual({ x: 815, y: 220, z: 815 });
  });

  it('allows slot 10 and rejects slot 11, whose arena is past the 1,500 border', () => {
    expect(arenaFor(10).max.x).toBe(1455);
    expect(() => arenaFor(11)).toThrow(RangeError);
  });

  it('rejects a negative slot', () => {
    expect(() => arenaFor(-1)).toThrow(RangeError);
  });
});

describe('buildArena', () => {
  it('retries while fills report "not loaded", then resolves', async () => {
    const { control, sent } = fakeArenaControl(2);
    const arena = await buildArena(control, 2);
    expect(arena.center).toEqual({ x: 928, y: 200, z: 800 });
    // One forceload, then the two fills on each try: the first two fills are "not loaded",
    // so the second try (fills three and four) succeeds.
    expect(sent.filter((cmd) => cmd.startsWith('forceload add'))).toHaveLength(1);
    expect(sent.filter((cmd) => cmd.startsWith('fill '))).toHaveLength(4);
  }, 15_000);

  it('rejects after 20 tries when the chunks never load', async () => {
    const { control, sent } = fakeArenaControl(Number.POSITIVE_INFINITY);
    await expect(buildArena(control, 0)).rejects.toThrow('did not build');
    expect(sent.filter((cmd) => cmd.startsWith('fill '))).toHaveLength(40);
  }, 15_000);
});
