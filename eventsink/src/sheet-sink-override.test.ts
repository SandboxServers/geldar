// The opt-in compose override (AN-12b) must name exactly the variables sink-plan.ts reads. It lives under
// compose/opt-in/, outside compose/*.yml, because the CI compose lane and geldar.ps1 validate each compose/*.yml
// as a standalone project, and an override with no image or build context fails that check.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sinkPlan } from './sink-plan.ts';

const OVERRIDE = fileURLToPath(new URL('../../compose/opt-in/sheet-sink.yml', import.meta.url));
const VALIDATED_PATH = fileURLToPath(new URL('../../compose/sheet-sink.yml', import.meta.url));
const COLO = fileURLToPath(new URL('../../compose/colo.yml', import.meta.url));

/** The sink variables sink-plan.ts reads, from its own module (GELDAR_SHEET_SHARD, GELDAR_XP, GELDAR_PROFICIENCY_THRESHOLDS). */
const SINK_ENV = ['GELDAR_SHEET_SHARD', 'GELDAR_XP', 'GELDAR_PROFICIENCY_THRESHOLDS'];

/** The text of the eventsink service in compose/colo.yml: from its key to the next two-space service key. */
function coloEventsink(): string {
  const text = readFileSync(COLO, 'utf8').replace(/\r\n/g, '\n');
  const start = text.search(/^  eventsink:$/m);
  if (start < 0) throw new Error('no eventsink service in compose/colo.yml');
  const after = text.slice(start + 1).search(/^  [a-z][\w-]*:$/m);
  return after < 0 ? text.slice(start) : text.slice(start, start + 1 + after);
}

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

describe('compose/colo.yml passes the sink variables through empty (AN-12b, node env file)', () => {
  it('the eventsink service carries each variable once, as an empty pass-through', () => {
    const block = coloEventsink();
    for (const name of SINK_ENV) {
      expect(block.split(`${name}: "\${${name}:-}"`).length - 1, name).toBe(1);
    }
  });
});
