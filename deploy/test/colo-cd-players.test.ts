// Tests for the per-player host refresh of colo-cd.sh (and the plan lines of colo-cd-plan.sh): a running players-host-*
// container whose image differs from the release body image is stopped and started again after the shared services; a
// current one and a hibernating player are left alone; a failed restart stops the loop, restores the previous image and
// exits 1 (needs manual); --dry-run changes nothing. The fake docker keeps the hosts as files (colo-cd-fixture.ts).
import { describe, expect, it, vi } from 'vitest';
import { cdCalls, cdRun, cdSetup, OLD_HOST_IMAGE, withHosts } from './colo-cd-fixture';

vi.setConfig({ testTimeout: 120_000 });

const EDITS = { 'src/eventsink.txt': 'v2\n' };
const BUMP = ['GELDAR_EVENTSINK_IMAGE'];
const CURRENT_IMAGE = `ghcr.io/sandboxservers/geldar-body@sha256:${'1'.repeat(64)}`;
const N = (id: string) => `geldar-colo-players-host-${id}`;
const hostCalls = (log: string[], verb: RegExp) =>
  log.filter((c) => c.includes('players-host') && verb.test(c));

describe('colo-cd.sh player host refresh', () => {
  it('refreshes a stale host after the shared services and skips current and hibernating ones', () => {
    const cd = cdSetup(EDITS, BUMP);
    const image = withHosts(cd, ['ag-old', 'ag-cur', 'ag-sleep'], {
      'ag-old': OLD_HOST_IMAGE,
      'ag-cur': CURRENT_IMAGE,
    });
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('plan: player host ag-old stale');
    expect(r.out).toContain('plan: player host ag-cur current');
    expect(image('ag-old')).toBe(CURRENT_IMAGE);
    expect(image('ag-cur')).toBe(CURRENT_IMAGE);
    expect(image('ag-sleep')).toBeNull();
    const log = cdCalls(cd);
    expect(log.filter((c) => c === `stop ${N('ag-old')}`)).toHaveLength(1);
    expect(log.some((c) => c.includes(N('ag-cur')) && /^(stop|rm) /.test(c))).toBe(false);
    expect(log.some((c) => c.includes(N('ag-sleep')) && /^(stop|rm) /.test(c))).toBe(false);
    expect(hostCalls(log, / run -d /)).toHaveLength(1);
    const up = log.findIndex((c) => / up -d --no-deps --wait /.test(c));
    expect(log.indexOf(`stop ${N('ag-old')}`)).toBeGreaterThan(up);
  });

  it('does nothing to the hosts when every host is current', () => {
    const cd = cdSetup(EDITS, BUMP);
    withHosts(cd, ['ag-cur'], { 'ag-cur': CURRENT_IMAGE });
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    const log = cdCalls(cd);
    expect(hostCalls(log, / run -d /)).toEqual([]);
    expect(log.some((c) => /^(stop|rm) /.test(c))).toBe(false);
  });

  it('stops the loop on a failed restart, restores the previous image and exits 1', () => {
    const cd = cdSetup(EDITS, BUMP);
    const image = withHosts(cd, ['ag-one', 'ag-two'], {
      'ag-one': OLD_HOST_IMAGE,
      'ag-two': OLD_HOST_IMAGE,
    });
    const r = cdRun(cd, { env: { FAKE_RUN_FAIL: '1' } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('needs manual');
    expect(image('ag-one')).toBe(OLD_HOST_IMAGE);
    expect(image('ag-two')).toBe(OLD_HOST_IMAGE);
    const log = cdCalls(cd);
    // The new image start failed, then the previous-image start; the second host is never touched.
    expect(hostCalls(log, / run -d /)).toHaveLength(2);
    expect(log.some((c) => c === `stop ${N('ag-two')}`)).toBe(false);
  });

  it('treats a host that comes up with the wrong revision label as failed and restores it', () => {
    const cd = cdSetup(EDITS, BUMP);
    const image = withHosts(cd, ['ag-one'], { 'ag-one': OLD_HOST_IMAGE });
    const r = cdRun(cd, { env: { FAKE_BAD_LABEL: '1' } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('needs manual');
    expect(image('ag-one')).toBe(OLD_HOST_IMAGE);
    expect(hostCalls(cdCalls(cd), / run -d /)).toHaveLength(2);
  });

  it('--dry-run lists the stale host and changes nothing', () => {
    const cd = cdSetup(EDITS, BUMP);
    const image = withHosts(cd, ['ag-old'], { 'ag-old': OLD_HOST_IMAGE });
    const r = cdRun(cd, { dryRun: true });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('plan: refresh player host ag-old');
    expect(image('ag-old')).toBe(OLD_HOST_IMAGE);
    expect(cdCalls(cd).some((c) => /^(stop|rm) /.test(c) || / run -d /.test(c))).toBe(false);
  });
});
