/**
 * BLD-19 (decision 0429): no agent-facing module imports Glass plan activity or reads the Glass feed subject.
 * The repo scan must find nothing, and every agent root must be read.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_ROOTS,
  FEED_SUBJECT_ACL_TESTS,
  planActivityFenceReport,
  scanPlanActivityReferences,
} from './plan-activity-fence.ts';

const ACL_FILE = 'threshold/mcp/test/nats-auth.it.test.ts';
const FEED_LINE = "const feed = 'geldar.alpha.kino.steve_bot.feed';\n";
const roots: string[] = [];

/** A fake repo with every agent root present; `files` maps a repo-relative path to its text. */
function fakeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'bld19-fence-'));
  roots.push(root);
  for (const top of AGENT_ROOTS) mkdirSync(join(root, top), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('scanPlanActivityReferences', () => {
  it('flags an import of the Glass plan-activity module', () => {
    const src = "import { renderPlanActivity } from '../../glass/src/plan-activity/index.ts';\n";
    expect(scanPlanActivityReferences('threshold/mcp/src/x.ts', src)).toEqual([
      expect.stringContaining('threshold/mcp/src/x.ts:1: plan-activity module:'),
    ]);
  });

  it('flags an import of a Glass kino module', () => {
    const src = "import { feedSubject } from '../../glass/src/kino/nats-feed.ts';\n";
    expect(scanPlanActivityReferences('animus/src/y.ts', src)).toEqual([
      expect.stringContaining('animus/src/y.ts:1: Glass kino module import:'),
    ]);
  });

  it('flags the Glass feed subject, spelled as a template or a literal', () => {
    expect(
      scanPlanActivityReferences('golem/src/z.ts', 'return `geldar.alpha.kino.bot.feed`;'),
    ).toHaveLength(1);
    expect(
      scanPlanActivityReferences('player-core/w.ts', "const s = 'geldar.a.kino.b.feed';"),
    ).toHaveLength(1);
  });

  it('passes the Body and MCP text that does not touch Glass', () => {
    const src =
      "import { BUILDING_REFUSAL } from './building/names.ts';\nconst s = 'geldar.shard.body.snapshot';\n";
    expect(scanPlanActivityReferences('golem/src/ok.ts', src)).toEqual([]);
  });
});

describe('planActivityFenceReport on a fixture repo', () => {
  it('passes a clean tree', () => {
    expect(
      planActivityFenceReport(fakeRepo({ 'golem/src/a.ts': 'export const a = 1;\n' })).hits,
    ).toEqual([]);
  });

  it('fails an agent-facing file that imports the plan-activity module (the revert fixture)', () => {
    const root = fakeRepo({
      'animus/src/bad.ts': "import '../../glass/src/plan-activity/index.ts';\n",
    });
    const hits = planActivityFenceReport(root).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('animus/src/bad.ts:1: plan-activity module');
  });

  it('exempts the ACL test up to its exact allowance of feed-subject lines', () => {
    expect(FEED_SUBJECT_ACL_TESTS[ACL_FILE]).toBe(3);
    const at = fakeRepo({ [ACL_FILE]: FEED_LINE.repeat(3) });
    expect(planActivityFenceReport(at).hits).toEqual([]);
  });

  it('fails the ACL test once it has one feed-subject line more than its allowance', () => {
    const over = fakeRepo({ [ACL_FILE]: FEED_LINE.repeat(4) });
    const hits = planActivityFenceReport(over).hits;
    expect(hits).toHaveLength(4);
    expect(hits.every((hit) => hit.includes('Glass feed subject'))).toBe(true);
  });

  it('never exempts an import from the ACL test allowance', () => {
    const bad = fakeRepo({
      [ACL_FILE]: `${FEED_LINE.repeat(3)}import '../../glass/src/kino/nats-feed.ts';\n`,
    });
    const hits = planActivityFenceReport(bad).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('Glass kino module import');
  });
});

describe('the repo: agent-facing code never reads Glass plan activity', () => {
  const report = planActivityFenceReport();

  it('reads every agent-facing root', () => {
    expect(Object.keys(report.files).sort()).toEqual([...AGENT_ROOTS].sort());
    for (const top of AGENT_ROOTS) expect(report.files[top], top).toBeGreaterThan(0);
  });

  it('finds no plan-activity import, Glass kino import or feed subject in agent-facing code', () => {
    expect(report.hits).toEqual([]);
  });
});
