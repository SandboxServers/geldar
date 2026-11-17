// deploy/scratch/telemetry-rows.sh under sh with a fake docker, a fake rcon-cli, a fake sleep and a synthetic otlp.jsonl.
// Skips (and says so) where sh is not on PATH.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTH, JARS, runScript, SH, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ROWS = `${ROOT}deploy/scratch/telemetry-rows.sh`;
const PROFILE_TEXT =
  'enabled=true\ncollector.census.enabled=true\ndisk.area.world.path=/data/world\n';

const FAKES: Record<string, string> = {
  // Appends the pending export lines to the sink, and records the profile as it is at each sleep.
  sleep: `#!/bin/sh
[ -f "$FAKE_DIR/pending.jsonl" ] && cat "$FAKE_DIR/pending.jsonl" >>"$SCRATCH_TELEMETRY_OUT/otlp.jsonl" && rm "$FAKE_DIR/pending.jsonl"
cat "$SCRATCH_ROWS_PROFILE" >>"$FAKE_DIR/profile.seen"
exit 0
`,
  'rcon-cli': `#!/bin/sh
echo "$1" >>"$FAKE_DIR/rcon.log"
case "$1" in
  list) echo "There are 0 of a max of 20 players online:" ;;
  "tick query") echo "Average time per tick: 2.0ms P50: 1.0ms P95: 2.0ms P99: 3.0ms" ;;
  plugins) echo "Server Plugins (2): Ledger, GeldarCore" ;;
  *) echo ok ;;
esac
`,
  docker: `#!/bin/sh
echo "$*" >>"$FAKE_DIR/docker.log"
case "$1" in
  ps)
    case "$*" in
      *service=paper*) echo fake-paper ;;
      *service=otel-sink*) echo fake-sink ;;
      *geldar.scratch*) printf 'fake-paper true\\nfake-sink true\\nlive-nats \\n' ;;
      *) echo "fake-paper Up" ;;
    esac ;;
  inspect)
    case "$*" in
      *StartedAt*)
        n=$(cat "$FAKE_DIR/count" 2>/dev/null || echo 0); n=$((n + 1)); echo $n >"$FAKE_DIR/count"
        if [ "$n" -gt "\${FAKE_RESTART_AFTER:-99999}" ]; then echo 2026-01-02T00:00:00Z; else echo 2026-01-01T00:00:00Z; fi ;;
      *Health*) echo healthy ;;
      *) echo abc ;;
    esac ;;
  exec)
    shift; shift
    case "$1" in
      rcon-cli) exec "$@" ;;
      sh) exit 1 ;;
      du) echo "1000 /data/world" ;;
      cat) echo "nr_throttled 0" ;;
    esac ;;
esac
exit 0
`,
};

type Run = { status: number | null; out: string; files: string; profile: string; dir: string };

function runRows(
  args: string[],
  opts: {
    pending?: string[];
    initial?: string[];
    restartAfter?: number;
    memory?: number;
    avail?: number;
  } = {},
): Run {
  const dir = mkdtempSync(join(tmpdir(), 'rows-'));
  try {
    const bin = join(dir, 'bin');
    const fake = join(dir, 'fake');
    const out = join(dir, 'out');
    const cg = join(dir, 'cg');
    for (const d of [bin, fake, out, cg]) mkdirSync(d);
    for (const [name, text] of Object.entries(FAKES)) {
      writeFileSync(join(bin, name), text);
      chmodSync(join(bin, name), 0o755);
    }
    const profile = join(dir, 'ledger.properties');
    writeFileSync(profile, PROFILE_TEXT);
    writeFileSync(
      join(out, 'otlp.jsonl'),
      `${(opts.initial ?? ['{"resourceMetrics":[]}']).join('\n')}\n`,
    );
    writeFileSync(join(cg, 'memory.current'), `${opts.memory ?? 1000}\n`);
    writeFileSync(join(cg, 'cpu.stat'), 'nr_periods 10\nnr_throttled 3\n');
    const meminfo = join(dir, 'meminfo');
    writeFileSync(meminfo, `MemAvailable: ${opts.avail ?? 99999999} kB\n`);
    if (opts.pending) writeFileSync(join(fake, 'pending.jsonl'), `${opts.pending.join('\n')}\n`);
    const env: Record<string, string> = {
      PATH: `${slash(bin)}${delimiter}${process.env.PATH ?? ''}`,
      HOME: slash(dir),
      XDG_STATE_HOME: slash(join(dir, 'state')),
      FAKE_DIR: slash(fake),
      SCRATCH_TELEMETRY_OUT: slash(out),
      SCRATCH_ROWS_PROFILE: slash(profile),
      SCRATCH_ROWS_CGROUP_DIR: slash(cg),
      SCRATCH_ROWS_MEMINFO: slash(meminfo),
      SCRATCH_REPO_ROOT: slash(ROOT),
    };
    if (opts.restartAfter !== undefined) env.FAKE_RESTART_AFTER = String(opts.restartAfter);
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    const r = spawnSync(SH as string, [slash(ROWS), ...args], { encoding: 'utf8', env });
    const seen = join(fake, 'profile.seen');
    return {
      status: r.status,
      out: r.stdout,
      files: existsSync(seen) ? readFileSync(seen, 'utf8') : '',
      profile: readFileSync(profile, 'utf8'),
      dir,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const histo = (t: string, count: number) =>
  `{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"geldar_tick_lag_ms","histogram":{"dataPoints":[{"timeUnixNano":"${t}","count":"${count}"}]}}]}]}]}`;
const shaLine = (out: string) => /ledger\.properties_sha256 start=(\S+) end=(\S+)/.exec(out);

if (!SH) console.warn('scratch-rows.test.ts: sh is not on PATH, the row driver tests are skipped');

describe.skipIf(!SH)('telemetry-rows.sh', { timeout: 120_000 }, () => {
  it('--list prints every row with its dependencies', () => {
    const r = runRows(['--list']);
    expect(r.status).toBe(0);
    const lines = r.out.trim().split('\n');
    expect(lines.map((l) => l.split(' ')[0])).toEqual(
      'T1 T3 T4 T5 T6 S1 V6 G1 X4 X6 D1 K1 R1 N1 N2 C1 Q1'.split(' '),
    );
    expect(lines).toContain('T5 deps=T4');
    expect(lines).toContain('G1 deps=@census');
    expect(lines).toContain('N2 deps=N1');
  });

  it('T6 is skipped with no spark jar, the line has the contract format, the summary is complete', () => {
    const r = runRows(['--only', 'T6']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^ROW T6 SKIP reason=no-spark-jar got=none want=\S.*$/m);
    const sums = shaLine(r.out);
    expect(sums?.[1]).toBeDefined();
    expect(sums?.[1]).toBe(sums?.[2]);
    expect(r.out).toContain('SUMMARY');
    expect(r.out).toMatch(/memory_current_bytes=1000 cgroup=\S+/);
    expect(r.out).toContain('nr_throttled=3');
    expect(r.out).toContain('tick_query: Average time per tick');
    expect(r.out).toMatch(/node_clock_utc start=\S+Z end=\S+Z/);
  });

  it('T1 passes at 20 histogram counts per second between two exports and fails at 21.7', () => {
    const pass = runRows(['--only', 'T1'], {
      pending: [histo('1700000000000000000', 1000), histo('1700000062500000000', 2250)],
    });
    expect(pass.out).toMatch(/^ROW T1 PASS got=delta=1250 elapsed=62\.5s rate=20\.00\/s want=/m);
    expect(pass.status).toBe(0);
    const fail = runRows(['--only', 'T1'], {
      pending: [histo('1700000000000000000', 1000), histo('1700000060000000000', 2300)],
    });
    expect(fail.out).toMatch(/^ROW T1 FAIL got=delta=1300 elapsed=60\.0s rate=21\.67\/s/m);
    expect(fail.status).toBe(1);
  });

  it('skips only the dependents of a failed row; an independent row still runs', () => {
    const r = runRows(['--only', 'T4,T5,T6']);
    expect(r.out).toMatch(/^ROW T4 FAIL /m);
    expect(r.out).toMatch(/^ROW T5 SKIP reason=dep-failed:T4 /m);
    expect(r.out).toMatch(/^ROW T6 SKIP reason=no-spark-jar /m);
    expect(r.status).toBe(1);
  });

  it('skips a selected row whose dependency was not run', () => {
    const r = runRows(['--only', 'T5']);
    expect(r.out).toMatch(/^ROW T5 SKIP reason=dep-not-run-or-unmet:T4 /m);
  });

  it('aborts when Paper memory.current is above 14 GiB, restores and exits 3', () => {
    const r = runRows(['--only', 'T6'], { memory: 15_032_385_537 });
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/^ABORT reason=paper-memory-current-above-14GiB:15032385537$/m);
    expect(r.out).not.toMatch(/^ROW /m);
    expect(r.out).toContain('SUMMARY');
  });

  it('aborts when MemAvailable is below 30 GiB', () => {
    const r = runRows(['--only', 'T6'], { avail: 31_457_279 });
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/^ABORT reason=node-MemAvailable-below-30GiB:31457279kB$/m);
  });

  it('aborts when a non-scratch container restarts (StartedAt changes)', () => {
    const r = runRows(['--only', 'T6'], { restartAfter: 1 });
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/^ABORT reason=non-scratch-container-restarted-or-gone$/m);
    expect(r.out).not.toMatch(/^ROW /m);
  });

  it('writes the default profile back byte for byte on exit, also when G1 is aborted mid-row', () => {
    const r = runRows(['--only', 'G1'], {
      initial: [
        '{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"geldar_event_count_total","sum":{"dataPoints":[{"asInt":"5"}]}}]}]}]}',
      ],
      restartAfter: 2,
    });
    expect(r.status).toBe(3);
    // The profile really was changed while the row ran, then written back.
    expect(r.files).toContain('collector.census.budget_max_us=1');
    expect(r.profile).toBe(PROFILE_TEXT);
    const sums = shaLine(r.out);
    expect(sums?.[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(sums?.[2]).toBe(sums?.[1]);
  });

  it('prints the compose -f list scratch.sh uses for scratch-telemetry', () => {
    const rows = runRows(['--print-compose-files']);
    const mine = [...rows.out.matchAll(/^-f\n(.+)$/gm)].map((m) =>
      (m[1] as string).split('/').slice(-2).join('/'),
    );
    const call = runScript(['up', 'telemetry'], AUTH, JARS).calls.find(
      (c) => c.startsWith('compose') && c.includes(' up -d'),
    );
    const theirs = [...(call as string).matchAll(/-f (\S+)/g)]
      .map((m) => (m[1] as string).split('/').slice(-2).join('/'))
      .filter((f) => !/nats-auth\.yml|nats-override\.yml/.test(f));
    expect(mine).toEqual(theirs);
    expect(mine).toContain('opt-in/scratch-telemetry.yml');
  });
});
