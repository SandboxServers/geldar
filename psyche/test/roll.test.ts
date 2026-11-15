import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DCS,
  type DrawKey,
  d20,
  exactChance,
  type Level,
  modeFor,
  type Rng,
  rngFor,
  roll,
  type Score,
} from '../src/index.ts';

// A rigged rng: each draw returns the die face given (1 to 20), in order.
function rigged(faces: number[]): Rng {
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

const KEY: DrawKey = {
  lifeId: 'life-a',
  producer: 'body',
  generation: 1,
  tick: 100,
  fx: 'novelty',
  decisionSeq: 0,
};

// Independent oracle: enumerate by hand, without the engine's helpers.
function oracle(score: Score, dc: number, proficiency: Level): { wins: number; total: number } {
  const modeBonus = { 1: -2, 2: 0, 3: 0, 4: 0, 5: 2 }[score];
  const bonus = modeBonus + proficiency;
  const mode = { 1: 'dis', 2: 'dis', 3: 'flat', 4: 'adv', 5: 'adv' }[score];
  let wins = 0;
  let total = 0;
  for (let a = 1; a <= 20; a++) {
    if (mode === 'flat') {
      total += 1;
      if (a + bonus >= dc) wins += 1;
      continue;
    }
    for (let b = 1; b <= 20; b++) {
      total += 1;
      const kept = mode === 'dis' ? Math.min(a, b) : Math.max(a, b);
      if (kept + bonus >= dc) wins += 1;
    }
  }
  return { wins, total };
}

describe('modeFor', () => {
  it('gives the mode table for all five scores', () => {
    expect(modeFor(1)).toEqual({ mode: 'dis', bonus: -2 });
    expect(modeFor(2)).toEqual({ mode: 'dis', bonus: 0 });
    expect(modeFor(3)).toEqual({ mode: 'flat', bonus: 0 });
    expect(modeFor(4)).toEqual({ mode: 'adv', bonus: 0 });
    expect(modeFor(5)).toEqual({ mode: 'adv', bonus: 2 });
  });
});

describe('roll', () => {
  it('disadvantage keeps the lower die (exact counts depend on it)', () => {
    const result = roll('novelty', 1, 4, rigged([20, 5]));
    expect(result.mode).toBe('dis');
    expect(result.dice).toEqual([20, 5]);
    expect(result.kept).toBe(5);
    expect(result.bonus).toBe(-2);
    expect(result.total).toBe(3);
  });

  it('advantage keeps the higher die and adds the +2 bonus at score 5', () => {
    const four = roll('novelty', 4, 10, rigged([3, 17]));
    expect(four).toMatchObject({ mode: 'adv', kept: 17, bonus: 0, total: 17, success: true });
    const five = roll('novelty', 5, 19, rigged([3, 17]));
    expect(five).toMatchObject({ mode: 'adv', kept: 17, bonus: 2, total: 19, success: true });
  });

  it('flat uses one die and draws exactly one value', () => {
    const rng = rigged([11]);
    const result = roll('novelty', 3, 11, rng);
    expect(result.dice).toEqual([11]);
    expect(result.total).toBe(11);
    expect(rng.draws).toBe(1);
  });

  it('disadvantage and advantage draw exactly two values', () => {
    const rng = rigged([7, 9]);
    roll('novelty', 2, 1, rng);
    expect(rng.draws).toBe(2);
  });

  it('success at exactly the DC is a success, one below is not (DC edge)', () => {
    expect(roll('novelty', 3, 11, rigged([11])).success).toBe(true);
    expect(roll('novelty', 3, 11, rigged([10])).success).toBe(false);
    expect(roll('novelty', 2, 4, rigged([4, 20])).success).toBe(true);
    expect(roll('novelty', 2, 5, rigged([4, 20])).success).toBe(false);
  });

  it('adds the proficiency level to the bonus, for every level 0 to 3', () => {
    for (const level of [0, 1, 2, 3] as const) {
      const result = roll('novelty', 3, 11, rigged([9]), level);
      expect(result.proficiency).toBe(level);
      expect(result.bonus).toBe(level);
      expect(result.total).toBe(9 + level);
      expect(result.success).toBe(9 + level >= 11);
    }
  });

  it('adds proficiency on top of the mode bonus', () => {
    const result = roll('novelty', 5, 30, rigged([20, 20]), 3);
    expect(result.bonus).toBe(5);
    expect(result.total).toBe(25);
  });

  it('a fixed seed gives fixed dice', () => {
    const first = roll('novelty', 1, 8, rngFor(KEY));
    const again = roll('novelty', 1, 8, rngFor(KEY));
    expect(again.dice).toEqual(first.dice);
    expect(again.total).toBe(first.total);
  });
});

describe('exactChance', () => {
  it('score 1 at DC 8 is 121 of 400 (the brief shows 30 percent as a rounding)', () => {
    expect(exactChance(1, 8)).toEqual({ wins: 121, total: 400 });
  });

  it('score 4 at DC 8 is 351 of 400', () => {
    expect(exactChance(4, 8)).toEqual({ wins: 351, total: 400 });
  });

  it('score 3 at DC 11 is 10 of 20', () => {
    expect(exactChance(3, 11)).toEqual({ wins: 10, total: 20 });
  });

  it('matches the independent enumeration for every score, DC 2 to 30 and proficiency 0 to 3', () => {
    for (const score of [1, 2, 3, 4, 5] as const) {
      for (let dc = 2; dc <= 30; dc++) {
        for (const level of [0, 1, 2, 3] as const) {
          expect(exactChance(score, dc, level)).toEqual(oracle(score, dc, level));
        }
      }
    }
  });

  it('proficiency shifts the exact counts: flat 3 at DC 11 with level 1 is 11 of 20', () => {
    expect(exactChance(3, 11, 1)).toEqual({ wins: 11, total: 20 });
    expect(exactChance(3, 11, 3)).toEqual({ wins: 13, total: 20 });
  });

  it('DC 2 edge: flat 3 is 19 of 20, and score 1 needs the lower die at least 4', () => {
    expect(exactChance(3, 2)).toEqual({ wins: 19, total: 20 });
    expect(exactChance(1, 2)).toEqual({ wins: 289, total: 400 });
  });

  it('DC 30 edge: nothing reaches 30 without proficiency, and advantage at 5 with level 3 cannot', () => {
    expect(exactChance(3, 30)).toEqual({ wins: 0, total: 20 });
    expect(exactChance(5, 30, 3)).toEqual({ wins: 0, total: 400 });
  });

  it('exposes the default DCs', () => {
    expect(DEFAULT_DCS).toEqual({ easy: 8, standard: 11, hard: 14, veryHard: 17 });
  });
});

describe('whole Roll record, one rigged roll per mode', () => {
  it('disadvantage: score 1 keeps the lower die and takes the -2 bonus', () => {
    expect(roll('novelty', 1, 8, rigged([17, 7]))).toEqual({
      fx: 'novelty',
      score: 1,
      proficiency: 0,
      dc: 8,
      mode: 'dis',
      dice: [17, 7],
      kept: 7,
      bonus: -2,
      total: 5,
      success: false,
    });
  });

  it('flat: score 3 draws one die and keeps it', () => {
    expect(roll('novelty', 3, 11, rigged([11]))).toEqual({
      fx: 'novelty',
      score: 3,
      proficiency: 0,
      dc: 11,
      mode: 'flat',
      dice: [11],
      kept: 11,
      bonus: 0,
      total: 11,
      success: true,
    });
  });

  it('advantage: score 5 keeps the higher die and adds the +2 bonus and proficiency 1', () => {
    expect(roll('novelty', 5, 19, rigged([3, 17]), 1)).toEqual({
      fx: 'novelty',
      score: 5,
      proficiency: 1,
      dc: 19,
      mode: 'adv',
      dice: [3, 17],
      kept: 17,
      bonus: 3,
      total: 20,
      success: true,
    });
  });
});

describe('golden novelty rolls from the fixed key', () => {
  // Values taken from a run of the engine. The raw first draw of rngFor(KEY) is pinned in rng.test.ts;
  // these pin its d20 mapping and the whole Roll it gives at scores 1, 3 and 5.
  it('pins the first two d20 values of rngFor(KEY)', () => {
    const rng = rngFor(KEY);
    expect([d20(rng), d20(rng)]).toEqual([17, 7]);
  });

  it('pins the rolls at scores 1, 3 and 5 from rngFor(KEY), DC 11', () => {
    expect(roll('novelty', 1, 11, rngFor(KEY))).toEqual({
      fx: 'novelty',
      score: 1,
      proficiency: 0,
      dc: 11,
      mode: 'dis',
      dice: [17, 7],
      kept: 7,
      bonus: -2,
      total: 5,
      success: false,
    });
    expect(roll('novelty', 3, 11, rngFor(KEY))).toEqual({
      fx: 'novelty',
      score: 3,
      proficiency: 0,
      dc: 11,
      mode: 'flat',
      dice: [17],
      kept: 17,
      bonus: 0,
      total: 17,
      success: true,
    });
    expect(roll('novelty', 5, 11, rngFor(KEY))).toEqual({
      fx: 'novelty',
      score: 5,
      proficiency: 0,
      dc: 11,
      mode: 'adv',
      dice: [17, 7],
      kept: 17,
      bonus: 2,
      total: 19,
      success: true,
    });
  });
});

// Source: the owner's brief, table 4.1, as whole percents. The brief is not in the repository;
// these cells are copied from it and rounded there. Rows are scores 1 to 5, columns are DCs 8, 11, 14, 17.
type TableDc = 8 | 11 | 14 | 17;
const BRIEF_TABLE_4_1: Record<Score, Record<TableDc, number>> = {
  1: { 8: 30, 11: 16, 14: 6, 17: 1 },
  2: { 8: 42, 11: 25, 14: 12, 17: 4 },
  3: { 8: 65, 11: 50, 14: 35, 17: 20 },
  4: { 8: 88, 11: 75, 14: 58, 17: 36 },
  5: { 8: 94, 11: 84, 14: 70, 17: 51 },
};

describe('table 4.1 fixture (proficiency 0)', () => {
  it('each exact chance is within one percentage point of its brief cell', () => {
    for (const score of [1, 2, 3, 4, 5] as const) {
      for (const dc of [8, 11, 14, 17] as const) {
        const { wins, total } = exactChance(score, dc);
        const percent = (wins / total) * 100;
        expect(
          Math.abs(percent - BRIEF_TABLE_4_1[score][dc]),
          `score ${score} DC ${dc}: ${percent}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});
