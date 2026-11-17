// deploy/scratch/telemetry-rows.sh under sh with a fake docker, a fake rcon-cli, a fake sleep and a synthetic otlp.jsonl.
// Skips (and says so) where sh is not on PATH.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
  // Appends the pending export lines to the sink, records the profile as it is at each sleep, can remove memory.current.
  sleep: `#!/bin/sh
[ -f "$FAKE_DIR/pending.jsonl" ] && cat "$FAKE_DIR/pending.jsonl" >>"$SCRATCH_TELEMETRY_OUT/otlp.jsonl" && rm "$FAKE_DIR/pending.jsonl"
cat "$SCRATCH_ROWS_PROFILE" >>"$FAKE_DIR/profile.seen"
[ -n "\${FAKE_VANISH:-}" ] && rm -f "$SCRATCH_ROWS_CGROUP_DIR/memory.current"
exit 0
`,
  'rcon-cli': `#!/bin/sh
echo "$1" >>"$FAKE_DIR/rcon.log"
case "$1" in
  list) echo "There are 0 of a max of 20 players online:" ;;
  "tick query") echo "Average time per tick: 2.0ms P50: 1.0ms P95: 2.0ms P99: 3.0ms" ;;
  plugins) echo "\${FAKE_PLUGINS-Server Plugins (2): Ledger, GeldarCore}" ;;
  *) echo ok ;;
esac
`,
  // Every call is logged. ps lists the scratch containers and the non-scratch ones from ns.txt (FAKE_NS_AFTER from the
  // FAKE_NS_AFTER_N-th scratch-label listing on). A compose --force-recreate gives paper a new container id.
  docker: `#!/bin/sh
echo "$*" >>"$FAKE_DIR/docker.log"
case "$1" in
  ps)
    case "$*" in
      *service=paper*) echo fake-paper ;;
      *service=otel-sink*) echo fake-sink ;;
      *geldar.scratch*)
        n=$(cat "$FAKE_DIR/psn" 2>/dev/null || echo 0); n=$((n + 1)); echo $n >"$FAKE_DIR/psn"
        printf 'fake-paper true\\nfake-sink true\\n'
        if [ -n "\${FAKE_NS_AFTER_N:-}" ] && [ "$n" -gt "$FAKE_NS_AFTER_N" ]; then
          for c in $FAKE_NS_AFTER; do echo "$c"; done
        else echo live-nats; fi ;;
      *) echo "fake-paper Up" ;;
    esac ;;
  inspect)
    case "$*" in
      *config_files*) echo "$FAKE_CF" ;;
      *working_dir*) echo "$FAKE_WD" ;;
      *Mounts*) echo "\${FAKE_MOUNT:-/x/r1-empty}" ;;
      *StartedAt*)
        n=$(cat "$FAKE_DIR/count" 2>/dev/null || echo 0); n=$((n + 1)); echo $n >"$FAKE_DIR/count"
        if [ "$n" -gt "\${FAKE_RESTART_AFTER:-99999}" ]; then echo 2026-01-02T00:00:00Z/0; else echo 2026-01-01T00:00:00Z/0; fi ;;
      *Health*) echo healthy ;;
      *.Id*) cat "$FAKE_DIR/cid" 2>/dev/null || echo id1 ;;
      *) echo abc ;;
    esac ;;
  logs) printf '%s\\n' "\${FAKE_LOGS:-}" ;;
  compose)
    case "$*" in *force-recreate*) echo id2 >"$FAKE_DIR/cid" ;; esac ;;
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
  // The first call prints one hash and every later call another: the restore at exit cannot be verified.
  sha256sum: `#!/bin/sh
n=$(cat "$FAKE_DIR/shan" 2>/dev/null || echo 0); n=$((n + 1)); echo $n >"$FAKE_DIR/shan"
if [ "$n" -le 1 ]; then printf '%064d  %s\\n' 1 "$1"; else printf '%064d  %s\\n' 2 "$1"; fi
`,
};

type Run = {
  status: number | null;
  out: string;
  files: string;
  profile: string;
  docker: string[];
  outFiles: string[];
  log: string;
};
type Opts = {
  pending?: string[];
  initial?: string[];
  restartAfter?: number;
  memory?: number;
  avail?: number;
  /** A fake checkout with the compose files and the profile in it, labels that match it. */
  repo?: boolean;
  wd?: string;
  /** No cgroup hook: Paper's cgroup is found from the container id under a fake cgroup root. */
  tree?: { id1: boolean; id2: boolean };
  vanish?: boolean;
  agentJar?: boolean;
  plugins?: string;
  logs?: string;
  mount?: string;
  ns?: { after: number; list: string };
  fakeSha?: boolean;
};

function runRows(args: string[], opts: Opts = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'rows-'));
  try {
    const bin = join(dir, 'bin');
    const fake = join(dir, 'fake');
    const out = join(dir, 'out');
    const cg = join(dir, 'cg');
    for (const d of [bin, fake, out, cg]) mkdirSync(d);
    mkdirSync(join(dir, 'state', 'geldar-scratch', 'scratch-telemetry'), { recursive: true });
    for (const [name, text] of Object.entries(FAKES)) {
      if (name === 'sha256sum' && !opts.fakeSha) continue;
      writeFileSync(join(bin, name), text);
      chmodSync(join(bin, name), 0o755);
    }
    let profile = join(dir, 'ledger.properties');
    let root = ROOT;
    const files = ['phase0.yml', 'opt-in/scratch.yml', 'opt-in/scratch-telemetry.yml'];
    if (opts.repo) {
      root = join(dir, 'repo');
      mkdirSync(join(root, 'compose', 'opt-in'), { recursive: true });
      mkdirSync(join(root, 'deploy', 'scratch'), { recursive: true });
      for (const f of files) writeFileSync(join(root, 'compose', f), '');
      profile = join(root, 'deploy', 'scratch', 'ledger.properties');
    }
    writeFileSync(profile, PROFILE_TEXT);
    writeFileSync(
      join(out, 'otlp.jsonl'),
      `${(opts.initial ?? ['{"resourceMetrics":[]}']).join('\n')}\n`,
    );
    writeFileSync(join(cg, 'memory.current'), `${opts.memory ?? 1000}\n`);
    writeFileSync(join(cg, 'cpu.stat'), 'nr_periods 10\nnr_throttled 3\n');
    const cgroot = join(dir, 'cgroot');
    const scope = (id: string, mem: number) => {
      mkdirSync(join(cgroot, 'system.slice', `docker-${id}.scope`), { recursive: true });
      writeFileSync(
        join(cgroot, 'system.slice', `docker-${id}.scope`, 'memory.current'),
        `${mem}\n`,
      );
    };
    mkdirSync(cgroot);
    if (opts.tree?.id1) scope('id1', 1000);
    if (opts.tree?.id2) scope('id2', 2000);
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
      SCRATCH_ROWS_MEMINFO: slash(meminfo),
      SCRATCH_REPO_ROOT: slash(root),
      FAKE_WD: opts.wd ?? `${slash(root)}/compose`,
      FAKE_CF: files.map((f) => `${slash(root)}/compose/${f}`).join(','),
    };
    if (opts.tree) env.SCRATCH_ROWS_CGROUP_ROOT = slash(cgroot);
    else env.SCRATCH_ROWS_CGROUP_DIR = slash(cg);
    if (opts.vanish) env.FAKE_VANISH = '1';
    if (opts.agentJar) env.SCRATCH_OTEL_AGENT_JAR = '/x/agent.jar';
    if (opts.plugins !== undefined) env.FAKE_PLUGINS = opts.plugins;
    if (opts.logs !== undefined) env.FAKE_LOGS = opts.logs;
    if (opts.mount !== undefined) env.FAKE_MOUNT = opts.mount;
    if (opts.ns) {
      env.FAKE_NS_AFTER_N = String(opts.ns.after);
      env.FAKE_NS_AFTER = opts.ns.list;
    }
    if (opts.restartAfter !== undefined) env.FAKE_RESTART_AFTER = String(opts.restartAfter);
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    const r = spawnSync(SH as string, [slash(ROWS), ...args], { encoding: 'utf8', env });
    const seen = join(fake, 'profile.seen');
    const dlog = join(fake, 'docker.log');
    const outFiles = readdirSync(out);
    const logName = outFiles.find((f) => f.startsWith('telemetry-rows-'));
    return {
      status: r.status,
      out: r.stdout,
      files: existsSync(seen) ? readFileSync(seen, 'utf8') : '',
      profile: readFileSync(profile, 'utf8'),
      docker: existsSync(dlog) ? readFileSync(dlog, 'utf8').trim().split('\n') : [],
      outFiles,
      log: logName ? readFileSync(join(out, logName), 'utf8') : '',
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
    expect(r.out).toMatch(/^ABORT reason=non-scratch-container-restarted$/m);
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

const rconRecord = (subtype: string) =>
  `{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"eventName":"geldar.rcon.command","attributes":[{"key":"geldar.command","value":{"stringValue":"say ledger-rcon-1"}},{"key":"geldar.subtype","value":{"stringValue":"${subtype}"}}]}]}]}]}`;
const ups = (r: Run) => r.docker.filter((c) => c.startsWith('compose') && c.includes(' up -d'));
const ARM = { repo: true, agentJar: true, logs: 'agentPresent=false' } as const;

describe.skipIf(!SH)('telemetry-rows.sh: guards, arms and scope', { timeout: 180_000 }, () => {
  it('aborts at start (exit 2) when Paper memory.current cannot be found or reads 0', () => {
    const none = runRows(['--only', 'T6'], { tree: { id1: false, id2: false } });
    expect(none.status).toBe(2);
    expect(none.out).toMatch(/^ABORT reason=no-cgroup-memory-current$/m);
    expect(none.out).not.toMatch(/^ROW /m);
    expect(runRows(['--only', 'T6'], { memory: 0 }).status).toBe(2);
  });

  it('aborts (exit 3) when memory.current vanishes during a row', () => {
    const r = runRows(['--only', 'T1'], { vanish: true });
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/^ABORT reason=paper-memory-current-unreadable$/m);
  });

  it('N1 recreates Paper, finds the new container cgroup, and the exit trap recreates the default stack', () => {
    const r = runRows(['--only', 'N1'], { ...ARM, tree: { id1: true, id2: true } });
    expect(r.out).toMatch(/^ROW N1 PASS /m);
    expect(r.out).toMatch(/memory_current_bytes=2000 cgroup=\S*docker-id2\.scope/);
    const calls = ups(r);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('--force-recreate paper');
    expect(calls[1]).toMatch(/ up -d --no-deps paper$/);
    expect(calls[1]).not.toContain('r1-override');
  });

  it('aborts when the recreated Paper has no cgroup memory.current', () => {
    const r = runRows(['--only', 'N1'], { ...ARM, tree: { id1: true, id2: false } });
    expect(r.status).toBe(3);
    expect(r.out).toMatch(/^ABORT reason=paper-memory-current-unreadable$/m);
    expect(ups(r)).toHaveLength(2); // the arm is still closed on the way out
  });

  it('N1 skips without the agent jar variable; env-mismatch skips R1 and N1 without any recreate', () => {
    expect(runRows(['--only', 'N1'], { repo: true }).out).toMatch(
      /^ROW N1 SKIP reason=agent-jar-not-set-at-start /m,
    );
    const r = runRows(['--only', 'R1,N1'], { ...ARM, wd: '/elsewhere/compose' });
    expect(r.out).toMatch(/^ROW R1 SKIP reason=env-mismatch /m);
    expect(r.out).toMatch(/^ROW N1 SKIP reason=env-mismatch /m);
    expect(ups(r)).toHaveLength(0);
  });

  it('R1 recreates Paper with the override from the sink directory, then the default; fails on an empty plugins reply', () => {
    const ok = runRows(['--only', 'R1'], { repo: true, plugins: 'Server Plugins (1): GeldarCore' });
    expect(ok.out).toMatch(/^ROW R1 PASS got=healthy=yes ledger_in_plugins=0 /m);
    const calls = ups(ok);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/-f \S*\/out\/r1-override\.yml /);
    expect(calls[1]).not.toContain('r1-override');
    expect(ok.outFiles).not.toContain('r1-override.yml'); // removed on exit
    const empty = runRows(['--only', 'R1'], { repo: true, plugins: '' });
    expect(empty.out).toMatch(/^ROW R1 FAIL got=healthy=yes ledger_in_plugins=-1 /m);
    expect(empty.status).toBe(1);
  });

  it('X4 passes only with the rcon subtype attribute', () => {
    const good = runRows(['--only', 'X4'], { pending: [rconRecord('rcon')] });
    expect(good.out).toMatch(/^ROW X4 PASS /m);
    const bad = runRows(['--only', 'X4'], { pending: [rconRecord('console')] });
    expect(bad.out).toMatch(/^ROW X4 FAIL got=found=1 subtype_rcon=0 /m);
  });

  it('X6 skips on an empty sink instead of passing', () => {
    const r = runRows(['--only', 'X6'], { initial: [] });
    expect(r.out).toMatch(/^ROW X6 SKIP reason=empty-sink /m);
  });

  it('a non-scratch container that appears or disappears does not abort; other tenants stay out of the log', () => {
    for (const list of ['live-nats other-new', '']) {
      const r = runRows(['--only', 'T6'], { ns: { after: 2, list } });
      expect(r.status).toBe(0);
      expect(r.out).not.toMatch(/^ABORT/m);
    }
    const r = runRows(['--only', 'T6']);
    expect(r.log).toContain('fake-paper');
    expect(r.log).toContain('non-scratch count=1');
    expect(r.log).not.toContain('live-nats');
    expect(r.outFiles.some((f) => f.startsWith('ledger.properties.orig'))).toBe(false);
  });

  it('keeps the saved profile and exits 4 when the restore cannot be verified', () => {
    const r = runRows(['--only', 'T6'], { fakeSha: true });
    expect(r.status).toBe(4);
    expect(r.out).toMatch(/^ABORT reason=profile-sha256-differs-after-restore saved_profile=\S+$/m);
    expect(r.outFiles.some((f) => f.startsWith('ledger.properties.orig'))).toBe(true);
  });

  it('T3 pauses and unpauses Paper only; the exit trap unpauses the sink after an abort in Q1', () => {
    const t3 = runRows(['--only', 'T3']);
    expect(t3.docker.filter((c) => /^(un)?pause /.test(c))).toEqual([
      'pause fake-paper',
      'unpause fake-paper',
    ]);
    const q1 = runRows(['--only', 'Q1'], { restartAfter: 2 });
    expect(q1.status).toBe(3);
    const pause = q1.docker.indexOf('pause fake-sink');
    expect(pause).toBeGreaterThan(-1);
    expect(q1.docker.indexOf('unpause fake-sink')).toBeGreaterThan(pause);
  });

  it('every docker and compose call is read-only, project-scoped or on the two label-resolved scratch containers', () => {
    const r = runRows(['--only', 'T3,R1,N1,N2,Q1'], {
      ...ARM,
      plugins: 'Server Plugins (1): Ledger',
    });
    expect(r.docker.length).toBeGreaterThan(20);
    const mine = ['fake-paper', 'fake-sink'];
    for (const c of r.docker) {
      const w = c.split(' ');
      const verb = w[0] as string;
      const last = w[w.length - 1] as string;
      if (verb === 'ps') continue;
      if (verb === 'compose') {
        expect(c, c).toMatch(/^compose -p scratch-telemetry /);
        expect(c, c).toMatch(/ (up -d --no-deps (--force-recreate )?paper|config)$/);
      } else if (verb === 'inspect') {
        expect([...mine, 'live-nats'], c).toContain(last);
      } else if (['pause', 'unpause'].includes(verb)) {
        expect(mine, c).toContain(w[1]);
      } else if (['exec', 'logs'].includes(verb)) {
        expect(mine, c).toContain(w[1]);
        if (verb === 'exec' && w[2] === 'rm')
          expect(c).toBe('exec fake-paper rm -f /data/plugins/ledger.jar');
      } else {
        expect.fail(`unscoped docker call: ${c}`);
      }
    }
    const ps = r.docker.filter((c) => c.startsWith('ps') && c.includes('service='));
    for (const c of ps) expect(c).toContain('label=com.docker.compose.project=scratch-telemetry');
  });
});
