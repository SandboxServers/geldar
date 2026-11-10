/**
 * The real adapters of the run protocol. Every program runs through execFile with an argument array, never a shell
 * string, and no secret goes on a command line. The SQL side connects as geldar_glass with the password read from a
 * file, and every read runs inside a READ ONLY transaction with a 5 s statement timeout. Nothing here removes a
 * volume: the Postgres and NATS data volumes are only ever restarted, never dropped.
 */
import { execFile, execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import pg from 'pg';
import { newestBenchFile } from './bench-gate.ts';
import { LIFE_ID, type PinnedModel, type Profile, readPins, sha256Hex } from './manifest.ts';
import {
  type Clock,
  type ExecResult,
  type FileStore,
  type Observation,
  type Probe,
  type Processes,
  type ProcessView,
  type Reporter,
  type Runner,
  runPaths,
  type Sampler,
  type Service,
  type Supervisor,
} from './ports.ts';
import { SERVICE_MARKERS } from './safe-stop.ts';
import type { Preflight, PreflightFacts } from './sequence.ts';
import { classifyShardEdit, SHARD_PATH, type ShardEdit } from './shard-edit.ts';
import { parsePrepared, WORLD_VOLUME_ENV, type WorldVolumes } from './world-volume.ts';

const COMPOSE_FILE = 'compose/phase0.yml';
const COMPOSE_PROJECT = 'geldar-phase0';
const OLLAMA = 'http://127.0.0.1:11434';
const SQL_TIMEOUT = '5s';
const RESTART_SERVICES = ['paper', 'velocity', 'eventsink'] as const;

/** Files under the run folder only. A path that resolves outside it is refused before any disk access. */
export function createFileStore(runDir: string): FileStore {
  const root = resolve(runDir);
  const inside = (path: string): string => {
    const full = resolve(path);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`refused: ${path} is outside the run folder`);
    }
    return full;
  };
  return {
    read: (path) => {
      const full = inside(path);
      return existsSync(full) ? readFileSync(full, 'utf8') : null;
    },
    write: (path, text) => {
      const full = inside(path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, 'utf8');
    },
    append: (path, text) => {
      const full = inside(path);
      mkdirSync(dirname(full), { recursive: true });
      appendFileSync(full, text, 'utf8');
    },
  };
}

export function createClock(): Clock {
  return {
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  };
}

/** Runs one program with an argument array. A missing program is a non-zero exit, not a throw. */
export function createRunner(cwd: string): Runner {
  return {
    exec: (file, args) =>
      new Promise<ExecResult>((done) => {
        execFile(
          file,
          [...args],
          { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
          (err, stdout, stderr) => {
            const code = err === null ? 0 : typeof err.code === 'number' ? err.code : 1;
            done({ code, stdout: String(stdout), stderr: String(stderr) });
          },
        );
      }),
  };
}

const PS_PROCESSES =
  "Get-CimInstance Win32_Process | Select-Object ProcessId,@{n='StartedAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}},CommandLine | ConvertTo-Json -Compress";

/** The OS process table (Windows). The signal is graceful first, then forced; a process that already left is not an error. */
export function createProcesses(): Processes {
  return {
    list(): ProcessView[] {
      const out = execFileSync('powershell', ['-NoProfile', '-Command', PS_PROCESSES], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      });
      const parsed: unknown = out.trim() === '' ? [] : JSON.parse(out);
      const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
      return rows.map((r) => ({
        pid: Number(r.ProcessId),
        startedAt: String(r.StartedAt),
        commandLine: String(r.CommandLine ?? ''),
      }));
    },
    signal(pid, force) {
      const args = force ? ['/PID', String(pid), '/F'] : ['/PID', String(pid)];
      try {
        execFileSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
      } catch {
        // The process may already have exited; the orphan check reads the table again.
      }
    },
  };
}

/** The rows a SQL client returns. The glass client and the test fake both fit this. */
export interface SqlClient {
  query(text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Runs the reads inside one READ ONLY transaction with the statement timeout; rolls back on any error. */
export async function readOnly<T>(client: SqlClient, fn: (q: SqlClient) => Promise<T>): Promise<T> {
  await client.query('BEGIN READ ONLY', []);
  try {
    await client.query(`SET LOCAL statement_timeout = '${SQL_TIMEOUT}'`, []);
    const out = await fn(client);
    await client.query('COMMIT', []);
    return out;
  } catch (err) {
    await client.query('ROLLBACK', []).catch(() => undefined);
    throw err;
  }
}

/**
 * The glass reader: the geldar_glass role, the password read from a file here and never logged. The connection is
 * opened on the first query.
 */
export function createGlassClient(env: Record<string, string | undefined>): SqlClient {
  const passwordFile =
    env.GELDAR_GLASS_PG_PASSWORD_FILE ?? join('compose', 'secrets', 'postgres-glass.txt');
  let client: pg.Client | null = null;
  return {
    async query(text, params) {
      if (client === null) {
        client = new pg.Client({
          host: '127.0.0.1',
          port: Number(env.GELDAR_GLASS_PG_PORT ?? 5432),
          user: 'geldar_glass',
          database: env.GELDAR_GLASS_PG_DB ?? 'geldar',
          password: readFileSync(passwordFile, 'utf8').trim(),
        });
        await client.connect();
      }
      const res = await client.query(text, params);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
}

export interface SamplerDeps {
  runner: Runner;
  sql: SqlClient;
  processes: Processes;
  clock: Clock;
  lifeId: () => string;
  repoRoot: string;
}

/** One status sample. TPS is null: no reader of the Golem's tick rate exists yet, so the TPS rule skips. */
export function createSampler(deps: SamplerDeps): Sampler {
  const composePs = async (): Promise<Record<string, string>> => {
    const res = await deps.runner.exec('docker', [
      'compose',
      '-f',
      COMPOSE_FILE,
      '-p',
      COMPOSE_PROJECT,
      'ps',
      '--format',
      'json',
    ]);
    if (res.code !== 0) throw new Error(`docker compose ps exited ${res.code}`);
    const text = res.stdout.trim();
    const rows: Record<string, unknown>[] =
      text === ''
        ? []
        : text.startsWith('[')
          ? JSON.parse(text)
          : text.split('\n').map((l) => JSON.parse(l));
    return Object.fromEntries(rows.map((r) => [String(r.Service), String(r.State)]));
  };
  const ollamaUp = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  };
  return {
    async observe(): Promise<Observation> {
      const atMs = deps.clock.nowMs();
      const lifeId = deps.lifeId();
      const procs = deps.processes.list();
      const running = (service: Service): boolean =>
        procs.some((p) => {
          const line = p.commandLine.replace(/\\/g, '/');
          return SERVICE_MARKERS.some((m) => line.includes(m)) && line.includes(service);
        });
      const states = await composePs();
      const stackUp = (name: string): boolean => states[name] === 'running';
      const gpu = await deps.runner.exec('nvidia-smi', [
        '--query-gpu=name',
        '--format=csv,noheader',
      ]);
      const disk = statfsSync(deps.repoRoot);
      const sql = await readOnly(deps.sql, async (q) => {
        const t = await q.query(
          'SELECT count(*)::int AS n, max(at) AS last FROM thoughts WHERE life_id = $1',
          [lifeId],
        );
        const p95 = await q.query(
          "SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p FROM thoughts WHERE life_id = $1 AND at > now() - interval '30 minutes'",
          [lifeId],
        );
        const d = await q.query(
          'SELECT count(*)::int AS n FROM agents WHERE agent_id = $1 AND died_at IS NOT NULL',
          [lifeId],
        );
        const i = await q.query(
          "SELECT intent_id FROM intents WHERE life_id = $1 AND state IN ('accepted','running') ORDER BY started_tick DESC NULLS LAST LIMIT 1",
          [lifeId],
        );
        return { t: t.rows[0], p95: p95.rows[0], d: d.rows[0], i: i.rows[0] };
      });
      const lastAt = sql.t?.last;
      const p95 = sql.p95?.p;
      const alive: Record<Probe, boolean> = {
        animus: running('animus'),
        body: running('body'),
        'lantern-local': running('lantern-local'),
        ollama: await ollamaUp(),
        postgres: stackUp('postgres'),
        nats: stackUp('nats'),
        paper: stackUp('paper'),
      };
      return {
        atMs,
        lifeId,
        alive,
        thoughts: Number(sql.t?.n ?? 0),
        lastThoughtAtMs: lastAt instanceof Date ? lastAt.getTime() : null,
        tps: null,
        latencyP95Ms: p95 === null || p95 === undefined ? null : Number(p95),
        activeIntentId: sql.i?.intent_id === undefined ? null : String(sql.i.intent_id),
        deaths: Number(sql.d?.n ?? 0),
        gpuPresent: gpu.code === 0 && gpu.stdout.trim() !== '',
        diskFreeGb: (Number(disk.bavail) * Number(disk.bsize)) / 1e9,
        bodyConnected: alive.body,
        errorsSinceLast: 0,
      };
    },
  };
}

/** The supervisor actions, through the repo's own adam CLI and a compose restart that never touches the data volumes. */
export function createSupervisor(runner: Runner, repoRoot: string): Supervisor {
  const adam = (args: string[]): Promise<ExecResult> =>
    runner.exec('node', [join(repoRoot, 'tools', 'adam-cli', 'src', 'cli.ts'), ...args]);
  const check = (res: ExecResult, what: string): void => {
    if (res.code !== 0) throw new Error(`${what} exited ${res.code}`);
  };
  return {
    async up() {
      check(await adam(['up']), 'adam up');
    },
    async restartStack() {
      check(
        await runner.exec('docker', [
          'compose',
          '-f',
          COMPOSE_FILE,
          '-p',
          COMPOSE_PROJECT,
          'restart',
          ...RESTART_SERVICES,
        ]),
        'docker compose restart',
      );
    },
    async restartBody() {
      // `restart-body` ends only the Body and starts a fresh one: nothing else restarts a killed Body process.
      check(await adam(['restart-body']), 'adam restart-body');
    },
    async stop(service) {
      // adam-cli's `down` stops the whole stack, so this is one call for every service in the stop order.
      check(await adam(['down']), `adam down (for ${service})`);
    },
  };
}

/** Calls the W6-12 report generator on the run folder, writing run-report.json and run-report.md there. */
export function createReporter(
  runner: Runner,
  repoRoot: string,
  runDir: string,
  files: FileStore,
  clock: Clock,
  lifeOf: (profile: Profile) => string,
  profile: Profile,
): Reporter {
  const paths = runPaths(runDir);
  return {
    async reportRun() {
      const manifest = JSON.parse(files.read(paths.manifest) ?? '{}') as { startedAt?: string };
      if (manifest.startedAt === undefined)
        throw new Error('report: manifest.json has no startedAt');
      const res = await runner.exec('node', [
        join(repoRoot, 'tools', 'adam-report', 'src', 'cli.ts'),
        '--life',
        lifeOf(profile),
        '--from',
        manifest.startedAt,
        '--to',
        new Date(clock.nowMs()).toISOString(),
        '--manifest',
        paths.manifest,
        '--out',
        runDir,
        '--format',
        'both',
      ]);
      if (res.code !== 0) throw new Error(`adam-report exited ${res.code}`);
    },
  };
}

/** The file names in a folder; none when the folder is missing. */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The gate's facts: git, the newest bench result, the pins, the Ollama tags and loaded models, the prepared volume. */
export function createPreflight(opts: {
  runner: Runner;
  repoRoot: string;
  runDir: string;
  profile: Profile;
  criteriaText: string;
  files: FileStore;
  worldVolumes: WorldVolumes;
  env: Record<string, string | undefined>;
}): Preflight {
  const fetchJson = async (path: string): Promise<Record<string, unknown>> => {
    const res = await fetch(`${OLLAMA}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  return {
    async gather(): Promise<PreflightFacts> {
      const head = await opts.runner.exec('git', ['rev-parse', 'HEAD']);
      const status = await opts.runner.exec('git', ['status', '--porcelain']);
      if (head.code !== 0 || status.code !== 0)
        throw new Error('git could not report HEAD or the tree');
      const shardYaml = readFileSync(join(opts.repoRoot, 'shards', 'phase0.yaml'), 'utf8');
      // The shard file may carry the tier select's edit; any other change to the tree is refused by the gate.
      const changed = status.stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => line.slice(3).trim());
      const otherChanges = changed.filter((path) => path !== SHARD_PATH);
      let shardEdit: ShardEdit = { kind: 'none' };
      let shardCommittedSha256: string | null = null;
      if (changed.includes(SHARD_PATH)) {
        const committed = await opts.runner.exec('git', ['show', `HEAD:${SHARD_PATH}`]);
        if (committed.code !== 0) throw new Error(`git could not read the committed ${SHARD_PATH}`);
        shardEdit = classifyShardEdit(committed.stdout, shardYaml);
        shardCommittedSha256 = sha256Hex(committed.stdout);
      }
      const pins: PinnedModel[] = readPins(shardYaml);
      const benchDir = join(opts.repoRoot, 'bench-results');
      const benchFile = newestBenchFile(listDir(benchDir));
      // The bench folder sits outside the run folder, so it is read through a store rooted there.
      const benchText =
        benchFile === null ? null : createFileStore(benchDir).read(join(benchDir, benchFile));
      // Smoke runs use no world volume. 32B and 8B read the record prepare-volume wrote to the run folder.
      const prepared =
        opts.profile === 'smoke'
          ? null
          : parsePrepared(opts.files.read(runPaths(opts.runDir).manifest));
      const volume =
        prepared === null ? null : await opts.worldVolumes.inspect(prepared.worldVolume);
      const tags = (await fetchJson('/api/tags')) as {
        models?: { name: string; digest: string }[];
      };
      const ps = (await fetchJson('/api/ps')) as { models?: { name: string }[] };
      const observedDigests: Record<string, string | null> = {};
      for (const m of tags.models ?? []) observedDigests[m.name] = m.digest;
      return {
        facts: {
          profile: opts.profile,
          headSha: head.stdout.trim(),
          otherChanges,
          shardEdit,
          bench:
            benchFile === null || benchText === null ? null : { file: benchFile, text: benchText },
          pins,
          observedDigests,
          loadedModels: (ps.models ?? []).map((m) => m.name),
          prepared,
          volume,
          worldVolumeEnv: opts.env[WORLD_VOLUME_ENV],
          lifeId: LIFE_ID[opts.profile],
        },
        shardConfigSha256: sha256Hex(shardYaml),
        shardCommittedSha256,
        criteriaSha256: sha256Hex(opts.criteriaText),
      };
    },
  };
}
