import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { fakeBot, manualTicks } from './body.fakes.ts';
import { MemorySink } from './records.ts';
import { BodyRuntime } from './runtime.ts';
import { canStepOff, createBodyView } from './view.ts';

type BlockRead = Parameters<typeof canStepOff>[0];
type Block = NonNullable<ReturnType<BlockRead>>;

const FEET = new Vec3(0, 35, 0);

/**
 * Zack's ledge (decision 0196) in local cells: the Body stands at (0, 35, 0) on a stone floor, stone
 * walls on the W and S sides, and open air on the N and E sides. The N and E floors top at
 * `34 - drop`, so `drop` 1 is a one block step down. Cells outside the modelled box are unknown.
 */
function ledgeWorld(dropN: number, dropE: number): BlockRead {
  const solid = new Set<string>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  solid.add(key(0, 34, 0));
  solid.add(key(-1, 34, 0));
  solid.add(key(0, 34, 1));
  for (const y of [35, 36]) {
    solid.add(key(-1, y, 0));
    solid.add(key(0, y, 1));
  }
  solid.add(key(0, 34 - dropN, -1));
  solid.add(key(1, 34 - dropE, 0));
  return (at: Vec3): Block | null => {
    const inside = Math.abs(at.x) <= 3 && Math.abs(at.z) <= 3 && at.y >= 25 && at.y <= 40;
    if (!inside) return null;
    return { boundingBox: solid.has(key(at.x, at.y, at.z)) ? 'block' : 'empty' } as Block;
  };
}

describe('canStepOff reads a ledge (decision 0196)', () => {
  it('is false when the N and E sides drop two or more blocks', () => {
    expect(canStepOff(ledgeWorld(2, 2), FEET)).toBe(false);
    expect(canStepOff(ledgeWorld(3, 4), FEET)).toBe(false);
    expect(canStepOff(ledgeWorld(8, 8), FEET)).toBe(false);
  });

  it('is true when either side is a one block step down', () => {
    expect(canStepOff(ledgeWorld(1, 2), FEET)).toBe(true);
    expect(canStepOff(ledgeWorld(2, 1), FEET)).toBe(true);
  });

  it('is true when a neighbour cell is not loaded (an unknown read is not a ledge)', () => {
    const world = ledgeWorld(2, 2);
    const unloaded: BlockRead = (at) => (at.x === 1 ? null : world(at));
    expect(canStepOff(unloaded, FEET)).toBe(true);
  });
});

describe('createBodyView reads the bed, the ride and the action from the bot', () => {
  it('reads asleep and riding from the bot, and actionRunning from the probe', () => {
    const bot = fakeBot();
    const view = createBodyView(bot);
    expect(view.asleep).toBe(false);
    expect(view.riding).toBe(false);
    (bot as unknown as { isSleeping: boolean }).isSleeping = true;
    expect(view.asleep).toBe(true);
    (bot as unknown as { vehicle: unknown }).vehicle = {};
    expect(view.riding).toBe(true);
    view.bindActionProbe(() => true);
    expect(view.actionRunning).toBe(true);
    view.dispose();
  });
});

describe('BodyRuntime wires its action state into the view it builds', () => {
  it('reads actionRunning from the runtime, not as unknown', () => {
    const runtime = new BodyRuntime({
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      bot: fakeBot(),
      ticks: manualTicks().source,
      sink: new MemorySink(),
      reflexes: [],
    });
    expect(runtime.view.actionRunning).toBe(false);
  });
});
