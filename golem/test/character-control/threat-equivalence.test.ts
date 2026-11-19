// S12-03: the all-3 control sheet with rolls off decides exactly as today's Body (LEGACY_THREAT, the
// policy the Body uses when `character` is omitted). Tests only; no source file changes.
import { rngFor, STANDARD_SHEET } from '@geldar/psyche';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_THREAT,
  type ThreatFacts,
  type ThreatPolicy,
} from '../../src/body/reflexes/threat-policy.ts';
import { isSuicideMob } from '../../src/body/reflexes/threats.ts';
import { lifeThreatPolicy, type ThreatRecorder } from '../../src/character/runtime.ts';
import { ALWAYS_HOSTILE } from '../../src/perception/hostile-types.ts';

vi.mock('@geldar/psyche', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geldar/psyche')>();
  return { ...actual, rngFor: vi.fn(actual.rngFor) };
});

const HEALTHS = [
  ...Array.from({ length: 21 }, (_, i) => i),
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];
const HOSTILE_NAMES = [...ALWAYS_HOSTILE];

function recorder() {
  return {
    recordRoll: vi.fn((): string => 'roll-id'),
    recordDecision: vi.fn(),
  } satisfies { [K in keyof ThreatRecorder]: ThreatRecorder[K] };
}

function sheetPolicy(audit: ThreatRecorder): ThreatPolicy {
  return lifeThreatPolicy({
    sheet: STANDARD_SHEET,
    rolls: false,
    lifeId: 'life-threat-equivalence',
    generation: 1,
    tick: () => 100,
    audit,
    combatLevel: () => 0,
  });
}

/** Every fact combination the reflexes can ask: health 0 to 20 (and non-finite), armed or not, every always-hostile name. */
function allFacts(): ThreatFacts[] {
  const out: ThreatFacts[] = [];
  for (const name of HOSTILE_NAMES) {
    for (const armed of [false, true]) {
      for (const health of HEALTHS) {
        out.push({ health, armed, suicideMob: isSuicideMob(name) });
      }
    }
  }
  return out;
}

/**
 * Golden rows, written out by hand from today's rule (floor 6 at aggression 3, rolls off):
 * health at or below 6 flees; armed and not a suicide mob above 6 fights (the band does not roll);
 * unarmed or a suicide mob above 6 flees as unarmed.
 */
const GOLDEN: Array<{ facts: ThreatFacts; action: 'fight' | 'flee'; why: string }> = [
  {
    facts: { health: 0, armed: true, suicideMob: false },
    action: 'flee',
    why: 'at_or_below_floor',
  },
  {
    facts: { health: 6, armed: true, suicideMob: false },
    action: 'flee',
    why: 'at_or_below_floor',
  },
  {
    facts: { health: 6, armed: false, suicideMob: false },
    action: 'flee',
    why: 'at_or_below_floor',
  },
  { facts: { health: 6, armed: true, suicideMob: true }, action: 'flee', why: 'at_or_below_floor' },
  { facts: { health: 7, armed: true, suicideMob: false }, action: 'fight', why: 'above_band' },
  { facts: { health: 10, armed: true, suicideMob: false }, action: 'fight', why: 'above_band' },
  { facts: { health: 20, armed: true, suicideMob: false }, action: 'fight', why: 'above_band' },
  { facts: { health: 7, armed: false, suicideMob: false }, action: 'flee', why: 'unarmed' },
  { facts: { health: 20, armed: false, suicideMob: false }, action: 'flee', why: 'unarmed' },
  { facts: { health: 7, armed: true, suicideMob: true }, action: 'flee', why: 'unarmed' },
  { facts: { health: 20, armed: true, suicideMob: true }, action: 'flee', why: 'unarmed' },
];

describe('the all-3 sheet with rolls off equals today’s Body', () => {
  beforeEach(() => {
    vi.mocked(rngFor).mockClear();
  });

  it('decides the same as LEGACY_THREAT over health 0 to 20 and non-finite health, armed and unarmed, for every hostile name', () => {
    const sheet = sheetPolicy(recorder());
    for (const facts of allFacts()) {
      expect(sheet.decide(facts), JSON.stringify(facts)).toEqual(LEGACY_THREAT.decide(facts));
    }
  });

  it('matches the golden table for the sheet policy and for LEGACY_THREAT', () => {
    const sheet = sheetPolicy(recorder());
    for (const { facts, action, why } of GOLDEN) {
      expect(LEGACY_THREAT.decide(facts), JSON.stringify(facts)).toMatchObject({
        action,
        why,
        floor: 6,
      });
      expect(sheet.decide(facts), JSON.stringify(facts)).toMatchObject({ action, why, floor: 6 });
    }
  });

  it('flees without a roll for non-finite health and records no decision for it', () => {
    const audit = recorder();
    const sheet = sheetPolicy(audit);
    for (const health of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(sheet.decide({ health, armed: true, suicideMob: false })).toEqual({
        action: 'flee',
        why: 'at_or_below_floor',
        floor: 6,
        roll: null,
      });
    }
    expect(audit.recordDecision).not.toHaveBeenCalled();
    expect(audit.recordRoll).not.toHaveBeenCalled();
  });

  it('has the same fight time limit and floor as today’s Body', () => {
    const sheet = sheetPolicy(recorder());
    expect(sheet.fightLimitMs()).toBe(LEGACY_THREAT.fightLimitMs());
    expect(sheet.fightLimitMs()).toBe(30_000);
    expect(sheet.floor()).toBe(LEGACY_THREAT.floor());
    expect(sheet.floor()).toBe(6);
  });

  it('draws no random numbers and records no roll when rolls are off', () => {
    const audit = recorder();
    const sheet = sheetPolicy(audit);
    for (const facts of allFacts()) sheet.decide(facts);
    expect(vi.mocked(rngFor)).not.toHaveBeenCalled();
    expect(audit.recordRoll).not.toHaveBeenCalled();
  });

  it('records only deterministic decisions, with no roll event cited, for decisions that use no roll', () => {
    // This pins current behaviour, not equivalence of emitted events. The sheet path records one
    // deterministic decision event per threat decision; today's bot with no character option records none.
    // Outcomes are equal; emitted audit events are not (Deviation 1, ruled by the orchestrator).
    const audit = recorder();
    const sheet = sheetPolicy(audit);
    for (const facts of allFacts()) sheet.decide(facts);
    expect(audit.recordDecision).toHaveBeenCalled();
    for (const [, fields] of audit.recordDecision.mock.calls) {
      expect(fields.kind).toBe('deterministic');
      expect('roll_event_ids' in fields).toBe(false);
    }
  });
});
