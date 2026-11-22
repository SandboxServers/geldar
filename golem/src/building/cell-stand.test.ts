import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { cancelled, completed, failed } from '../actions/outcome.ts';
import type { ActionContext } from '../actions/registry.ts';
import type { CellEnv, CellHandlers, PlanCell } from './cell-do.ts';
import { doCellAt, type StandPort } from './cell-stand.ts';
import type { HeldBlock } from './scaffold.ts';
import type { Cell } from './stand.ts';

/**
 * A flat yard: solid floor at y 63, air above, and whatever the test sets. The place, break and goto
 * handlers change it the way the game would, and every call is logged as one line.
 */
class Yard {
  readonly blocks = new Map<string, string>();
  readonly log: string[] = [];
  feet: Cell = { x: 0, y: 64, z: 0 };

  readonly items: HeldBlock[];

  constructor(items: HeldBlock[]) {
    this.items = items;
    for (let x = -2; x <= 16; x++) {
      for (let z = -6; z <= 6; z++) this.set({ x, y: 63, z }, 'stone');
    }
  }

  set(at: Cell, name: string): void {
    this.blocks.set(`${at.x},${at.y},${at.z}`, name);
  }

  nameAt(at: Cell): string {
    return this.blocks.get(`${at.x},${at.y},${at.z}`) ?? 'air';
  }

  port(): StandPort {
    return {
      feet: () => this.feet,
      world: (x, y, z) => {
        const name = this.nameAt({ x, y, z });
        return { name, boundingBox: name === 'air' ? 'empty' : 'block' };
      },
    };
  }

  env(): CellEnv {
    return {
      blockAt: (at) => this.nameAt(at),
      propsAt: () => ({}),
      held: () => this.items,
      heldNames: () => ['diamond_pickaxe'],
    };
  }

  handlers(stand: StandPort | undefined, gotoOutcome = completed({})): CellHandlers {
    const yard = this;
    return {
      place: {
        kind: 'place',
        timeoutMs: 0,
        async run(_ctx, action) {
          const at = action.at as Cell;
          yard.log.push(`place ${at.x},${at.y},${at.z} ${action.block}`);
          yard.set(at, action.block);
          return completed({});
        },
      },
      dig: {
        kind: 'break',
        timeoutMs: 0,
        async run(_ctx, action) {
          const at = action.at as Cell;
          yard.log.push(`break ${at.x},${at.y},${at.z}`);
          yard.set(at, 'air');
          return completed({});
        },
      },
      goto: {
        kind: 'goto',
        timeoutMs: 0,
        async run(_ctx, action) {
          const t = action.target as Cell;
          yard.log.push(`goto ${t.x},${t.y},${t.z}`);
          if (gotoOutcome.status !== 'completed') return gotoOutcome;
          yard.feet = { x: t.x, y: t.y, z: t.z };
          return gotoOutcome;
        },
      },
      ...(stand === undefined ? {} : { stand }),
    };
  }
}

const ctx = {
  bot: {} as unknown as Bot,
  signal: new AbortController().signal,
  timeScale: 1,
} as unknown as ActionContext;

const stone = (at: Cell): PlanCell => ({ at, prior: 'air', target: 'stone' });
const noPlan = (): boolean => false;
/** Membership over a plan array: the cells the plan works, as the lane answers them. */
const onPlanOf = (plan: PlanCell[]) => (c: Cell) =>
  plan.some((p) => p.at.x === c.x && p.at.y === c.y && p.at.z === c.z);

describe('doCellAt: the stand path', () => {
  it('walks to the stand the solver picks when the target is out of reach from the feet', async () => {
    const yard = new Yard([{ name: 'stone', count: 2 }]);
    const code = await doCellAt(
      ctx,
      stone({ x: 10, y: 64, z: 0 }),
      yard.env(),
      yard.handlers(yard.port()),
      noPlan,
    );
    // The stand solver's cell: the nearest cell within reach 4.5 of (10,64,0), with fewest moves from (0,64,0).
    expect(yard.log).toEqual(['goto 6,64,0', 'place 10,64,0 stone']);
    expect(code).toBe('placed');
  });

  it('skips a stand next to lava for the next safe one', async () => {
    const yard = new Yard([{ name: 'stone', count: 2 }]);
    yard.set({ x: 5, y: 64, z: 0 }, 'lava');
    const code = await doCellAt(
      ctx,
      stone({ x: 10, y: 64, z: 0 }),
      yard.env(),
      yard.handlers(yard.port()),
      noPlan,
    );
    // (6,64,0) touches the lava at (5,64,0); the solver's next best, (6,64,-1), is the walk target.
    expect(yard.log).toEqual(['goto 6,64,-1', 'place 10,64,0 stone']);
    expect(code).toBe('placed');
  });

  it('pillars up with held survival blocks when no stand exists, then removes the scaffold on the plan', async () => {
    const yard = new Yard([
      { name: 'dirt', count: 10 },
      { name: 'stone', count: 1 },
    ]);
    const plan = [stone({ x: 3, y: 70, z: 0 }), stone({ x: 0, y: 65, z: 0 })];
    const code = await doCellAt(
      ctx,
      plan[0] as PlanCell,
      yard.env(),
      yard.handlers(yard.port()),
      onPlanOf(plan),
    );
    expect(yard.log).toEqual([
      'place 0,64,0 dirt',
      'place 0,65,0 dirt',
      'place 0,66,0 dirt',
      'place 0,67,0 dirt',
      'place 0,68,0 dirt',
      'place 0,69,0 dirt',
      'place 3,70,0 stone',
      'break 0,65,0',
    ]);
    expect(code).toBe('placed');
  });

  it('places no scaffold without the block in hand', async () => {
    const yard = new Yard([
      { name: 'dirt', count: 2 },
      { name: 'stone', count: 1 },
    ]);
    const plan = [stone({ x: 3, y: 70, z: 0 })];
    const code = await doCellAt(
      ctx,
      plan[0] as PlanCell,
      yard.env(),
      yard.handlers(yard.port()),
      onPlanOf(plan),
    );
    expect(code).toBe('missing_materials');
    expect(yard.log).toEqual([]);
  });

  it('ends the cell as cancelled when the walk is cancelled, and places nothing', async () => {
    const yard = new Yard([{ name: 'stone', count: 2 }]);
    const code = await doCellAt(
      ctx,
      stone({ x: 10, y: 64, z: 0 }),
      yard.env(),
      yard.handlers(yard.port(), cancelled()),
      noPlan,
    );
    expect(code).toBe('cancelled');
    expect(yard.log).toEqual(['goto 6,64,0']);
  });

  it('ends the cell as out_of_reach when the walk fails', async () => {
    const yard = new Yard([{ name: 'stone', count: 2 }]);
    const code = await doCellAt(
      ctx,
      stone({ x: 10, y: 64, z: 0 }),
      yard.env(),
      yard.handlers(yard.port(), failed('blocked', 'no path')),
      noPlan,
    );
    expect(code).toBe('out_of_reach');
    expect(yard.log).toEqual(['goto 6,64,0']);
  });

  it('runs the cell as doCell alone with no stand port: no walk, no scaffold', async () => {
    const yard = new Yard([{ name: 'stone', count: 2 }]);
    const code = await doCellAt(
      ctx,
      stone({ x: 10, y: 64, z: 0 }),
      yard.env(),
      yard.handlers(undefined),
      noPlan,
    );
    expect(yard.log).toEqual(['place 10,64,0 stone']);
    expect(code).toBe('placed');
  });
});
