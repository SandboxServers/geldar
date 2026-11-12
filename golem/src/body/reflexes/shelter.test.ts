import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReflexContext } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import { calmScene, sceneView, zombieAt } from './combat.fakes.ts';
import { panicBurrowReflex } from './panic-burrow.ts';
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

  it('a light above the dark limit resets the backoff', async () => {
    const view = liveDark(3);
    await abandonAt(view, 0);
    setLight(view, 12);
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).toBeNull();
    setLight(view, 3);
    expect(await abandonAt(view, 60)).toContain('backing off 20s');
  });

  it('a position change of more than 2 blocks resets the backoff', async () => {
    const view = liveDark(3);
    await abandonAt(view, 0);
    setPosition(view, 3);
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).not.toBeNull();
  });

  it('a move of 2 blocks or less keeps the backoff', async () => {
    const view = liveDark(3);
    await abandonAt(view, 0);
    setPosition(view, 1.5);
    setTick(view, 50);
    expect(darkShelterReflex.check(view)).toBeNull();
  });

  it('a change in the hostile set resets the backoff', async () => {
    const scene = calmScene();
    scene.hostiles = [zombieAt(5)];
    const view = { ...sceneView(scene), lightAtHead: 3, enclosed: false, isNight: true };
    await abandonAt(view, 0);
    scene.hostiles = [zombieAt(5), zombieAt(6)];
    setTick(view, 50);
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
});
