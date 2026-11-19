import {
  type CharacterSheet,
  type DrawKey,
  type Level,
  type Roll,
  STANDARD_SHEET,
} from '@geldar/psyche';
import { describe, expect, it } from 'vitest';
import type { DecisionFields } from './audit-events.ts';
import { lifeThreatPolicy, type ThreatRecorder } from './runtime.ts';

const LIFE = 'ag_test_01';

function recorder(): ThreatRecorder & {
  keys: DrawKey[];
  rolls: Roll[];
  decisions: Array<{ key: DrawKey; fields: DecisionFields }>;
} {
  const keys: DrawKey[] = [];
  const rolls: Roll[] = [];
  const decisions: Array<{ key: DrawKey; fields: DecisionFields }> = [];
  return {
    keys,
    rolls,
    decisions,
    recordRoll(key, drawn) {
      keys.push(key);
      rolls.push(drawn);
      return 'id';
    },
    recordDecision(key, fields) {
      // The real publisher drops a decision whose fx differs from its key's fx; this fake fails the test instead.
      expect(fields.fx).toBe(key.fx);
      decisions.push({ key, fields });
    },
  };
}

// Armed, health 8: inside the band (floor 6, band to 10) at aggression 3, so the roll decides.
const BAND = { health: 8, armed: true, suicideMob: false };

const UNARMED_AGGRESSION_5 = {
  ...STANDARD_SHEET,
  attributes: {
    ...STANDARD_SHEET.attributes,
    aggression: 5 as CharacterSheet['attributes']['aggression'],
  },
};

describe('lifeThreatPolicy keys, fx and inputs (AN-12a)', () => {
  it('draws an unarmed flee as a d20 keyed threat_unarmed, and the decision carries that fx', () => {
    const audit = recorder();
    const policy = lifeThreatPolicy({
      sheet: UNARMED_AGGRESSION_5,
      rolls: true,
      lifeId: LIFE,
      generation: 7,
      tick: () => 100,
      audit,
    });
    policy.decide({ health: 8, armed: false, suicideMob: false });
    const [key] = audit.keys;
    const [decision] = audit.decisions;
    expect(key?.fx).toBe('threat_unarmed');
    expect(decision?.key).toEqual(key);
    expect(decision?.fields.fx).toBe('threat_unarmed');
    expect(decision?.fields.kind).toBe('d20');
  });

  it('records nothing for a non-finite health, and does not throw', () => {
    const audit = recorder();
    const policy = lifeThreatPolicy({
      sheet: STANDARD_SHEET,
      rolls: false,
      lifeId: LIFE,
      generation: 7,
      tick: () => 100,
      audit,
    });
    expect(() =>
      policy.decide({ health: Number.NaN, armed: true, suicideMob: false }),
    ).not.toThrow();
    expect(() =>
      policy.decide({ health: Number.POSITIVE_INFINITY, armed: true, suicideMob: false }),
    ).not.toThrow();
    expect(audit.decisions).toHaveLength(0);
  });
});

describe('lifeThreatPolicy decisions and the combat level (AN-12a)', () => {
  it('records no decision for a deterministic decision that drew no roll', () => {
    const audit = recorder();
    const policy = lifeThreatPolicy({
      sheet: STANDARD_SHEET,
      rolls: false,
      lifeId: LIFE,
      generation: 7,
      tick: () => 100,
      audit,
    });
    expect(policy.decide(BAND).roll).toBeNull();
    expect(audit.keys).toHaveLength(0);
    expect(audit.decisions).toHaveLength(0);
  });

  it('still records a rolled decision as a d20 decision keyed like its roll, citing the roll', () => {
    const audit = recorder();
    const policy = lifeThreatPolicy({
      sheet: STANDARD_SHEET,
      rolls: true,
      lifeId: LIFE,
      generation: 7,
      tick: () => 100,
      audit,
    });
    expect(policy.decide(BAND).roll).not.toBeNull();
    const [roll] = audit.keys;
    const [decision] = audit.decisions;
    expect(decision?.key).toEqual(roll);
    expect(decision?.key.generation).toBe(7);
    expect(decision?.fields.kind).toBe('d20');
    expect(decision?.fields.roll_event_ids).toEqual(['id']);
  });

  it('reads the combat level at each decision, not a fixed 0', () => {
    const audit = recorder();
    let level: Level = 2;
    const policy = lifeThreatPolicy({
      sheet: STANDARD_SHEET,
      rolls: true,
      lifeId: LIFE,
      generation: 1,
      tick: () => 100,
      audit,
      combatLevel: () => level,
    });
    policy.decide(BAND);
    level = 3;
    policy.decide(BAND);
    expect(audit.rolls.map((r) => r.proficiency)).toEqual([2, 3]);
  });
});

describe('lifeThreatPolicy (AN-12a)', () => {
  it('takes the aggression and the roll switch from the sheet and the config', () => {
    const audit = recorder();
    const policy = lifeThreatPolicy({
      sheet: STANDARD_SHEET,
      rolls: false,
      lifeId: LIFE,
      generation: 2,
      tick: () => 100,
      audit,
    });
    expect(policy.floor()).toBe(6);
    expect(policy.fightLimitMs()).toBe(30000);
    expect(policy.decide(BAND).roll).toBeNull();
    expect(audit.keys).toHaveLength(0);
  });

  it('keys each draw by this generation, the tick and a sequence that restarts per policy', () => {
    const audit = recorder();
    const make = (generation: number) =>
      lifeThreatPolicy({
        sheet: STANDARD_SHEET,
        rolls: true,
        lifeId: LIFE,
        generation,
        tick: () => 555,
        audit,
      });
    const first = make(2);
    first.decide(BAND);
    first.decide(BAND);
    const second = make(3);
    second.decide(BAND);
    expect(audit.keys.map((k) => [k.generation, k.decisionSeq, k.tick, k.lifeId])).toEqual([
      [2, 0, 555, LIFE],
      [2, 1, 555, LIFE],
      [3, 0, 555, LIFE],
    ]);
    expect(audit.keys.every((k) => k.producer === 'body' && k.fx.length > 0)).toBe(true);
  });

  it('records one roll per decision in the band and none when rolls are off', () => {
    const audit = recorder();
    const policy = lifeThreatPolicy({
      sheet: STANDARD_SHEET,
      rolls: true,
      lifeId: LIFE,
      generation: 1,
      tick: () => 1,
      audit,
    });
    const call = policy.decide(BAND);
    expect(call.roll).not.toBeNull();
    expect(audit.rolls).toHaveLength(1);
    expect(audit.rolls[0]).toEqual(call.roll);
  });
});
