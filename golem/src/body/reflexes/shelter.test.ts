import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionRegistry } from '../../actions/registry.ts';
import { fakeBot, manualTicks } from '../body.fakes.ts';
import { createBody } from '../create-body.ts';
import type { ReflexContext } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { calmScene, sceneView, zombieAt } from './combat.fakes.ts';
import { panicBurrowReflex } from './panic-burrow.ts';
import { GridWorld, gridBot, reflexContext } from './reflexes.fakes.ts';
import { darkShelterReflex } from './shelter.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A calm scene with one zombie `distance` blocks away and the given head light and enclosure. */
function darkView(light: number | null, distance = 5, enclosed = false): BodyView {
  const scene = calmScene();
  scene.hostiles = [zombieAt(distance)];
  return { ...sceneView(scene), lightAtHead: light, enclosed };
}

describe('dark_shelter trigger', () => {
  it('fires in the dark with a hostile within 8 blocks, and names the light and the hostile', () => {
    expect(darkShelterReflex.check(darkView(3, 5))).toMatchObject({
      cause: 'dark',
      hostile: 'zombie',
      light: 3,
    });
  });

  it('does not fire when it is not dark', () => {
    expect(darkShelterReflex.check(darkView(12, 5))).toBeNull();
  });

  it('fires at the dark limit (light 7) and not one level above it', () => {
    expect(darkShelterReflex.check(darkView(7, 5))).not.toBeNull();
    expect(darkShelterReflex.check(darkView(8, 5))).toBeNull();
  });

  it('does not fire with no hostile within 8 blocks', () => {
    expect(darkShelterReflex.check(darkView(3, 9))).toBeNull();
  });

  it('does not fire when the Body is already enclosed', () => {
    expect(darkShelterReflex.check(darkView(3, 5, true))).toBeNull();
  });

  it('reads a missing light value as not dark, and does not throw', () => {
    expect(() => darkShelterReflex.check(darkView(null, 5))).not.toThrow();
    expect(darkShelterReflex.check(darkView(null, 5))).toBeNull();
  });
});

describe('dark_shelter run', () => {
  const trigger = { light: 3, hostile: 'zombie', distance: 5, cause: 'dark' };

  it('hands the shelter to the panic burrow with the same context and a night trigger', async () => {
    const run = vi
      .spyOn(panicBurrowReflex, 'run')
      .mockResolvedValue({ result: 'handled', detail: 'sealed in' });
    const ctx = { signal: new AbortController().signal } as unknown as ReflexContext;
    const outcome = await darkShelterReflex.run(trigger, ctx);
    expect(run).toHaveBeenCalledWith({ phase: 'night', bed: false, shelter: false }, ctx);
    expect(outcome).toEqual({ result: 'handled', detail: 'sealed in' });
  });

  it('passes a failed burrow back as failed, without throwing', async () => {
    vi.spyOn(panicBurrowReflex, 'run').mockResolvedValue({
      result: 'failed',
      detail: 'could not dig the pocket',
    });
    const ctx = {} as unknown as ReflexContext;
    await expect(darkShelterReflex.run(trigger, ctx)).resolves.toEqual({
      result: 'failed',
      detail: 'could not dig the pocket',
    });
  });
});

describe('dark_shelter backoff holds at the abandoned spot (decision 0213)', () => {
  const abandoned = { result: 'abandoned' as const, detail: 'no suitable block' };
  const ctxFor = (view: BodyView) =>
    ({ signal: new AbortController().signal, view, tick: 0 }) as unknown as ReflexContext;

  /** A dark Body at tick 1000 whose shelter was abandoned at its spot, so the backoff runs to tick 1400. */
  async function abandonedAtSpot(): Promise<BodyView> {
    vi.spyOn(panicBurrowReflex, 'run').mockResolvedValue(abandoned);
    const view = liveDark(3);
    setTick(view, 1000);
    const trigger = darkShelterReflex.check(view);
    expect(trigger).not.toBeNull();
    await darkShelterReflex.run(trigger ?? {}, ctxFor(view));
    return view;
  }

  it('after an abandoned run, light 9 then 0 at the same spot is still backed off', async () => {
    const view = await abandonedAtSpot();
    setLight(view, 9);
    setTick(view, 1100);
    expect(darkShelterReflex.check(view)).toBeNull();
    setLight(view, 0);
    setTick(view, 1200);
    expect(darkShelterReflex.check(view)).toBeNull();
    // Once the backoff period has passed, the same spot may try again.
    setTick(view, 1400);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('moving away from the abandoned spot re-arms it', async () => {
    const view = await abandonedAtSpot();
    setLight(view, 9);
    setTick(view, 1100);
    setPosition(view, 20);
    setLight(view, 0);
    setTick(view, 1200);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('a Body that stays within the move radius of the spot stays backed off', async () => {
    const view = await abandonedAtSpot();
    setPosition(view, 4);
    setTick(view, 1200);
    expect(darkShelterReflex.check(view)).toBeNull();
  });
});

/** A dark Body view that lives across firings: its tick, position and light can be moved by the test. */
function liveDark(light: number, hostile = zombieAt(5), isNight = true): BodyView {
  const scene = calmScene();
  scene.hostiles = [hostile];
  return { ...sceneView(scene), lightAtHead: light, enclosed: false, isNight };
}

function setTick(view: BodyView, tick: number): void {
  (view as { tick: number }).tick = tick;
}

function setLight(view: BodyView, light: number): void {
  (view as { lightAtHead: number | null }).lightAtHead = light;
}

function setPosition(view: BodyView, x: number): void {
  (view as { position: { x: number; y: number; z: number } }).position = { x, y: 64, z: 0 };
}

describe('dark_shelter hostile classification', () => {
  it('does not fire on a spider in daylight (neutral by day, decision 0154)', () => {
    expect(darkShelterReflex.check(liveDark(3, zombieAt(5, 'spider'), false))).toBeNull();
  });

  it('fires on a spider at night', () => {
    expect(darkShelterReflex.check(liveDark(3, zombieAt(5, 'spider'), true))).toMatchObject({
      hostile: 'spider',
    });
  });
});

describe('dark_shelter backoff after an abandoned run', () => {
  const abandoned = { result: 'abandoned', detail: 'no suitable block' } as const;

  /** Fires the shelter once at the view's tick: the trigger must be there, and the run abandons. */
  async function abandonAt(view: BodyView, tick: number): Promise<string> {
    setTick(view, tick);
    const trigger = darkShelterReflex.check(view);
    if (trigger === null) throw new Error('dark shelter did not fire');
    vi.spyOn(panicBurrowReflex, 'run').mockResolvedValueOnce({ ...abandoned });
    const outcome = await darkShelterReflex.run(trigger, {
      view,
    } as unknown as ReflexContext);
    expect(outcome.result).toBe('abandoned');
    return outcome.detail ?? '';
  }

  it('logs the backoff once, then stays quiet until the period passes (20 s)', async () => {
    const view = liveDark(3);
    expect(await abandonAt(view, 0)).toBe('no suitable block; backing off 20s');
    setTick(view, 100);
    expect(darkShelterReflex.check(view)).toBeNull();
    setTick(view, 399);
    expect(darkShelterReflex.check(view)).toBeNull();
    setTick(view, 400);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('doubles on each abandon in a row (20 s, 40 s, 80 s) and caps at 5 min', async () => {
    const view = liveDark(3);
    expect(await abandonAt(view, 0)).toContain('backing off 20s');
    expect(await abandonAt(view, 400)).toContain('backing off 40s');
    expect(await abandonAt(view, 1200)).toContain('backing off 80s');
    expect(await abandonAt(view, 2800)).toContain('backing off 160s');
    expect(await abandonAt(view, 6000)).toContain('backing off 300s');
    expect(await abandonAt(view, 12000)).toContain('backing off 300s');
  });

  // Decision 0213: a light above the dark limit no longer resets the backoff at the same spot.
  it('a light above the dark limit does not reset the backoff at the same spot', async () => {
    const view = liveDark(3);
    await abandonAt(view, 0);
    setLight(view, 12);
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).toBeNull();
    setLight(view, 3);
    setTick(view, 60);
    expect(darkShelterReflex.check(view)).toBeNull();
  });

  it('a position change of more than 2 blocks does not reset the backoff', async () => {
    const view = liveDark(3);
    await abandonAt(view, 0);
    setPosition(view, 3);
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).toBeNull();
    setTick(view, 400);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('a move of 2 blocks or less keeps the backoff', async () => {
    const view = liveDark(3);
    await abandonAt(view, 0);
    setPosition(view, 1.5);
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).toBeNull();
  });

  it('a change in the hostile set does not reset the backoff', async () => {
    const scene = calmScene();
    scene.hostiles = [zombieAt(5)];
    const view = { ...sceneView(scene), lightAtHead: 3, enclosed: false, isNight: true };
    await abandonAt(view, 0);
    scene.hostiles = [zombieAt(5), zombieAt(6)];
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).toBeNull();
    setTick(view, 400);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('waits out the pause panic_burrow sets on its refusal, and a changed mob set or move does not end it', async () => {
    const world = new GridWorld();
    world.fill(new Vec3(-5, 63, -5), new Vec3(5, 63, 5), 'grass_block');
    const grid = gridBot(world, new Vec3(0, 64, 0));
    const scene = calmScene();
    scene.hostiles = [zombieAt(5)];
    const view = {
      ...sceneView(scene),
      lightAtHead: 3,
      enclosed: false,
      isNight: true,
      bedNearby: false,
    };
    // The run's tick is the one the pause starts from: the fake context fixes it at 100, so pin it to 0.
    const ctx = { ...reflexContext(grid.bot, view, new ActionRegistry()), tick: 0 };
    // Open ground has no wall for a pocket, so the real panic burrow refuses at tick 0 and pauses for 20 s.
    const refused = await panicBurrowReflex.run(
      { phase: 'night', bed: false, shelter: false },
      ctx,
    );
    expect(refused).toEqual({ result: 'abandoned', detail: 'no suitable block; backing off 20s' });
    // Dark shelter sees the hostile but waits out the shared pause; the mob set and the position change do not end it.
    setTick(view, 100);
    scene.hostiles = [zombieAt(5), zombieAt(6)];
    setPosition(view, 1.5);
    expect(darkShelterReflex.check(view)).toBeNull();
    setTick(view, 399);
    expect(darkShelterReflex.check(view)).toBeNull();
    setTick(view, 400);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('a burrow that fails (not abandoned) does not start a backoff', async () => {
    const view = liveDark(3);
    setTick(view, 0);
    const trigger = darkShelterReflex.check(view);
    if (trigger === null) throw new Error('dark shelter did not fire');
    vi.spyOn(panicBurrowReflex, 'run').mockResolvedValueOnce({ result: 'failed', detail: 'x' });
    await darkShelterReflex.run(trigger, { view } as unknown as ReflexContext);
    setTick(view, 10);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('a handled shelter clears the backoff that an abandoned one set', async () => {
    const view = liveDark(3);
    setTick(view, 0);
    const trigger = darkShelterReflex.check(view);
    if (trigger === null) throw new Error('dark shelter did not fire');
    vi.spyOn(panicBurrowReflex, 'run').mockResolvedValueOnce({ ...abandoned });
    await darkShelterReflex.run(trigger, { view } as unknown as ReflexContext);
    // Still inside the 20 s backoff.
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).toBeNull();
    vi.spyOn(panicBurrowReflex, 'run').mockResolvedValueOnce({
      result: 'handled',
      detail: 'sealed in',
    });
    await darkShelterReflex.run(trigger, { view } as unknown as ReflexContext);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('a respawn forgets the backoff of the old body (createBody wires the forget)', async () => {
    const emitter = new EventEmitter();
    const bot = Object.assign(emitter, fakeBot(), {
      on: emitter.on.bind(emitter),
    }) as unknown as Bot;
    const view = liveDark(3);
    createBody({
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      bot,
      ticks: manualTicks().source,
      currentRevision: () => 1,
      view,
    });
    await abandonAt(view, 0);
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).toBeNull();
    emitter.emit('respawn');
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });
});
