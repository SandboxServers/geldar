// AN-12a: the threat policy of one life. The sheet's aggression, the roll switch and the roller are bound
// here; every d20 the policy draws uses the Body's generation in its DrawKey, so a restart never replays
// a draw. Each roll is recorded through the audit publisher before the decision uses it, and every decision
// (rolled or not) is recorded as a decision event (AN-12a).
import {
  type CharacterSheet,
  type DrawKey,
  type Level,
  type Roll,
  rngFor,
  roll,
  type ThreatCall,
} from '@geldar/psyche';
import { createThreatPolicy, type ThreatPolicy } from '../body/reflexes/threat-policy.ts';
import type { DecisionFields } from './audit-events.ts';

/** The part of the audit publisher the policy needs: recording a roll and a decision. */
export interface ThreatRecorder {
  recordRoll(key: DrawKey, roll: Roll, drawIndex: number): string;
  recordDecision(key: DrawKey, fields: DecisionFields): void;
}

export interface LifePolicyOptions {
  sheet: CharacterSheet;
  rolls: boolean;
  lifeId: string;
  generation: number;
  tick: () => number;
  audit: ThreatRecorder;
  /** The combat level, read at each decision (the proficiency cache; 0 when none is bound). */
  combatLevel?: () => Level;
}

/**
 * The threat policy for one life in one Body generation. The combat level is read from `combatLevel` at each
 * decision, so a cache that adopts a new level changes the next decision. Draws are keyed by the generation
 * and a per-policy sequence, so a restart (a new generation) starts its sequence again without replaying an
 * earlier draw.
 */
export function lifeThreatPolicy(options: LifePolicyOptions): ThreatPolicy {
  const { sheet, rolls, lifeId, generation, tick, audit } = options;
  const combatLevel = options.combatLevel ?? (() => 0 as Level);
  let decisionSeq = 0;
  // The last roll drawn by the decision in progress, so the decision can cite it.
  let lastRoll: { key: DrawKey; id: string } | null = null;
  const newKey = (fx: string): DrawKey => {
    const key: DrawKey = { lifeId, producer: 'body', generation, tick: tick(), fx, decisionSeq };
    decisionSeq += 1;
    return key;
  };
  const rollAt = (
    fx: string,
    score: CharacterSheet['attributes']['aggression'],
    dc: number,
    proficiency: Level,
  ): Roll => {
    const key = newKey(fx);
    const drawn = roll(fx, score, dc, rngFor(key), proficiency);
    const id = audit.recordRoll(key, drawn, 0);
    lastRoll = { key, id };
    return drawn;
  };
  // A decision with a roll is a d20 decision keyed by that roll; one without is deterministic (rolls off,
  // a flee at or below the floor, an unarmed flee). Both are recorded through the audit publisher.
  const record = (
    call: ThreatCall,
    facts: { health: number; armed: boolean; suicideMob: boolean },
  ) => {
    const fields: DecisionFields = {
      fx: call.roll === null ? 'threat' : call.roll.fx,
      kind: 'deterministic',
      result: { decision: call.action },
      inputs: {
        health: facts.health,
        armed: facts.armed,
        suicide_mob: facts.suicideMob,
        floor: call.floor,
        why: call.why,
      },
    };
    if (call.roll !== null && lastRoll !== null) {
      audit.recordDecision(lastRoll.key, { ...fields, kind: 'd20', roll_event_ids: [lastRoll.id] });
    } else {
      audit.recordDecision(newKey('threat'), fields);
    }
  };
  const decideWith = (combat: Level): ThreatPolicy => {
    const policy = createThreatPolicy({
      aggression: sheet.attributes.aggression,
      combat,
      rolls,
      rollAt,
    });
    return policy;
  };
  return {
    floor: () => decideWith(combatLevel()).floor(),
    fightLimitMs: () => decideWith(combatLevel()).fightLimitMs(),
    decide(input) {
      lastRoll = null;
      const call = decideWith(combatLevel()).decide(input);
      record(call, input);
      return call;
    },
  };
}
