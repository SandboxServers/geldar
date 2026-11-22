/**
 * BLD-19: the seen map never reaches a telemetry path (eventsink, telemetry, glass). The repo scan must find
 * no reference, and every root must be read (a missing root or an empty scan fails, so a rename cannot pass).
 */
import { describe, expect, it } from 'vitest';
import { scanSeenReferences, seenFenceReport, TELEMETRY_ROOTS } from './seen-fence.ts';

describe('scanSeenReferences', () => {
  it('flags an import of the seen module from a telemetry file', () => {
    const src = "import { SeenMap } from '../../golem/src/building/seen/section.ts';\n";
    expect(scanSeenReferences('glass/src/x.ts', src)).toEqual([
      expect.stringContaining('glass/src/x.ts:1: import { SeenMap }'),
    ]);
  });

  it('flags the seen KV bucket by name and by constant', () => {
    expect(scanSeenReferences('eventsink/src/a.ts', "const b = 'geldar-seen';")).toHaveLength(1);
    expect(scanSeenReferences('telemetry/src/b.ts', 'kv.open(SEEN_BUCKET);')).toHaveLength(1);
  });

  it('flags a seen subject spelled with a dot', () => {
    expect(scanSeenReferences('glass/src/c.ts', "subscribe('geldar.seen.x')")).toHaveLength(1);
  });

  it('reports the line number of each hit and passes unrelated text', () => {
    const src = "const a = 1;\nimport { PLAN_BUCKET } from '../../golem/src/building/names.ts';\n";
    expect(scanSeenReferences('glass/src/d.ts', src)).toEqual([]);
    const hits = scanSeenReferences('glass/src/e.ts', 'x\ny\nSEEN_BUCKET\n');
    expect(hits).toEqual(['glass/src/e.ts:3: SEEN_BUCKET']);
  });
});

describe('the repo: seen map never reaches telemetry', () => {
  const report = seenFenceReport();

  it('reads every telemetry root', () => {
    expect(Object.keys(report.files).sort()).toEqual([...TELEMETRY_ROOTS].sort());
    for (const top of TELEMETRY_ROOTS) expect(report.files[top], top).toBeGreaterThan(0);
  });

  it('finds no seen-map reference in eventsink/, telemetry/ or glass/', () => {
    expect(report.hits).toEqual([]);
  });
});
