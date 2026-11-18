// deploy/scratch/telemetry-rows-nf.sh under sh with a fake docker, a fake rcon-cli, a fake sleep and a synthetic otlp.jsonl.
// Skips (and says so) where sh is not on PATH. Modelled on scratch-rows.test.ts (the Paper driver). The fakes are in scratch-rows-nf-fakes.ts.
import { describe, expect, it, vi } from 'vitest';
import { SH } from './scratch-harness.js';
import { compose, gauge, histo, PROFILE_TEXT, runRows } from './scratch-rows-nf-fakes.js';

if (!SH)
  console.warn(
    'scratch-rows-nf.test.ts: sh is not on PATH, the NeoForge row driver tests are skipped',
  );

vi.setConfig({ maxConcurrency: 64 });

describe.skipIf(!SH)(
  'telemetry-rows-nf.sh: NF10 kill switch and scope',
  { timeout: 900_000 },
  () => {
    const pt = (n: number) => gauge('geldar_players_online', n);
    it.concurrent('NF10 live mode: no points after the edit, points after the restore, no recreate', async () => {
      const r = await runRows(['--only', 'NF10'], { pendingAt: { 4: [pt(0)] } });
      expect(r.out).toMatch(
        /^ROW NF10 PASS got=mode=live points_while_off=0 points_after_restore=1 copy_restored=yes /m,
      );
      expect(r.files).toContain('enabled=false');
      expect(r.profile).toBe(PROFILE_TEXT);
      expect(compose(r)).toHaveLength(0);
    });

    it.concurrent('NF10 restart mode: records continue after a live edit, one recreate applies it, a second restores', async () => {
      const r = await runRows(['--only', 'NF10'], { pendingAt: { 2: [pt(1)], 8: [pt(0)] } });
      expect(r.out).toMatch(
        /^ROW NF10 PASS got=mode=restart points_while_off=0 points_after_restore=1 copy_restored=yes /m,
      );
      expect(compose(r)).toHaveLength(2);
      expect(r.profile).toBe(PROFILE_TEXT);
      expect(r.status).toBe(0);
    });

    it.concurrent('NF10 fails when records never stop or never resume; ledger housekeeping gauges do not count', async () => {
      const still = await runRows(['--only', 'NF10'], {
        pendingAt: { 2: [pt(1)], 5: [pt(1)], 8: [pt(0)] },
      });
      expect(still.out).toMatch(/^ROW NF10 FAIL got=mode=restart points_while_off=1 /m);
      const noResume = await runRows(['--only', 'NF10']);
      expect(noResume.out).toMatch(
        /^ROW NF10 FAIL got=mode=live points_while_off=0 points_after_restore=0 /m,
      );
      const housekeeping = await runRows(['--only', 'NF10'], {
        pendingAt: { 2: [gauge('geldar_ledger_queue_depth', 0)], 4: [pt(0)] },
      });
      expect(housekeeping.out).toMatch(/^ROW NF10 PASS got=mode=live /m);
    });

    it.concurrent('a recreate that fails after a passing preflight is a FAIL; the stack is intact and the profile and copy are restored', async () => {
      const r = await runRows(['--only', 'NF10'], {
        pendingAt: { 2: [pt(1)] },
        env: { FAKE_UP_FAIL: '1' },
      });
      expect(r.out).toMatch(/^ROW NF10 FAIL got=live-edit-ignored restart-failed /m);
      // compose refused before touching the container (StartedAt unchanged): the stack needs no repair, the copy is rewritten and verified
      expect(r.out).not.toContain('ABORT');
      expect(r.out).not.toContain('RESTORE-FAILED');
      expect(r.status).toBe(1);
      expect(r.profile).toBe(PROFILE_TEXT);
    });

    it.concurrent('NF10 skips with env-not-exported when the compose labels are missing (no preflight is possible), touching nothing', async () => {
      const r = await runRows(['--only', 'NF10'], {
        env: { FAKE_CF: '' },
        pendingAt: { 2: [pt(1)] },
      });
      expect(r.out).toMatch(/^ROW NF10 SKIP reason=env-not-exported /m);
      expect(r.out).not.toContain('RESTORE-FAILED');
      expect(r.status).toBe(0);
      expect(r.profile).toBe(PROFILE_TEXT);
      expect(compose(r)).toHaveLength(0);
    });

    it.concurrent('NF10 skips with env-not-exported when compose config fails, touching nothing', async () => {
      const r = await runRows(['--only', 'NF10'], { env: { FAKE_COMPOSE_FAIL: '1' } });
      expect(r.out).toMatch(/^ROW NF10 SKIP reason=env-not-exported /m);
      expect(r.status).toBe(0);
      expect(r.profile).toBe(PROFILE_TEXT);
      expect(r.out).not.toContain('RESTORE-FAILED');
      expect(r.docker.filter((c) => c.startsWith('compose'))).toEqual([
        expect.stringMatching(/ config -q$/),
      ]);
    });

    it.concurrent('NF10 skip names only the first unset variable and leaks no values or other stderr text', async () => {
      const r = await runRows(['--only', 'NF10'], {
        env: {
          FAKE_COMPOSE_FAIL: '1',
          FAKE_COMPOSE_STDERR:
            'level=warning msg="The GELDAR_NF_TESTNAME variable is not set. Defaulting to a blank string."\nlevel=warning msg="The SCRATCH_OTHER variable is not set."\nimage: registry.example/leaky:SECRETVALUE123',
        },
      });
      expect(r.out).toMatch(
        /^ROW NF10 SKIP reason=env-not-exported got=compose-config-failed missing=GELDAR_NF_TESTNAME(\s|$)/m,
      );
      expect(r.out).not.toContain('SCRATCH_OTHER');
      expect(r.out).not.toContain('SECRETVALUE123');
      expect(r.out).not.toContain('Defaulting');
    });

    it.concurrent('a copy write that silently does not land prints RESTORE-FAILED and exits 6, keeping the saved profile', async () => {
      const r = await runRows(['--only', 'NF10'], { env: { FAKE_COPY_SHA: 'b'.repeat(64) } });
      expect(r.out).toMatch(/^RESTORE-FAILED copy_sha=b{64} want=[0-9a-f]{64}$/m);
      expect(r.out).toMatch(/^ABORT reason=copy-not-restored /m);
      expect(r.status).toBe(6);
    });

    it.concurrent('every docker and compose call is project-scoped or on the one label-resolved scratch container', async () => {
      const r = await runRows(['--only', 'NF0,NF2,NF5,NF9A,NF9B,NF9C,NF10,NF11'], {
        pending: T0(),
        pendingAt: { 2: [pt(1)], 8: [pt(0)] },
        env: { FAKE_ONLINE: '1' },
      });
      expect(r.docker.length).toBeGreaterThan(20);
      for (const c of r.docker) {
        const w = c.split(' ');
        const verb = w[0] as string;
        if (verb === 'ps') continue;
        if (verb === 'compose') {
          expect(c, c).toMatch(
            /^compose -p scratch-nf --project-directory \/srv\/geldar\/compose -f \S+phase0\.yml -f \S+scratch-neoforge\.yml (config -q|up -d --no-deps --force-recreate paper)$/,
          );
        } else if (verb === 'inspect') {
          expect(['fake-paper', 'live-nats'], c).toContain(w[w.length - 1]);
        } else if (['pause', 'unpause', 'exec', 'logs'].includes(verb)) {
          expect(w[1] === '-i' ? w[2] : w[1], c).toBe('fake-paper');
        } else {
          expect.fail(`unscoped docker call: ${c}`);
        }
        expect(['stop', 'kill', 'rm', 'restart', 'down']).not.toContain(verb);
        expect(c).not.toMatch(/--force-recreate (?!paper)/);
      }
      const ps = r.docker.filter((c) => c.startsWith('ps') && c.includes('service='));
      expect(ps.length).toBeGreaterThan(0);
      for (const c of ps) expect(c).toContain('label=com.docker.compose.project=scratch-nf');
    });
  },
);

function T0(): string[] {
  return [histo('1700000000000000000', 1000), histo('1700000062500000000', 2250)];
}
