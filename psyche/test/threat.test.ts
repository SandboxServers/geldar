import { describe, expect, it } from 'vitest';
import {
  decideThreat,
  exactChance,
  fightFloor,
  fightLimitMs,
  type Rng,
  type Roll,
  roll,
  type Score,
  type ThreatInput,
} from '../src/index.ts';

type RollAt = (fx: string, score: Score, dc: number, proficiency: 0 | 1 | 2 | 3) => Roll;
type Call = { fx: string; score: Score; dc: number; proficiency: number };

const SCORES: Score[] = [1, 2, 3, 4, 5];
const COMBATS: Array<0 | 1 | 2 | 3> = [0, 1, 2, 3];

// Every draw returns the next face (1 to 20), so the dice of a roll are exactly the faces given.
function rigRng(faces: number[]): Rng {
  let index = 0;
  let draws = 0;
  return {
    next(): number {
      const face = faces[index];
      if (face === undefined) throw new Error('rigged rng ran out of faces');
      index += 1;
      draws += 1;
      return (face - 0.5) / 20;
    },
    get draws(): number {
      return draws;
    },
  };
}

// A rollAt that answers every call with the same face and records each call.
function spyRoll(face: number): { rollAt: RollAt; calls: Call[] } {
  const calls: Call[] = [];
  const rollAt: RollAt = (fx, score, dc, proficiency) => {
    calls.push({ fx, score, dc, proficiency });
    return roll(fx, score, dc, rigRng([face, face]), proficiency);
  };
  return { rollAt, calls };
}

const noRoll: RollAt = () => {
  throw new Error('rollAt must not be called');
};

function threatInput(over: Partial<ThreatInput> = {}): ThreatInput {
  return {
    aggression: 3,
    combat: 0,
    health: 20,
    armed: true,
    suicideMob: false,
    rolls: true,
    ...over,
  };
}

// The rule the standard sheet used before the policy: armed and above 6 fights, otherwise flee.
function legacyRule(health: number, armed: boolean): 'fight' | 'flee' {
  return armed && health > 6 ? 'fight' : 'flee';
}

describe('fightFloor and fightLimitMs', () => {
  it('floors are 10, 8, 6, 4 and 2 for aggression 1 to 5', () => {
    expect(SCORES.map((score) => fightFloor(score))).toEqual([10, 8, 6, 4, 2]);
  });

  it('limits are 24000, 30000 and 37500 for aggression 2, 3 and 4', () => {
    expect(fightLimitMs(2)).toBe(24000);
    expect(fightLimitMs(3)).toBe(30000);
    expect(fightLimitMs(4)).toBe(37500);
  });

  it('limits at the ends are 19200 for aggression 1 and 46875 for aggression 5', () => {
    expect(fightLimitMs(1)).toBe(19200);
    expect(fightLimitMs(5)).toBe(46875);
  });
});

describe('band edges: floor, floor+1, floor+4, floor+5', () => {
  for (const aggression of SCORES) {
    it(`aggression ${aggression}: health at the floor flees with no roll, armed or not`, () => {
      const floor = fightFloor(aggression);
      for (const armed of [true, false]) {
        const call = decideThreat(threatInput({ aggression, armed, health: floor }), noRoll);
        expect(call).toEqual({ action: 'flee', why: 'at_or_below_floor', floor, roll: null });
      }
    });

    it(`aggression ${aggression}: floor+1 rolls the band and fights on success`, () => {
      const floor = fightFloor(aggression);
      const spy = spyRoll(20);
      const call = decideThreat(
        threatInput({ aggression, combat: 2, health: floor + 1 }),
        spy.rollAt,
      );
      expect(call.action).toBe('fight');
      expect(call.why).toBe('band_roll');
      expect(call.roll?.success).toBe(true);
      expect(spy.calls).toEqual([{ fx: 'threat', score: aggression, dc: 11, proficiency: 2 }]);
    });

    it(`aggression ${aggression}: floor+4 rolls the band and flees on failure`, () => {
      const floor = fightFloor(aggression);
      const spy = spyRoll(1);
      const call = decideThreat(threatInput({ aggression, health: floor + 4 }), spy.rollAt);
      expect(call.action).toBe('flee');
      expect(call.why).toBe('band_roll');
      expect(call.roll?.success).toBe(false);
      expect(spy.calls).toHaveLength(1);
    });

    it(`aggression ${aggression}: floor+5 fights outright with no roll`, () => {
      const floor = fightFloor(aggression);
      const call = decideThreat(threatInput({ aggression, health: floor + 5 }), noRoll);
      expect(call).toEqual({ action: 'fight', why: 'above_band', floor, roll: null });
    });
  }
});

describe('armed and unarmed', () => {
  it('armed and above the band fights with no roll', () => {
    const call = decideThreat(threatInput({ health: 20 }), noRoll);
    expect(call).toEqual({ action: 'fight', why: 'above_band', floor: 6, roll: null });
  });

  it('armed with rolls false fights above the floor: the band is skipped', () => {
    for (let health = 7; health <= 20; health += 1) {
      const call = decideThreat(threatInput({ health, rolls: false }), noRoll);
      expect(call).toEqual({ action: 'fight', why: 'above_band', floor: 6, roll: null });
    }
  });

  it('unarmed flees at aggression 1 to 4 with no roll', () => {
    for (const aggression of [1, 2, 3, 4] as const) {
      const call = decideThreat(threatInput({ aggression, armed: false, health: 20 }), noRoll);
      expect(call).toEqual({
        action: 'flee',
        why: 'unarmed',
        floor: fightFloor(aggression),
        roll: null,
      });
    }
  });

  it('unarmed aggression 5 rolls the exception and fights on success', () => {
    const spy = spyRoll(20);
    const call = decideThreat(threatInput({ aggression: 5, armed: false, combat: 1 }), spy.rollAt);
    expect(call.action).toBe('fight');
    expect(call.why).toBe('unarmed_exception');
    expect(call.roll?.success).toBe(true);
    expect(spy.calls).toEqual([{ fx: 'threat_unarmed', score: 5, dc: 14, proficiency: 1 }]);
  });

  it('unarmed aggression 5 flees on a failed exception roll', () => {
    const spy = spyRoll(1);
    const call = decideThreat(threatInput({ aggression: 5, armed: false }), spy.rollAt);
    expect(call.action).toBe('flee');
    expect(call.why).toBe('unarmed');
    expect(call.roll?.success).toBe(false);
    expect(spy.calls).toHaveLength(1);
  });

  it('unarmed aggression 5 with rolls false fights with no roll', () => {
    const call = decideThreat(threatInput({ aggression: 5, armed: false, rolls: false }), noRoll);
    expect(call).toEqual({ action: 'fight', why: 'unarmed_exception', floor: 2, roll: null });
  });
});

describe('suicide mob', () => {
  it('a creeper never fights, even at aggression 5 with a winning roll', () => {
    for (const aggression of SCORES) {
      for (const armed of [true, false]) {
        for (const rolls of [true, false]) {
          for (let health = 0; health <= 20; health += 1) {
            const spy = spyRoll(20);
            const call = decideThreat(
              threatInput({ aggression, armed, rolls, health, suicideMob: true }),
              spy.rollAt,
            );
            expect(call.action).toBe('flee');
            expect(spy.calls).toEqual([]);
          }
        }
      }
    }
  });
});

describe('legacy equality at the standard sheet', () => {
  it('with rolls false, all-3 equals the legacy rule for health 0 to 20', () => {
    for (const combat of COMBATS) {
      for (const armed of [true, false]) {
        for (let health = 0; health <= 20; health += 1) {
          const call = decideThreat(
            threatInput({ aggression: 3, combat, armed, health, rolls: false }),
            noRoll,
          );
          expect(call.action).toBe(legacyRule(health, armed));
        }
      }
    }
  });
});

describe('exact probabilities', () => {
  it('aggression 3 band (one die) wins 10, 11, 12 or 13 of 20 by combat level', () => {
    const expected: Record<0 | 1 | 2 | 3, number> = { 0: 10, 1: 11, 2: 12, 3: 13 };
    for (const combat of COMBATS) {
      let fights = 0;
      for (let face = 1; face <= 20; face += 1) {
        const rollAt: RollAt = (fx, score, dc, proficiency) =>
          roll(fx, score, dc, rigRng([face]), proficiency);
        if (
          decideThreat(threatInput({ aggression: 3, combat, health: 9 }), rollAt).action === 'fight'
        ) {
          fights += 1;
        }
      }
      expect(exactChance(3, 11, combat)).toEqual({ wins: expected[combat], total: 20 });
      expect(fights).toBe(expected[combat]);
    }
  });

  it('aggression 5 unarmed exception (two dice) fights on 279 of 400 pairs', () => {
    let fights = 0;
    for (let first = 1; first <= 20; first += 1) {
      for (let second = 1; second <= 20; second += 1) {
        const rollAt: RollAt = (fx, score, dc, proficiency) =>
          roll(fx, score, dc, rigRng([first, second]), proficiency);
        const call = decideThreat(threatInput({ aggression: 5, armed: false, combat: 0 }), rollAt);
        if (call.action === 'fight') fights += 1;
      }
    }
    expect(fights).toBe(279);
    expect(exactChance(5, 14, 0)).toEqual({ wins: 279, total: 400 });
  });

  it('aggression 1 band (two dice, disadvantage) fights on 64 of 400 pairs', () => {
    let fights = 0;
    for (let first = 1; first <= 20; first += 1) {
      for (let second = 1; second <= 20; second += 1) {
        const rollAt: RollAt = (fx, score, dc, proficiency) =>
          roll(fx, score, dc, rigRng([first, second]), proficiency);
        const call = decideThreat(threatInput({ aggression: 1, combat: 0, health: 11 }), rollAt);
        if (call.action === 'fight') fights += 1;
      }
    }
    expect(fights).toBe(64);
    expect(exactChance(1, 11, 0)).toEqual({ wins: 64, total: 400 });
  });
});

describe('rolls false', () => {
  it('draws nothing, whatever the branch', () => {
    for (const aggression of SCORES) {
      for (const armed of [true, false]) {
        for (const suicideMob of [true, false]) {
          for (let health = 0; health <= 20; health += 1) {
            const spy = spyRoll(20);
            decideThreat(
              threatInput({ aggression, armed, suicideMob, health, rolls: false }),
              spy.rollAt,
            );
            expect(spy.calls).toEqual([]);
          }
        }
      }
    }
  });
});
