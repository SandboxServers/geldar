// AN-12a: the threat policy of one life. The sheet's aggression, the roll switch and the roller are bound
// here; every d20 the policy draws uses the Body's generation in its DrawKey, so a restart never replays
// a draw, and each roll is recorded through the audit publisher before the decision uses it.
import {
  type CharacterSheet,
  type DrawKey,
  type Level,
  type Roll,
  rngFor,
  roll,
} from '@geldar/psyche';
import { createThreatPolicy, type ThreatPolicy } from '../body/reflexes/threat-policy.ts';

/** The part of the audit publisher the policy needs: recording a roll. */
export interface RollRecorder {
  recordRoll(key: DrawKey, roll: Roll, drawIndex: number): string;
}

export interface LifePolicyOptions {
  sheet: CharacterSheet;
  rolls: boolean;
  lifeId: string;
  generation: number;
  tick: () => number;
  audit: RollRecorder;
}

/**
 * The threat policy for one life in one Body generation. The combat level is 0 until the proficiency
 * cache is bound (AN-12b). Draws are keyed by the generation and a per-policy sequence, so a restart
 * (a new generation) starts its sequence again without replaying an earlier draw.
 */
export function lifeThreatPolicy(options: LifePolicyOptions): ThreatPolicy {
  const { sheet, rolls, lifeId, generation, tick, audit } = options;
  let decisionSeq = 0;
  const rollAt = (
    fx: string,
    score: CharacterSheet['attributes']['aggression'],
    dc: number,
    proficiency: Level,
  ): Roll => {
    const key: DrawKey = { lifeId, producer: 'body', generation, tick: tick(), fx, decisionSeq };
    decisionSeq += 1;
    const drawn = roll(fx, score, dc, rngFor(key), proficiency);
    audit.recordRoll(key, drawn, 0);
    return drawn;
  };
  return createThreatPolicy({
    aggression: sheet.attributes.aggression,
    combat: 0,
    rolls,
    rollAt,
  });
}
