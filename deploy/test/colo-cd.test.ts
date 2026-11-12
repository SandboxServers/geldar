// Tests for the CD-2a delta deploy (deploy/colo-cd.sh and deploy/colo-cd-plan.sh): only the changed services restart, in
// order; a failed health check rolls back; a plugin change is never applied; --dry-run changes nothing; the lock refuses an
// overlapping run; a sql change is dumped before the migrations. The fixture is in colo-cd-fixture.ts.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  cdCalls,
  cdRun,
  cdSetup,
  FROM_SHA,
  lastArg,
  manifest,
  mutating,
  REL_SHA,
  readText,
  upServices,
} from './colo-cd-fixture';

const CHANGED = ['GELDAR_EVENTSINK_IMAGE', 'GELDAR_GLASS_IMAGE', 'GELDAR_MCP_IMAGE'];
const EDITS = { 'src/eventsink.txt': 'v2\n', 'src/glass.txt': 'v2\n', 'src/mcp.txt': 'v2\n' };

// Each run is a shell script with many forks; the file-level limit covers a loaded machine (the fixture limit applies per run).
vi.setConfig({ testTimeout: 120_000 });

describe('colo-cd.sh delta deploy', () => {
  it('restarts only the changed services, in restart order, after every pull', () => {
    const cd = cdSetup(EDITS, CHANGED);
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    const log = cdCalls(cd);
    expect(upServices(log)).toEqual(['eventsink', 'glass', 'geldar-mcp']);
    expect(new Set(mutating(log).map(lastArg))).toEqual(
      new Set(['eventsink', 'glass', 'geldar-mcp']),
    );
    const pulls = log.filter((c) => / pull /.test(c));
    expect(pulls.map(lastArg)).toEqual(['eventsink', 'glass', 'geldar-mcp']);
    const firstUp = log.findIndex((c) => / up -d /.test(c));
    expect(log.indexOf(pulls[pulls.length - 1])).toBeLessThan(firstUp);
    expect(readText(join(cd.state, 'release.env'))).toBe(manifest(CHANGED));
    expect(readText(join(cd.state, 'release.commit')).trim()).toBe(REL_SHA);
    expect(readText(join(cd.extract, 'src/glass.txt'))).toBe('v2\n');
    expect(readdirSync(join(cd.extract, 'src')).some((f) => f.includes('.bak-'))).toBe(true);
  });

  it('rolls back the services already changed after a failed health check and exits 1', () => {
    const cd = cdSetup(EDITS, CHANGED);
    const r = cdRun(cd, { env: { FAKE_UNHEALTHY: 'glass' } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('rolled back after a failed health check on glass');
    const log = cdCalls(cd);
    // geldar-mcp (after the failing service in the order) is never restarted.
    expect(upServices(log)).toEqual(['eventsink', 'glass']);
    expect(log.filter((c) => c.includes('--pull never')).map(lastArg)).toEqual([
      'eventsink',
      'glass',
    ]);
    expect(readText(join(cd.state, 'release.env'))).toBe(manifest());
    expect(readText(join(cd.state, 'previous.env'))).toBe(manifest(CHANGED));
    expect(readText(join(cd.state, 'release.commit')).trim()).toBe(FROM_SHA);
    expect(readText(join(cd.state, 'cd.log'))).toContain('rolled back: eventsink');
  });

  it('prints needs manual for a plugin change and never touches Paper', () => {
    const cd = cdSetup({ 'plugin/paper.jar': 'new jar\n' });
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('needs manual: plugin jar or plugin config changed');
    expect(mutating(cdCalls(cd))).toEqual([]);
    expect(existsSync(join(cd.extract, 'plugin/paper.jar'))).toBe(false);
  });

  it('--dry-run prints the plan and changes nothing', () => {
    const cd = cdSetup(
      { ...EDITS, 'sql/001.sql': 'select 2;\n', 'plugin/paper.jar': 'x\n' },
      CHANGED,
    );
    const r = cdRun(cd, { dryRun: true });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('dry-run complete');
    expect(r.out).toContain('plan: restart eventsink');
    expect(mutating(cdCalls(cd))).toEqual([]);
    expect(readText(join(cd.state, 'release.env'))).toBe(manifest());
    expect(readText(join(cd.state, 'release.commit')).trim()).toBe(FROM_SHA);
    expect(readText(join(cd.extract, 'src/eventsink.txt'))).toBe('v1\n');
    expect(existsSync(join(cd.state, 'cd.lock'))).toBe(false);
    expect(existsSync(join(cd.state, 'cd.log'))).toBe(false);
    expect(existsSync(join(cd.state, 'backups'))).toBe(false);
  });

  it('refuses a second run while the first holds the lock', () => {
    const cd = cdSetup(EDITS, CHANGED);
    mkdirSync(join(cd.state, 'cd.lock'));
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('another colo-cd run holds');
    expect(mutating(cdCalls(cd))).toEqual([]);
    expect(readText(join(cd.state, 'release.env'))).toBe(manifest());
    // The holder's lock is not removed by the refused run.
    expect(existsSync(join(cd.state, 'cd.lock'))).toBe(true);
  });

  it('takes a pg dump before the migrations when sql changed', () => {
    const cd = cdSetup({ 'sql/002.sql': 'create table t();\n' });
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    const log = readText(join(cd.state, 'cd.log'));
    const dumped = log.indexOf('pg dump written before the migrations');
    expect(dumped).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('migrations applied')).toBeGreaterThan(dumped);
    const dumps = readdirSync(join(cd.state, 'backups')).filter((f) => f.startsWith('pre-cd-'));
    expect(dumps).toHaveLength(1);
    expect(readText(join(cd.state, 'backups', dumps[0]))).toContain('pg_dump test output');
    expect(cdCalls(cd).some((c) => / exec -T postgres /.test(c))).toBe(true);
  });
});
