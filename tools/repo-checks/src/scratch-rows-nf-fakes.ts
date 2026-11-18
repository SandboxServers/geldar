// Fake docker, rcon-cli and sleep, the runner and the synthetic OTLP builders for scratch-rows-nf.test.ts (the NeoForge row driver).
import { spawn } from 'node:child_process';
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
import { SH, slash } from './scratch-harness.js';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const ROWS = `${ROOT}deploy/scratch/telemetry-rows-nf.sh`;
export const PROFILE_TEXT =
  'enabled=true\ncollector.audit.enabled=true\ncollector.chat.enabled=false\ncollector.tick.enabled=true\n';
export const AGENT_CMD =
  'java -Xmx9G -javaagent:/opt/otel/opentelemetry-javaagent.jar -Dsecret=hunter2 -jar server.jar';

const FAKES: Record<string, string> = {
  // Appends pending.<n>.jsonl (the n-th sleep) and pending.jsonl (the first) to the sink; records the profile at each sleep.
  sleep: `#!/bin/sh
n=0; [ -f "$FAKE_DIR/sleepn" ] && read -r n <"$FAKE_DIR/sleepn"; n=$((n + 1)); echo $n >"$FAKE_DIR/sleepn"
for f in "$FAKE_DIR/pending.$n.jsonl" "$FAKE_DIR/pending.jsonl"; do
  [ "$f" = "$FAKE_DIR/pending.jsonl" ] && [ "$n" -ne 1 ] && continue
  [ -f "$f" ] && cat "$f" >>"$SCRATCH_TELEMETRY_OUT/otlp.jsonl" && rm "$f"
done
cat "$SCRATCH_ROWS_PROFILE" >>"$FAKE_DIR/profile.seen"
[ -n "\${FAKE_VANISH:-}" ] && rm -f "$SCRATCH_ROWS_CGROUP_DIR/memory.current"
exit 0
`,
  'rcon-cli': `#!/bin/sh
echo "$1" >>"$FAKE_DIR/rcon.log"
case "$1" in
  list) echo "There are \${FAKE_ONLINE:-0} of a max of 20 players online: \${FAKE_NAMES:-}" ;;
  "tick query") echo "Average time per tick: 2.0ms P50: 1.0ms P95: 2.0ms P99: 3.0ms" ;;
  "neoforge tps") echo "Overall: mean tick time 2.0 ms, mean TPS 20.0" ;;
  *) echo ok ;;
esac
`,
  docker: `#!/bin/sh
echo "$*" >>"$FAKE_DIR/docker.log"
case "$1" in
  ps)
    case "$*" in
      *service=paper*) echo fake-paper ;;
      *geldar.scratch*)
        n=0; [ -f "$FAKE_DIR/psn" ] && read -r n <"$FAKE_DIR/psn"; n=$((n + 1)); echo $n >"$FAKE_DIR/psn"
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
      *.RW*) echo "\${FAKE_RW:-false}" ;;
      *Mounts*) echo "\${FAKE_MOUNT:-$SCRATCH_ROWS_PROFILE}" ;;
      *StartedAt*)
        n=0; [ -f "$FAKE_DIR/count" ] && read -r n <"$FAKE_DIR/count"; n=$((n + 1)); echo $n >"$FAKE_DIR/count"
        if [ "$n" -gt "\${FAKE_RESTART_AFTER:-99999}" ]; then echo 2026-01-02T00:00:00Z/0; else echo 2026-01-01T00:00:00Z/0; fi ;;
      *Health*) echo healthy ;;
      *.Id*) cat "$FAKE_DIR/cid" 2>/dev/null || echo id1 ;;
      *) echo abc ;;
    esac ;;
  logs) printf '%s\\n' "\${FAKE_LOGS-Geldar Ledger 0.1.0 loaded\nopentelemetry-javaagent - version: 2.33.1}" ;;
  compose)
    [ -n "\${FAKE_COMPOSE_STDERR:-}" ] && printf '%s\\n' "\$FAKE_COMPOSE_STDERR" >&2
    [ -n "\${FAKE_COMPOSE_FAIL:-}" ] && exit 1
    case "$*" in *" up "*) [ -n "\${FAKE_UP_FAIL:-}" ] && exit 1 ;; esac
    # A recreate runs the entrypoint again: it copies the mounted host file over the copy the mod reads.
    case "$*" in *force-recreate*) echo id2 >"$FAKE_DIR/cid"; cp "$SCRATCH_ROWS_PROFILE" "$FAKE_DIR/copy" ;; esac ;;
  exec)
    shift; [ "$1" = -i ] && shift; shift
    case "$1" in
      rcon-cli) exec "$@" ;;
      cat)
        case "$*" in
          *user_jvm_args*) printf '%s' "\${FAKE_JVM_ARGS--Xmx9G -javaagent:/geldar/telemetry/opentelemetry-javaagent.jar}" ;;
          *) printf '%s' "\${FAKE_CMDLINE-}" ;;
        esac ;;
      sha256sum)
        if [ -n "\${FAKE_COPY_SHA:-}" ]; then echo "$FAKE_COPY_SHA  x"; # a copy write that silently did not land
        elif [ -f "$FAKE_DIR/copy" ]; then sha256sum <"$FAKE_DIR/copy" | sed 's/ .*/  x/'; else sha256sum <"$SCRATCH_ROWS_PROFILE" | sed 's/ .*/  x/'; fi ;;
      sh)
        case "$*" in
          *"cat >"*) cat >"$FAKE_DIR/copy" ;;
          *"for f in"*) printf '%s\\n' "\${FAKE_PROCS-}" ;;
          *latest.log*) echo "\${FAKE_LATEST_COUNT-0}" ;;
          *"test -f /data/mods"*) [ -n "\${FAKE_NO_JAR:-}" ] || echo present ;;
          *"test -f"*) [ -n "\${FAKE_NO_PROPS:-}" ] || echo present ;;
          *VmRSS*) [ -n "\${FAKE_NO_RSS:-}" ] || echo "VmRSS: 123456 kB" ;;
        esac ;;
    esac ;;
esac
exit 0
`,
  sha256sum: `#!/bin/sh
n=0; [ -f "$FAKE_DIR/shan" ] && read -r n <"$FAKE_DIR/shan"; n=$((n + 1)); echo $n >"$FAKE_DIR/shan"
if [ "$n" -le 1 ]; then printf '%064d  %s\\n' 1 "$1"; else printf '%064d  %s\\n' 2 "$1"; fi
`,
};

export type Run = {
  status: number | null;
  out: string;
  files: string;
  profile: string;
  docker: string[];
  outFiles: string[];
  log: string;
};
export type Opts = {
  pending?: string[];
  pendingAt?: Record<number, string[]>;
  initial?: string[];
  restartAfter?: number;
  memory?: number;
  limit?: string;
  avail?: number;
  profileText?: string;
  tree?: boolean;
  vanish?: boolean;
  env?: Record<string, string>;
  fakeSha?: boolean;
};

export async function runRows(args: string[], opts: Opts = {}): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), 'rows-nf-'));
  try {
    const bin = join(dir, 'bin');
    const fake = join(dir, 'fake');
    const out = join(dir, 'out');
    const cg = join(dir, 'cg');
    for (const d of [bin, fake, out, cg]) mkdirSync(d);
    for (const [name, text] of Object.entries(FAKES)) {
      if (name === 'sha256sum' && !opts.fakeSha) continue;
      writeFileSync(join(bin, name), text);
      chmodSync(join(bin, name), 0o755);
    }
    const profile = join(dir, 'ledger.properties');
    writeFileSync(profile, opts.profileText ?? PROFILE_TEXT);
    const first = opts.initial ?? ['{"resourceMetrics":[]}'];
    writeFileSync(join(out, 'otlp.jsonl'), first.length ? `${first.join('\n')}\n` : '');
    writeFileSync(join(cg, 'memory.current'), `${opts.memory ?? 1000}\n`);
    writeFileSync(join(cg, 'memory.max'), `${opts.limit ?? '10000'}\n`);
    writeFileSync(join(cg, 'cpu.stat'), 'nr_periods 10\nnr_throttled 3\n');
    const meminfo = join(dir, 'meminfo');
    writeFileSync(meminfo, `MemAvailable: ${opts.avail ?? 99999999} kB\n`);
    if (opts.pending) writeFileSync(join(fake, 'pending.jsonl'), `${opts.pending.join('\n')}\n`);
    for (const [n, lines] of Object.entries(opts.pendingAt ?? {}))
      writeFileSync(join(fake, `pending.${n}.jsonl`), `${lines.join('\n')}\n`);
    const env: Record<string, string> = {
      PATH: `${slash(bin)}${delimiter}${process.env.PATH ?? ''}`,
      HOME: slash(dir),
      FAKE_DIR: slash(fake),
      SCRATCH_TELEMETRY_OUT: slash(out),
      SCRATCH_ROWS_PROFILE: slash(profile),
      SCRATCH_ROWS_MEMINFO: slash(meminfo),
      SCRATCH_ROWS_CGROUP_DIR: slash(cg),
      FAKE_WD: '/srv/geldar/compose',
      FAKE_CF: '/srv/geldar/compose/phase0.yml,/srv/geldar/compose/opt-in/scratch-neoforge.yml',
      FAKE_CMDLINE: AGENT_CMD,
      ...opts.env,
    };
    if (opts.tree) {
      delete env.SCRATCH_ROWS_CGROUP_DIR;
      env.SCRATCH_ROWS_CGROUP_ROOT = slash(join(dir, 'nocg'));
    }
    if (opts.vanish) env.FAKE_VANISH = '1';
    if (opts.restartAfter !== undefined) env.FAKE_RESTART_AFTER = String(opts.restartAfter);
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    const r = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn(SH as string, [slash(ROWS), ...args], {
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      child.on('close', (status) => resolve({ status, stdout }));
    });
    const seen = join(fake, 'profile.seen');
    const dlog = join(fake, 'docker.log');
    const outFiles = readdirSync(out);
    const logName = outFiles.find((f) => f.startsWith('telemetry-rows-nf-'));
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

export const wrap = (metric: string) =>
  `{"resourceMetrics":[{"scopeMetrics":[{"metrics":[${metric}]}]}]}`;
export const histo = (t: string, count: number) =>
  wrap(
    `{"name":"geldar_tick_lag_ms","histogram":{"dataPoints":[{"timeUnixNano":"${t}","count":"${count}"}]}}`,
  );
export const gauge = (name: string, v: number, world?: string) =>
  wrap(
    `{"name":"${name}","gauge":{"dataPoints":[{"asInt":"${v}"${world ? `,"attributes":[{"key":"world","value":{"stringValue":"${world}"}}]` : ''}}]}}`,
  );
export const withRes = (attrs: string) =>
  `{"resourceMetrics":[{"resource":{"attributes":[${attrs}]},"scopeMetrics":[]}]}`;
export const sattr = (k: string, v: string) => `{"key":"${k}","value":{"stringValue":"${v}"}}`;
export const iattr = (k: string, v: number) => `{"key":"${k}","value":{"intValue":"${v}"}}`;
export const SID = '9f1c2d3e-4a5b-4c6d-8e7f-0123456789ab'; // the OTel SDK's per-process service.instance.id
export const GOOD_RES = `${sattr('service.name', 'geldar-neoforge')},${sattr('service.namespace', 'geldar')},${sattr('geldar.shard', 'nf')},${sattr('service.instance.id', SID)}`;
// The real snapshot shape (ConfigSnapshot.java): one geldar.text attribute of `name=value; name=value`.
export const snapText = (...pairs: string[]) => sattr('geldar.text', pairs.join('; '));
export const ev = (name: string, ...attrs: string[]) =>
  `{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"eventName":"${name}","attributes":[${attrs.join(',')}]}]}]}]}`;
export const ULID_A = '01HZX3Q8M6K2V4N7P9R5T1WBCD';
export const ULID_B = '01HZX3Q8M6K2V4N7P9R5T1WBCE';
export const join1 = (s: string) =>
  ev('geldar.player.join', sattr('geldar.life_id', 'ag_nfprobe_01'), sattr('geldar.mc_session', s));
export const quit1 = (s: string) =>
  ev(
    'geldar.player.quit',
    sattr('geldar.life_id', 'ag_nfprobe_01'),
    sattr('geldar.mc_session', s),
    iattr('geldar.duration_ms', 61000),
  );
export const PROBE = { SCRATCH_ROWS_PROBE_CMD: 'echo p0 join ok name=ag_nfprobe_01' };
export const shaLine = (out: string) => /ledger\.properties_sha256 start=(\S+) end=(\S+)/.exec(out);
export const compose = (r: Run) =>
  r.docker.filter((c) => c.startsWith('compose') && !c.endsWith(' config -q')); // the preflight is not a recreate

/** Several runs at once (each in its own temp dir): the script forks a lot, so the suite runs them in parallel. */
export function many(specs: [string[], Opts?][]): Promise<Run[]> {
  return Promise.all(specs.map(([args, opts]) => runRows(args, opts)));
}
