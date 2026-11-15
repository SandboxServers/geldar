import type { Roll } from '@geldar/psyche';
import { describe, expect, it, vi } from 'vitest';
import type { BodyView } from '../view.ts';
import { forgetThreatEncounter, threatCallFor } from './encounter.ts';
import { createThreatPolicy, LEGACY_THREAT, type ThreatRoller } from './threat-policy.ts';

const rolled = (success: boolean): Roll => ({ success }) as Roll;
const hit = { hostile: 'zombie', armed: true, suicideMob: false };

/** An aggression-3 policy that rolls the band; the roller is a counting spy. */
function bandPolicy(roll: ThreatRoller) {
  return createThreatPolicy({ aggression: 3, combat: 0, rolls: true, rollAt: roll });
}

/**
 * A Body view whose health and tick are read live from `scene`, so one view spans the encounter.
 * Only health and tick are read.
 */
function bodyAt(health: number, tick: number | null) {
  const scene = { health, tick };
  const view = {
    get health() {
      return scene.health;
    },
    get tick() {
      return scene.tick;
    },
  } as unknown as BodyView;
  return { scene, view };
}

describe('one courage decision per encounter', () => {
  it('reuses the first call on a second hurt in the band: one roll, the same call', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(false));
    const policy = bandPolicy(roller);

    const first = threatCallFor(view, policy, hit);
    expect(first).toMatchObject({ action: 'flee', why: 'band_roll' });

    scene.tick = 20;
    scene.health = 9;
    expect(threatCallFor(view, policy, hit)).toBe(first);
    scene.tick = 40;
    scene.health = 7;
    expect(threatCallFor(view, policy, hit)).toBe(first);
    expect(roller).toHaveBeenCalledTimes(1);
  });

  it('reuses a hurt 199 ticks after the last one, and decides again 201 ticks after', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    scene.tick = 199;
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(1);
    scene.tick = 400;
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('the window is 200 ticks: a hurt exactly 200 after the last one is reused, 201 is new', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    scene.tick = 200;
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(1);
    scene.tick = 401;
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('each reused hurt slides the window: hurts at 0, 150 and 340 are one encounter', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    scene.tick = 150;
    threatCallFor(view, policy, hit);
    scene.tick = 340;
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(1);
  });

  it('opens a new encounter for another hostile', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    scene.tick = 10;
    threatCallFor(view, policy, { ...hit, hostile: 'skeleton' });
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('a changed weapon ends the band encounter: the unarmed hurt flees without a roll', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    scene.tick = 10;
    expect(threatCallFor(view, policy, { ...hit, armed: false })).toMatchObject({
      action: 'flee',
      why: 'unarmed',
    });
    expect(roller).toHaveBeenCalledTimes(1);
  });

  it('the suicide-mob fact is part of the key: a changed fact is decided afresh, not reused', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    scene.tick = 10;
    expect(threatCallFor(view, policy, { ...hit, suicideMob: true })).toMatchObject({
      action: 'flee',
      why: 'unarmed',
    });
    expect(roller).toHaveBeenCalledTimes(1);
  });

  it('a band roll holds while health is above the band, and comes back into force inside it', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(false));
    const policy = bandPolicy(roller);

    const first = threatCallFor(view, policy, hit);
    scene.tick = 20;
    scene.health = 11;
    expect(threatCallFor(view, policy, hit)).toMatchObject({ action: 'fight', why: 'above_band' });
    scene.tick = 40;
    scene.health = 9;
    expect(threatCallFor(view, policy, hit)).toBe(first);
    expect(roller).toHaveBeenCalledTimes(1);
  });

  it('at or below the floor it flees without a roll, and the next hurt above the floor decides afresh', () => {
    const { scene, view } = bodyAt(6, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    expect(threatCallFor(view, policy, hit)).toMatchObject({
      action: 'flee',
      why: 'at_or_below_floor',
    });
    expect(roller).not.toHaveBeenCalled();
    scene.tick = 5;
    scene.health = 9;
    expect(threatCallFor(view, policy, hit)).toMatchObject({ action: 'fight', why: 'band_roll' });
    expect(roller).toHaveBeenCalledTimes(1);
  });

  it('a band roll that falls to the floor is not reused: the floor decides', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    expect(threatCallFor(view, policy, hit)).toMatchObject({ action: 'fight', why: 'band_roll' });
    scene.tick = 10;
    scene.health = 5;
    expect(threatCallFor(view, policy, hit)).toMatchObject({
      action: 'flee',
      why: 'at_or_below_floor',
    });
    expect(roller).toHaveBeenCalledTimes(1);
  });

  it('a null world tick keeps no memory: every hurt is decided afresh', () => {
    const { view } = bodyAt(8, null);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('a non-finite world tick keeps no memory either', () => {
    const { view } = bodyAt(8, Number.NaN);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('a null tick after an open encounter ends it: the next hurt decides afresh', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    scene.tick = null;
    threatCallFor(view, policy, hit);
    scene.tick = 1;
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(3);
  });

  it('a world tick that goes backwards starts a new encounter', () => {
    const { scene, view } = bodyAt(8, 100);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    scene.tick = 50;
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('a respawn forgets the open encounter, so the next hurt rolls again', () => {
    const { scene, view } = bodyAt(8, 0);
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);

    threatCallFor(view, policy, hit);
    forgetThreatEncounter(view);
    scene.tick = 10;
    threatCallFor(view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('two Bodies hold two encounters', () => {
    const roller = vi.fn((): Roll => rolled(true));
    const policy = bandPolicy(roller);
    const a = bodyAt(8, 0);
    const b = bodyAt(8, 0);

    threatCallFor(a.view, policy, hit);
    threatCallFor(b.view, policy, hit);
    expect(roller).toHaveBeenCalledTimes(2);
  });

  it('a decision that throws opens no encounter, so the next hurt decides again', () => {
    const { view } = bodyAt(8, 0);
    const roller = vi
      .fn<ThreatRoller>()
      .mockImplementationOnce(() => {
        throw new Error('rng down');
      })
      .mockImplementationOnce(() => rolled(true));
    const policy = bandPolicy(roller);

    expect(() => threatCallFor(view, policy, hit)).toThrow('rng down');
    expect(threatCallFor(view, policy, hit)).toMatchObject({ action: 'fight', why: 'band_roll' });
    expect(roller).toHaveBeenCalledTimes(2);
  });
});

describe('the legacy policy repeats its own rule on every hurt', () => {
  it('health 6 flees, and health 9 fights 10 ticks later: no sticky flee', () => {
    const { scene, view } = bodyAt(6, 0);

    expect(threatCallFor(view, LEGACY_THREAT, hit)).toMatchObject({
      action: 'flee',
      why: 'at_or_below_floor',
    });
    scene.tick = 10;
    scene.health = 9;
    expect(threatCallFor(view, LEGACY_THREAT, hit)).toMatchObject({
      action: 'fight',
      why: 'above_band',
    });
  });

  it('over repeated hurts from one zombie, each call equals the legacy decision for that health', () => {
    const { scene, view } = bodyAt(6, 0);
    const healths = [6, 9, 3, 12, 6, 20, 7, 5, 10, 11];
    healths.forEach((health, i) => {
      scene.tick = i * 10;
      scene.health = health;
      const expected = LEGACY_THREAT.decide({ health, armed: true, suicideMob: false });
      expect(threatCallFor(view, LEGACY_THREAT, hit)).toEqual(expected);
    });
  });
});
