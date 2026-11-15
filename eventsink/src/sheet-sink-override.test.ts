// The opt-in compose override (AN-12b) must name exactly the variables sink-plan.ts reads. It lives under
// compose/opt-in/, outside compose/*.yml, because the CI compose lane and geldar.ps1 validate each compose/*.yml
// as a standalone project, and an override with no image or build context fails that check.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sinkPlan } from './sink-plan.ts';

const OVERRIDE = fileURLToPath(new URL('../../compose/opt-in/sheet-sink.yml', import.meta.url));
const VALIDATED_PATH = fileURLToPath(new URL('../../compose/sheet-sink.yml', import.meta.url));

/** The sink variables sink-plan.ts reads, from its own module (GELDAR_SHEET_SHARD, GELDAR_XP, GELDAR_PROFICIENCY_THRESHOLDS). */
const SINK_ENV = ['GELDAR_SHEET_SHARD', 'GELDAR_XP', 'GELDAR_PROFICIENCY_THRESHOLDS'];

/** The variable names declared as keys in the override, each with an empty value (passed from the host). */
function overrideKeys(): string[] {
  const text = readFileSync(OVERRIDE, 'utf8').replace(/\r\n/g, '\n');
  return [...text.matchAll(/^\s+(GELDAR_[A-Z_]+):\s*$/gm)].map((m) => m[1] ?? '');
}

describe('compose/opt-in/sheet-sink.yml (AN-12b opt-in override)', () => {
  it('declares exactly the sink variables, no more and no fewer', () => {
    expect(overrideKeys().sort()).toEqual([...SINK_ENV].sort());
  });

  it('each declared name is read by sinkPlan under that exact name', () => {
    expect(sinkPlan({ GELDAR_SHEET_SHARD: 'colo' }).shard).toBe('colo');
    expect(sinkPlan({ GELDAR_XP: '1' }).xp.enabled).toBe(true);
    expect(
      sinkPlan({ GELDAR_XP: '1', GELDAR_PROFICIENCY_THRESHOLDS: '5,10,20' }).xp.thresholds,
    ).toEqual([5, 10, 20]);
  });

  it('is not at the validated path compose/sheet-sink.yml', () => {
    expect(existsSync(VALIDATED_PATH)).toBe(false);
  });
});
