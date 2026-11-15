import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { basicContext } from './basic.fakes.ts';
import { AIR, capped, EAST, swimmerIn, worldOf } from './hazard-escape.lateral.fakes.ts';
import { createHazardEscapeReflex, DROWNING_START_AIR, type EscapeMover } from './hazard-escape.ts';

// Decision 0337 (BILLY, ag_billy_01): a capped 1-wide column under an open lake, the lateral exit 7 blocks
// east. The fixture is synthetic, not captured. Air is simulated: 20 bubbles at the start, one lost per 15
// ticks with the head under water (300 ticks of air, air.ts). The reflex loop runs for real: each tick it
// checks the view, and the first trigger runs the reflex with the real swimUp.
const START_AIR = 20;
const TICKS_PER_BUBBLE = 15;

/** The capped column, with shore air at x 8 so the Body's feet leave the water at the lake. */
function billyCells() {
  const cells = capped(EAST, 7, 'lake');
  for (let y = 58; y <= 63; y++) cells[`8,${y},0`] = AIR;
  return cells;
}

type Trigger = NonNullable<ReturnType<ReturnType<typeof createHazardEscapeReflex>['check']>>;

/**
 * Ticks the Body until the reflex fires, then runs the reflex. `drowningStartAir` is the test-only trigger
 * override; production passes nothing and fires at DROWNING_START_AIR.
 */
async function billyEscape(drowningStartAir?: number) {
  const world = worldOf(billyCells());
  const { bot, state, pos } = swimmerIn(world, new Vec3(0.5, 60.2, 0.5), 0);
  const b = bot as unknown as { waitForTicks: () => Promise<void> };
  const inner = b.waitForTicks;
  let submerged = 0;
  const cellAt = (dy: number): string => {
    const p = pos();
    return world(new Vec3(Math.floor(p.x), Math.floor(p.y) + dy, Math.floor(p.z))).name;
  };
  b.waitForTicks = async () => {
    await inner();
    if (cellAt(1) === 'water') submerged += 1;
  };
  const view = {
    get tick() {
      return state.ticks;
    },
    get position() {
      return pos();
    },
    get inFluid() {
      return cellAt(0) === 'water' ? 'water' : null;
    },
    get air() {
      return Math.max(0, START_AIR - Math.floor(submerged / TICKS_PER_BUBBLE));
    },
    onFire: false,
  };
  // The walk onto the shore is faked (the fake bot has no pathfinder): the step puts the feet on the x 8 air.
  const mover: EscapeMover = async () => {
    (bot as unknown as { entity: { position: Vec3 } }).entity.position = new Vec3(8.5, 60.2, 0.5);
  };
  const reflex = createHazardEscapeReflex({
    drowningStartAir: drowningStartAir ?? DROWNING_START_AIR,
    mover,
    diag: { log: () => undefined } as never,
  });
  let trigger = null as Trigger | null;
  while (trigger === null && state.ticks < 400) {
    trigger = reflex.check(view as never);
    if (trigger === null) await b.waitForTicks();
  }
  if (trigger === null) throw new Error('the reflex never fired');
  const firedAt = state.ticks;
  const { ctx } = basicContext(view as never, bot);
  const outcome = await reflex.run(trigger, ctx);
  return { trigger, firedAt, outcome, airLeft: view.air, x: pos().x };
}

describe('hazard-escape: the capped column escape, the real reflex loop (decision 0337, BILLY)', () => {
  it('fires at the air-12 crossing and reaches breathing air with air left', async () => {
    const run = await billyEscape();
    // The air-12 crossing is pinned as a literal (decision 0337), not read from DROWNING_START_AIR.
    expect(run.trigger).toEqual({ hazard: 'drowning', air: 12 });
    expect(run.firedAt).toBe((START_AIR - 12) * TICKS_PER_BUBBLE);
    expect(run.outcome).toEqual({ result: 'handled', detail: 'left drowning' });
    expect(run.x).toBeGreaterThanOrEqual(8);
    expect(run.airLeft).toBeGreaterThan(0);
  });

  it('with the trigger at 8 (the pre-0337 start) the same column ends with less air', async () => {
    const at12 = await billyEscape();
    const at8 = await billyEscape(8);
    expect(at8.trigger).toEqual({ hazard: 'drowning', air: 8 });
    expect(at8.firedAt).toBe((START_AIR - 8) * TICKS_PER_BUBBLE);
    expect(at8.airLeft).toBeLessThan(at12.airLeft);
  });
});
