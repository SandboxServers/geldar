// deploy/scratch/telemetry-rows-nf.sh under sh with a fake docker, a fake rcon-cli, a fake sleep and a synthetic otlp.jsonl.
// Skips (and says so) where sh is not on PATH. Modelled on scratch-rows.test.ts (the Paper driver). The fakes are in scratch-rows-nf-fakes.ts.
import { describe, expect, it, vi } from 'vitest';
import { SH } from './scratch-harness.js';
import { histo, PROFILE_TEXT, runRows, shaLine } from './scratch-rows-nf-fakes.js';

if (!SH)
  console.warn(
    'scratch-rows-nf.test.ts: sh is not on PATH, the NeoForge row driver tests are skipped',
  );

vi.setConfig({ maxConcurrency: 64 });

describe.skipIf(!SH)('telemetry-rows-nf.sh', { timeout: 900_000 }, () => {
  it.concurrent('--list prints every row with its dependencies, NF11 before NF10', async () => {
    const r = await runRows(['--list']);
    expect(r.status).toBe(0);
    const lines = r.out.trim().split('\n');
    expect(lines.map((l) => l.split(' ')[0])).toEqual(
      'NF0 NF1 NF2 NF3 NF4 NF5 NF6 NF7 NF9A NF9B NF9C NF8 NF11 NF10'.split(' '),
    );
    expect(lines).toContain('NF5 deps=NF2');
    expect(lines).toContain('NF7 deps=NF6');
    expect(lines).toContain('NF10 deps=NF0');
    expect((await runRows(['--only', 'T1'])).status).toBe(2);
  });

  it.concurrent('NF11 has the contract format and the summary is complete', async () => {
    const r = await runRows(['--only', 'NF11']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(
      /^ROW NF11 PASS got=memory_current=1000->1000 limit=10000 nr_throttled=3->3 java_rss_kb=123456 want=\S.*$/m,
    );
    const sums = shaLine(r.out);
    expect(sums?.[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(sums?.[2]).toBe(sums?.[1]);
    expect(r.out).toContain('SUMMARY');
    expect(r.out).toMatch(/memory_current_bytes=1000 cgroup=\S+ limit=10000/);
    expect(r.out).toContain('nr_throttled=3');
    expect(r.out).toContain('tick_query: Average time per tick');
    expect(r.out).toMatch(/node_clock_utc start=\S+Z end=\S+Z/);
    expect(r.out).toContain('shutdown_flush=not-a-row');
    expect((await runRows(['--only', 'NF11'], { env: { FAKE_NO_RSS: '1' } })).out).toMatch(
      /^ROW NF11 FAIL /m,
    );
  });

  it.concurrent('NF2 passes at 20 histogram counts per second and fails at 21.7', async () => {
    const pass = await runRows(['--only', 'NF2'], {
      pending: [histo('1700000000000000000', 1000), histo('1700000062500000000', 2250)],
    });
    expect(pass.out).toMatch(/^ROW NF2 PASS got=delta=1250 elapsed=62\.5s rate=20\.00\/s want=/m);
    const fail = await runRows(['--only', 'NF2'], {
      pending: [histo('1700000000000000000', 1000), histo('1700000060000000000', 2300)],
    });
    expect(fail.out).toMatch(/^ROW NF2 FAIL got=delta=1300 elapsed=60\.0s rate=21\.67\/s/m);
    expect(fail.status).toBe(1);
  });

  it.concurrent('skips only the dependents of a failed row; an independent row still runs', async () => {
    const r = await runRows(['--only', 'NF2,NF5,NF8']);
    expect(r.out).toMatch(/^ROW NF2 FAIL /m);
    expect(r.out).toMatch(/^ROW NF5 SKIP reason=dep-failed:NF2 got=none want=dependency-met$/m);
    expect(r.out).toMatch(/^ROW NF8 PASS /m);
    expect(r.status).toBe(1);
    const env0 = await runRows(['--only', 'NF0,NF1'], { env: { FAKE_CMDLINE: 'java -jar x.jar' } });
    expect(env0.out).toMatch(/^ROW NF0 FAIL /m);
    expect(env0.out).toMatch(/^ROW NF1 SKIP reason=dep-failed:NF0 /m); // a failed environment row blocks the rest
    expect((await runRows(['--only', 'NF5'])).out).toMatch(
      /^ROW NF5 SKIP reason=dep-not-run-or-unmet:NF2 /m,
    );
  });

  it.concurrent('aborts above 90% of the cgroup memory.max, not at it; 14 GiB when there is no numeric limit', async () => {
    const over = await runRows(['--only', 'NF8'], { memory: 901, limit: '1000' });
    expect(over.status).toBe(3);
    expect(over.out).toMatch(/^ABORT reason=neoforge-memory-current-above-90pct-of-limit:901$/m);
    expect(over.out).not.toMatch(/^ROW /m);
    expect(over.out).toContain('SUMMARY');
    expect((await runRows(['--only', 'NF8'], { memory: 900, limit: '1000' })).status).toBe(0);
    expect((await runRows(['--only', 'NF8'], { memory: 2_000_000_000, limit: 'max' })).status).toBe(
      0,
    );
    expect(
      (await runRows(['--only', 'NF8'], { memory: 15_032_385_537, limit: 'max' })).status,
    ).toBe(3);
  });

  it.concurrent('aborts on low MemAvailable, a restarted non-scratch container, a vanished cgroup file', async () => {
    const a = await runRows(['--only', 'NF8'], { avail: 31_457_279 });
    expect(a.status).toBe(3);
    expect(a.out).toMatch(/^ABORT reason=node-MemAvailable-below-30GiB:31457279kB$/m);
    const b = await runRows(['--only', 'NF8'], { restartAfter: 1 });
    expect(b.status).toBe(3);
    expect(b.out).toMatch(/^ABORT reason=non-scratch-container-restarted$/m);
    expect(b.out).not.toMatch(/^ROW /m);
    const c = await runRows(['--only', 'NF2'], { vanish: true });
    expect(c.status).toBe(3);
    expect(c.out).toMatch(/^ABORT reason=neoforge-memory-current-unreadable$/m);
    const none = await runRows(['--only', 'NF8'], { tree: true });
    expect(none.status).toBe(2);
    expect(none.out).toMatch(/^ABORT reason=no-cgroup-memory-current$/m);
  });

  it.concurrent('a non-scratch container that appears or disappears does not abort; other tenants stay out of the log', async () => {
    for (const list of ['live-nats other-new', '']) {
      const r = await runRows(['--only', 'NF8'], {
        env: { FAKE_NS_AFTER_N: '2', FAKE_NS_AFTER: list },
      });
      expect(r.status).toBe(0);
      expect(r.out).not.toMatch(/^ABORT/m);
    }
    const r = await runRows(['--only', 'NF8']);
    expect(r.log).toContain('non-scratch count=1');
    expect(r.log).not.toContain('live-nats');
    expect(r.outFiles.some((f) => f.startsWith('ledger.properties.orig'))).toBe(false);
  });

  it.concurrent('writes the profile back byte for byte when NF10 is aborted mid-row', async () => {
    const r = await runRows(['--only', 'NF10'], { restartAfter: 2 });
    expect(r.status).toBe(3);
    expect(r.files).toContain('enabled=false'); // it really was changed while the row ran
    expect(r.profile).toBe(PROFILE_TEXT);
    const sums = shaLine(r.out);
    expect(sums?.[2]).toBe(sums?.[1]);
  });

  it.concurrent('keeps the saved profile and exits 4 when the restore cannot be verified', async () => {
    const r = await runRows(['--only', 'NF8'], { fakeSha: true });
    expect(r.status).toBe(4);
    expect(r.out).toMatch(/^ABORT reason=profile-sha256-differs-after-restore saved_profile=\S+$/m);
    expect(r.outFiles.some((f) => f.startsWith('ledger.properties.orig'))).toBe(true);
  });
});
