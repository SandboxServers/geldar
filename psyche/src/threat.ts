// The per-life threat policy (AN-08a, decision 0186, D-CS-05). Pure: the Body supplies the RNG through
// rollAt and records the result, so this file has no randomness, clock or I/O of its own.
// Health is out of 20. The floor is the fixed threshold; the band sits just above it.
import { factor, step } from './params.ts';
import type { Roll } from './roll.ts';
import type { Score } from './types.ts';

/** The fight floor for an aggression score: 10, 8, 6, 4, 2 for 1 to 5. At or below it, always flee. */
export function fightFloor(aggression: Score): number {
  return step(aggression, 6, -2, 2, 14);
}

/** The longest fight in milliseconds: 30000 at aggression 3, times 1.25 per point either way. */
export function fightLimitMs(aggression: Score): number {
  return Math.round(factor(aggression, 30_000, 1.25));
}

export interface ThreatInput {
  aggression: Score;
  combat: 0 | 1 | 2 | 3;
  health: number;
  armed: boolean;
  suicideMob: boolean;
  rolls: boolean;
}

export type ThreatCall = {
  action: 'fight' | 'flee';
  why: 'above_band' | 'band_roll' | 'at_or_below_floor' | 'unarmed' | 'unarmed_exception';
  floor: number;
  roll: Roll | null;
};

const BAND_HEADROOM = 4;
const BAND_DC = 11;
const UNARMED_AGGRESSION = 5;
const UNARMED_DC = 14;

function answer(
  action: ThreatCall['action'],
  why: ThreatCall['why'],
  floor: number,
  roll: Roll | null,
): ThreatCall {
  return { action, why, floor, roll };
}

/**
 * Fight or flee. Health at or below the floor flees. Armed, health above floor+4 fights; inside the
 * band a roll decides when `rolls` is true, and with `rolls` false the Body fights. Unarmed or
 * against a suicide mob it flees, except an aggression-5 Body against a non-suicide mob, which rolls
 * (fight on success) or, with `rolls` false, fights.
 */
export function decideThreat(
  input: ThreatInput,
  rollAt: (fx: string, score: Score, dc: number, proficiency: 0 | 1 | 2 | 3) => Roll,
): ThreatCall {
  const { aggression, combat, health, armed, suicideMob, rolls } = input;
  const floor = fightFloor(aggression);
  if (health <= floor) return answer('flee', 'at_or_below_floor', floor, null);
  if (armed && !suicideMob) {
    if (health > floor + BAND_HEADROOM || !rolls) return answer('fight', 'above_band', floor, null);
    const check = rollAt('threat', aggression, BAND_DC, combat);
    return answer(check.success ? 'fight' : 'flee', 'band_roll', floor, check);
  }
  if (aggression !== UNARMED_AGGRESSION || suicideMob) {
    return answer('flee', 'unarmed', floor, null);
  }
  if (!rolls) return answer('fight', 'unarmed_exception', floor, null);
  const check = rollAt('threat_unarmed', UNARMED_AGGRESSION, UNARMED_DC, combat);
  if (check.success) return answer('fight', 'unarmed_exception', floor, check);
  return answer('flee', 'unarmed', floor, check);
}
