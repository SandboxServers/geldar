import { fightFloor, fightLimitMs, type Roll, type Score } from '@geldar/psyche';
import { describe, expect, it, vi } from 'vitest';
import { createThreatPolicy, LEGACY_THREAT, type ThreatRoller } from './threat-policy.ts';

const rolled = (success: boolean): Roll => ({ success }) as Roll;
const never: ThreatRoller = () => {
  throw new Error('this roller must not be called');
};

function policyWith(aggression: Score, rolls: boolean, rollAt: ThreatRoller) {
  return createThreatPolicy({ aggression, combat: 0, rolls, rollAt });
}

describe('floor and fight limit by aggression', () => {
  it('reads the psyche floors 10, 8, 6, 4, 2 and the limits for aggression 1 to 5', () => {
    const floors = ([1, 2, 3, 4, 5] as const).map((a) => policyWith(a, false, never).floor());
    expect(floors).toEqual([10, 8, 6, 4, 2]);
    expect(policyWith(2, false, never).fightLimitMs()).toBe(24_000);
    expect(policyWith(3, false, never).fightLimitMs()).toBe(30_000);
    expect(policyWith(4, false, never).fightLimitMs()).toBe(37_500);
  });
});

describe('LEGACY_THREAT', () => {
  it('is the floor and limit of aggression 3', () => {
    expect(LEGACY_THREAT.floor()).toBe(6);
    expect(LEGACY_THREAT.floor()).toBe(fightFloor(3));
    expect(LEGACY_THREAT.fightLimitMs()).toBe(30_000);
    expect(LEGACY_THREAT.fightLimitMs()).toBe(fightLimitMs(3));
  });

  it("matches today's reflex rule for every health, armed and suicide case, without a roll", () => {
    for (let health = 0; health <= 20; health += 1) {
      for (const armed of [false, true]) {
        for (const suicideMob of [false, true]) {
          const legacy = armed && !suicideMob && health > 6 ? 'fight' : 'flee';
          const facts = `health ${health} armed ${armed} suicide ${suicideMob}`;
          expect(LEGACY_THREAT.decide({ health, armed, suicideMob }).action, facts).toBe(legacy);
        }
      }
    }
  });
});

describe('the floor and band edges (aggression 3, floor 6)', () => {
  it.each([
    [6, 'flee', 'at_or_below_floor'],
    [7, 'fight', 'band_roll'],
    [10, 'fight', 'band_roll'],
    [11, 'fight', 'above_band'],
  ])('health %i gives %s (%s) when the band roll passes', (health, action, why) => {
    const policy = policyWith(3, true, () => rolled(true));
    expect(policy.decide({ health, armed: true, suicideMob: false })).toMatchObject({
      action,
      why,
    });
  });
});

describe('rolls', () => {
  it('draws nothing when rolls is false, in the band or in the unarmed exception', () => {
    const roller = vi.fn((): Roll => rolled(false));
    expect(
      policyWith(3, false, roller).decide({ health: 8, armed: true, suicideMob: false }),
    ).toMatchObject({
      action: 'fight',
      why: 'above_band',
    });
    expect(
      policyWith(5, false, roller).decide({ health: 5, armed: false, suicideMob: false }),
    ).toMatchObject({
      action: 'fight',
      why: 'unarmed_exception',
    });
    expect(roller).not.toHaveBeenCalled();
  });

  it('rolls the band with the threat check at the Body combat level', () => {
    const roller = vi.fn((): Roll => rolled(false));
    const policy = createThreatPolicy({ aggression: 3, combat: 2, rolls: true, rollAt: roller });
    expect(policy.decide({ health: 8, armed: true, suicideMob: false })).toMatchObject({
      action: 'flee',
      why: 'band_roll',
    });
    expect(roller).toHaveBeenCalledTimes(1);
    expect(roller).toHaveBeenCalledWith('threat', 3, 11, 2);
  });

  it('rolls the aggression-5 unarmed exception at DC 14 when rolls is true', () => {
    const roller = vi.fn((): Roll => rolled(false));
    const policy = policyWith(5, true, roller);
    expect(policy.decide({ health: 5, armed: false, suicideMob: false })).toMatchObject({
      action: 'flee',
      why: 'unarmed',
    });
    expect(roller).toHaveBeenCalledWith('threat_unarmed', 5, 14, 0);
  });
});

describe('a health that is not a finite number', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'flees at health %s without a roll',
    (health) => {
      const roller = vi.fn((): Roll => rolled(true));
      const policy = policyWith(5, true, roller);
      expect(policy.decide({ health, armed: true, suicideMob: false })).toMatchObject({
        action: 'flee',
        why: 'at_or_below_floor',
        roll: null,
      });
      expect(roller).not.toHaveBeenCalled();
    },
  );
});
