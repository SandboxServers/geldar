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
