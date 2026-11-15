// d20 checks (decision 0186, D-CS-05). A score sets the mode (disadvantage, flat or advantage) and a bonus.
// exactChance enumerates every dice outcome, so the chances are exact counts, not estimates.
import type { Level } from './proficiency.ts';
import { d20, type Rng } from './rng.ts';
import type { Score } from './types.ts';

export type Mode = 'dis' | 'flat' | 'adv';

export interface Roll {
  fx: string;
  score: Score;
  proficiency: Level;
  dc: number;
  mode: Mode;
  dice: number[];
  kept: number;
  bonus: number;
  total: number;
  success: boolean;
}

export const DEFAULT_DCS = { easy: 8, standard: 11, hard: 14, veryHard: 17 } as const;

const MODES: Record<Score, { mode: Mode; bonus: number }> = {
  1: { mode: 'dis', bonus: -2 },
  2: { mode: 'dis', bonus: 0 },
  3: { mode: 'flat', bonus: 0 },
  4: { mode: 'adv', bonus: 0 },
  5: { mode: 'adv', bonus: 2 },
};

/** The mode and the score's own bonus (proficiency is added by roll and exactChance). */
export function modeFor(score: Score): { mode: Mode; bonus: number } {
  const entry = MODES[score];
  return { mode: entry.mode, bonus: entry.bonus };
}

function diceCount(mode: Mode): number {
  return mode === 'flat' ? 1 : 2;
}

/** Disadvantage keeps the lower die, advantage the higher, flat keeps the only die. */
function keep(mode: Mode, dice: readonly number[]): number {
  if (mode === 'dis') return Math.min(...dice);
  if (mode === 'adv') return Math.max(...dice);
  const [only = 0] = dice;
  return only;
}

function succeeds(total: number, dc: number): boolean {
  return total >= dc;
}

export function roll(fx: string, score: Score, dc: number, rng: Rng, proficiency: Level = 0): Roll {
  const { mode, bonus: modeBonus } = modeFor(score);
  const dice = Array.from({ length: diceCount(mode) }, () => d20(rng));
  const kept = keep(mode, dice);
  const bonus = modeBonus + proficiency;
  const total = kept + bonus;
  return {
    fx,
    score,
    proficiency,
    dc,
    mode,
    dice,
    kept,
    bonus,
    total,
    success: succeeds(total, dc),
  };
}

/** Exact count of winning outcomes out of all outcomes: 20 for flat, 400 for disadvantage and advantage. */
export function exactChance(
  score: Score,
  dc: number,
  proficiency: Level = 0,
): { wins: number; total: number } {
  const { mode, bonus: modeBonus } = modeFor(score);
  const bonus = modeBonus + proficiency;
  const faces = Array.from({ length: 20 }, (_, index) => index + 1);
  const outcomes: number[][] =
    diceCount(mode) === 1
      ? faces.map((face) => [face])
      : faces.flatMap((first) => faces.map((second) => [first, second]));
  let wins = 0;
  for (const dice of outcomes) {
    if (succeeds(keep(mode, dice) + bonus, dc)) wins += 1;
  }
  return { wins, total: outcomes.length };
}
