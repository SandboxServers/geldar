// Tests for the CD-2a delta deploy (deploy/colo-cd.sh and deploy/colo-cd-plan.sh): only the changed services restart, in
// order; a failed health check rolls back; a plugin change is never applied; --dry-run changes nothing; the lock refuses an
// overlapping run; a sql change is dumped before the migrations. The fixture is in colo-cd-fixture.ts.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type Cd,
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

// "needs manual" for a folder the node does not refresh (plugin, compose, caddy, nats) is printed only while the export's
// hash differs from the recorded applied hash. --record-applied writes the record from the node's copy (the src extract).
describe('colo-cd.sh needs manual follows the applied record', () => {
  const PLUGIN = 'plugin jar or plugin config changed';
  const COMPOSE = 'compose config changed';

  // Puts the given files in the node's copy (the src extract) and records the folders there.
  function recordNode(cd: Cd, files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(cd.extract, path)), { recursive: true });
      writeFileSync(join(cd.extract, path), text);
    }
    return cdRun(cd, { args: ['--record-applied'] });
  }

  it('first run with no record reports the folder as before', () => {
    const cd = cdSetup({ 'plugin/paper.jar': 'jar v2\n' });
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`needs manual: ${PLUGIN}`);
  });

  it('does not report a folder whose export matches its recorded hash', () => {
    const cd = cdSetup({ 'plugin/paper.jar': 'jar v2\n', 'compose/compose.yml': 'services: {}\n' });
    const rec = recordNode(cd, { 'plugin/paper.jar': 'jar v2\n' });
    expect(rec.code, rec.out).toBe(0);
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain(PLUGIN);
    // compose has no record, so it is still reported; only the recorded folder is quiet.
    expect(r.out).toContain(`needs manual: ${COMPOSE}`);
  });

  it('reports a folder whose export differs from the recorded hash', () => {
    const cd = cdSetup({ 'plugin/paper.jar': 'jar v2\n' });
    expect(recordNode(cd, { 'plugin/paper.jar': 'jar v1\n' }).code).toBe(0);
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`needs manual: ${PLUGIN}`);
  });

  it('keeps compose/secrets out of the record', () => {
    const cd = cdSetup({});
    expect(recordNode(cd, { 'compose/compose.yml': 'services: {}\n' }).code).toBe(0);
    const before = readText(join(cd.state, 'applied.compose.sha256'));
    expect(recordNode(cd, { 'compose/secrets/key.txt': 'secret\n' }).code).toBe(0);
    expect(readText(join(cd.state, 'applied.compose.sha256'))).toBe(before);
  });

  it('--record-applied with no folder files exits 1 and records nothing', () => {
    const cd = cdSetup({});
    const r = recordNode(cd, {});
    expect(r.code).toBe(1);
    expect(r.out).toContain('nothing recorded');
    expect(existsSync(join(cd.state, 'applied.plugin.sha256'))).toBe(false);
  });
});

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

  it('does not start a stopped golem-body (the idle Adam, decision 0212) and still pulls its image', () => {
    const cd = cdSetup(EDITS, [...CHANGED, 'GELDAR_BODY_IMAGE']);
    const r = cdRun(cd, { env: { FAKE_BODY_STOPPED: '1' } });
    expect(r.code, r.out).toBe(0);
    const log = cdCalls(cd);
    expect(upServices(log)).toEqual(['eventsink', 'glass', 'geldar-mcp']);
    expect(log.some((c) => / up .*golem-body/.test(c))).toBe(false);
    expect(log.filter((c) => / pull /.test(c)).map(lastArg)).toContain('golem-body');
    expect(readText(join(cd.state, 'cd.log'))).toContain('golem-body is not running');
  });

  it('restarts a running golem-body (the idle Adam) last, in restart order', () => {
    const cd = cdSetup(EDITS, [...CHANGED, 'GELDAR_BODY_IMAGE']);
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    expect(upServices(cdCalls(cd))).toEqual(['eventsink', 'glass', 'geldar-mcp', 'golem-body']);
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

  it('--dry-run prints the register kill switch from node.env before the dry-run exit', () => {
    const cd = cdSetup(EDITS, CHANGED);
    writeFileSync(join(cd.state, 'node.env'), 'REGISTER_KILL_SWITCH=false\n');
    const r = cdRun(cd, { dryRun: true });
    expect(r.code, r.out).toBe(0);
    const line = r.out.indexOf('register kill switch: false');
    expect(line, r.out).toBeGreaterThan(-1);
    expect(line).toBeLessThan(r.out.indexOf('dry-run complete'));
  });

  it('refuses a node.env REGISTER_KILL_SWITCH other than true or false before anything changes', () => {
    const cd = cdSetup(EDITS, CHANGED);
    writeFileSync(join(cd.state, 'node.env'), 'REGISTER_KILL_SWITCH=maybe\n');
    const r = cdRun(cd, { dryRun: true });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain('must be exactly true or false');
    expect(r.out).not.toContain('dry-run complete');
    expect(mutating(cdCalls(cd))).toEqual([]);
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
