// The Body's per-life threat policy (AN-08b, D-CS-05). The Body binds the character's aggression,
// combat level, roll switch and roller once; the reflexes then ask decide() with only the facts of the
// moment. The decision itself is psyche's pure decideThreat (AN-08a).
import {
  decideThreat,
  fightFloor,
  fightLimitMs,
  type Score,
  type ThreatCall,
} from '@geldar/psyche';

/** The roller decideThreat takes: the Body's RNG, recorded by the caller. */
export type ThreatRoller = Parameters<typeof decideThreat>[1];

/** The facts of one call: the Body's health now, whether it holds a weapon, and whether the hostile is a suicide mob. */
export interface ThreatFacts {
  health: number;
  armed: boolean;
  suicideMob: boolean;
}

export interface ThreatPolicy {
  floor(): number;
  fightLimitMs(): number;
  decide(input: ThreatFacts): ThreatCall;
}

/** The settings bound into one policy: the character's sheet numbers and the roll switch. */
export interface ThreatSettings {
  aggression: Score;
  combat: 0 | 1 | 2 | 3;
  rolls: boolean;
  rollAt: ThreatRoller;
}

/**
 * A policy for one life. A health that is not a finite number flees without a roll (no decision can be
 * made from it). Otherwise psyche's decideThreat decides, and rollAt is called only when `rolls` is true.
 */
export function createThreatPolicy(settings: ThreatSettings): ThreatPolicy {
  const { aggression, combat, rolls, rollAt } = settings;
  return {
    floor: () => fightFloor(aggression),
    fightLimitMs: () => fightLimitMs(aggression),
    decide(input: ThreatFacts): ThreatCall {
      if (!Number.isFinite(input.health)) {
        return {
          action: 'flee',
          why: 'at_or_below_floor',
          floor: fightFloor(aggression),
          roll: null,
        };
      }
      return decideThreat(
        {
          aggression,
          combat,
          health: input.health,
          armed: input.armed,
          suicideMob: input.suicideMob,
          rolls,
        },
        rollAt,
      );
    },
  };
}

const NEVER_ROLLS: ThreatRoller = () => {
  throw new Error('the legacy threat policy never rolls');
};

/** Today's reflex rule, as a policy: floor 6 (fightFloor(3)), 30000 ms (fightLimitMs(3)), all-3 with rolls off. */
export const LEGACY_THREAT: ThreatPolicy = createThreatPolicy({
  aggression: 3,
  combat: 0,
  rolls: false,
  rollAt: NEVER_ROLLS,
});
