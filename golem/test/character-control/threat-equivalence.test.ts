// S12-03: the all-3 control sheet with rolls off decides exactly as today's Body (LEGACY_THREAT, the
// policy the Body uses when `character` is omitted). Tests only; no source file changes.
import { rngFor, STANDARD_SHEET } from '@geldar/psyche';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_THREAT, type ThreatFacts } from '../../src/body/reflexes/threat-policy.ts';
import { lifeThreatPolicy, type ThreatRecorder } from '../../src/character/runtime.ts';
import { ALWAYS_HOSTILE } from '../../src/perception/hostile-types.ts';

vi.mock('@geldar/psyche', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geldar/psyche')>();
  return { ...actual, rngFor: vi.fn(actual.rngFor) };
});

const HEALTHS = Array.from({ length: 21 }, (_, i) => i);
const HOSTILE_NAMES = [...ALWAYS_HOSTILE];

function recorder() {
  return {
    recordRoll: vi.fn((): string => 'roll-id'),
    recordDecision: vi.fn(),
  } satisfies { [K in keyof ThreatRecorder]: ThreatRecorder[K] };
}

function sheetPolicy(audit: ThreatRecorder) {
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

/** Every fact combination the reflexes can ask: health 0 to 20, armed or not, every always-hostile name. */
function allFacts(): Array<{ name: string; facts: ThreatFacts }> {
  const out: Array<{ name: string; facts: ThreatFacts }> = [];
  for (const name of HOSTILE_NAMES) {
    for (const armed of [false, true]) {
      for (const health of HEALTHS) {
        out.push({ name, facts: { health, armed, suicideMob: name === 'creeper' } });
      }
    }
  }
  return out;
}

describe('the all-3 sheet with rolls off equals today’s Body', () => {
  beforeEach(() => {
    vi.mocked(rngFor).mockClear();
  });

  it('decides the same as LEGACY_THREAT over health 0 to 20, armed and unarmed, for every hostile name', () => {
    const audit = recorder();
    const sheet = sheetPolicy(audit);
    for (const { facts } of allFacts()) {
      expect(sheet.decide(facts), JSON.stringify(facts)).toEqual(LEGACY_THREAT.decide(facts));
    }
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
    for (const { facts } of allFacts()) sheet.decide(facts);
    expect(vi.mocked(rngFor)).not.toHaveBeenCalled();
    expect(audit.recordRoll).not.toHaveBeenCalled();
  });

  it('records only deterministic decisions, with no roll event cited, for decisions that use no roll', () => {
    const audit = recorder();
    const sheet = sheetPolicy(audit);
    for (const { facts } of allFacts()) sheet.decide(facts);
    expect(audit.recordDecision).toHaveBeenCalled();
    for (const [, fields] of audit.recordDecision.mock.calls) {
      expect(fields.kind).toBe('deterministic');
      expect('roll_event_ids' in fields).toBe(false);
    }
  });
});
