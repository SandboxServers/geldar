// S12-03: at combat level 0 the proficiency bonus is zero, so the all-3 control sheet with rolls off decides
// exactly as today's Body. Tests only; no source file changes.
import { rngFor, STANDARD_SHEET } from '@geldar/psyche';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_THREAT } from '../../src/body/reflexes/threat-policy.ts';
import { lifeThreatPolicy, type ThreatRecorder } from '../../src/character/runtime.ts';

vi.mock('@geldar/psyche', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geldar/psyche')>();
  return { ...actual, rngFor: vi.fn(actual.rngFor) };
});

function recorder() {
  return {
    recordRoll: vi.fn((): string => 'roll-id'),
    recordDecision: vi.fn(),
  } satisfies { [K in keyof ThreatRecorder]: ThreatRecorder[K] };
}

describe('proficiency bonus at level 0 with the all-3 sheet', () => {
  beforeEach(() => {
    vi.mocked(rngFor).mockClear();
  });

  it('reads the combat level at each decision and gives the same decisions as today’s Body', () => {
    const audit = recorder();
    const combatLevel = vi.fn(() => 0 as const);
    const sheet = lifeThreatPolicy({
      sheet: STANDARD_SHEET,
      rolls: false,
      lifeId: 'life-proficiency-equivalence',
      generation: 1,
      tick: () => 200,
      audit,
      combatLevel: () => combatLevel(),
    });
    for (const armed of [false, true]) {
      for (let health = 0; health <= 20; health += 1) {
        const facts = { health, armed, suicideMob: false };
        expect(sheet.decide(facts), JSON.stringify(facts)).toEqual(LEGACY_THREAT.decide(facts));
      }
    }
    expect(combatLevel).toHaveBeenCalled();
    expect(sheet.floor()).toBe(LEGACY_THREAT.floor());
    expect(sheet.fightLimitMs()).toBe(LEGACY_THREAT.fightLimitMs());
    expect(vi.mocked(rngFor)).not.toHaveBeenCalled();
    expect(audit.recordRoll).not.toHaveBeenCalled();
  });
});
