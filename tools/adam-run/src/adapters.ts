/**
 * The real adapters of the run protocol. Every program runs through execFile with an argument array, never a shell
 * string, and no secret goes on a command line. The SQL side connects as geldar_glass with the password read from a
 * file, and every read runs inside a READ ONLY transaction with a 5 s statement timeout. Nothing here removes a
 * volume: the Postgres and NATS data volumes are only ever restarted, never dropped.
 */
import { execFile, execFileSync } from 'node:child_process';
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { newestBenchFile } from './bench-gate.ts';
import { stderrTail } from './child-error.ts';
import { readOnly, type SqlClient } from './glass-client.ts';
import {
  LIFE_ID,
  type PinnedModel,
  type Profile,
  readPins,
  readSeed,
  sha256Hex,
} from './manifest.ts';
import {
  type Clock,
  type ExecResult,
  type FileStore,
  type Processes,
  type ProcessView,
  type Reporter,
  type Runner,
  runPaths,
  type Supervisor,
} from './ports.ts';
import type { LifeRows } from './preconditions.ts';
import type { Preflight, PreflightFacts } from './sequence.ts';
import { classifyShardEdit, mindLifeOf, SHARD_PATH, type ShardEdit } from './shard-edit.ts';
import { COMPOSE_FILE, COMPOSE_PROJECT, OLLAMA } from './stack-endpoints.ts';
import { parsePrepared, WORLD_VOLUME_ENV, type WorldVolumes } from './world-volume.ts';

export { createGlassClient, readOnly, type SqlClient } from './glass-client.ts';
export { BODY_EVENT_GRACE_MS, createSampler, type SamplerDeps } from './sampler.ts';

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
      // Write a sibling temp file, then rename it over the target, so a failed write leaves the old file whole.
      const full = inside(path);
      mkdirSync(dirname(full), { recursive: true });
      const temp = `${full}.tmp`;
      try {
        writeFileSync(temp, text, 'utf8');
        renameSync(temp, full);
      } catch (error) {
        try {
          rmSync(temp, { force: true });
        } catch {
          // Not a file we can remove; the write error is the one to report.
        }
        throw error;
      }
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
    exec: (file, args, env, timeoutMs = EXEC_TIMEOUT_MS) =>
      new Promise<ExecResult>((done) => {
        execFile(
          file,
          [...args],
          {
            cwd,
            windowsHide: true,
            maxBuffer: 64 * 1024 * 1024,
            timeout: timeoutMs,
            env: env === undefined ? undefined : { ...process.env, ...env },
          },
          (err, stdout, stderr) => {
            if (err?.killed) {
              done({
                code: TIMEOUT_CODE,
                stdout: String(stdout),
                stderr: `timed out after ${timeoutMs} ms`,
              });
              return;
            }
            const code = err === null ? 0 : typeof err.code === 'number' ? err.code : 1;
            done({ code, stdout: String(stdout), stderr: String(stderr) });
          },
        );
      }),
  };
}

/** A child that runs past its timeout is killed; 124 is the exit code of the `timeout` command for the same case. */
const TIMEOUT_CODE = 124;
/** Every program but `adam up` gets 60 s; `adam up` waits for Paper and gets 600 s. */
export const EXEC_TIMEOUT_MS = 60_000;
export const ADAM_UP_TIMEOUT_MS = 600_000;

const PS_PROCESSES =
  "Get-CimInstance Win32_Process | Select-Object ProcessId,@{n='StartedAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}},CommandLine | ConvertTo-Json -Compress";

/** The OS process table (Windows). The signal is graceful first, then forced; a process that already left is not an error. */
export function createProcesses(): Processes {
  return {
    list(): ProcessView[] {
      // A timeout throws, and the sampler counts that as a failed sample.
      const out = execFileSync('powershell', ['-NoProfile', '-Command', PS_PROCESSES], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        timeout: EXEC_TIMEOUT_MS,
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

/** The supervisor actions, through the repo's own adam CLI and a compose restart that never touches the data volumes. */
export function createSupervisor(runner: Runner, repoRoot: string): Supervisor {
  const adam = (args: string[], timeoutMs?: number): Promise<ExecResult> =>
    runner.exec(
      'node',
      [join(repoRoot, 'tools', 'adam-cli', 'src', 'cli.ts'), ...args],
      undefined,
      timeoutMs,
    );
  const check = (res: ExecResult, what: string): void => {
    if (res.code === 0) return;
    const tail = stderrTail(res.stderr);
    throw new Error(`${what} exited ${res.code}${tail === '' ? '' : `: ${tail}`}`);
  };
  return {
    async up() {
      check(await adam(['up'], ADAM_UP_TIMEOUT_MS), 'adam up');
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

/**
 * The glass password file: GELDAR_GLASS_PG_PASSWORD_FILE when set, else compose/secrets/postgres-glass.txt under the
 * repo root. Only the path is returned; the file is never read here.
 */
export function glassPasswordFile(
  repoRoot: string,
  env: Record<string, string | undefined>,
): string {
  return (
    env.GELDAR_GLASS_PG_PASSWORD_FILE ?? join(repoRoot, 'compose', 'secrets', 'postgres-glass.txt')
  );
}

/**
 * The secret files a start needs (compose/phase0.yml mounts the first three; the glass file is the reader's): the
 * shard's Postgres, the RCON password, the Velocity forwarding secret, and the glass reader's password.
 */
export function startSecretPaths(
  repoRoot: string,
  env: Record<string, string | undefined>,
): string[] {
  const dir = join(repoRoot, 'compose', 'secrets');
  return [
    join(dir, 'postgres.txt'),
    glassPasswordFile(repoRoot, env),
    join(dir, 'rcon.txt'),
    join(dir, 'velocity-forwarding.txt'),
  ];
}

/** The paths that are missing or cannot be read. Only access is checked: no file is opened, so no contents are read. */
export function unreadablePaths(paths: string[]): string[] {
  return paths.filter((p) => {
    try {
      accessSync(p, constants.R_OK);
      return false;
    } catch {
      return true;
    }
  });
}

/** The variables adam-report reads (tools/adam-report/src/db.ts): the glass role, its password file, and the DB address. */
function reportEnv(
  passwordFile: string,
  env: Record<string, string | undefined>,
): Record<string, string> {
  return {
    GELDAR_REPORT_DB_PASSWORD_FILE: passwordFile,
    GELDAR_REPORT_DB_USER: 'geldar_glass',
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: env.GELDAR_GLASS_PG_PORT ?? '5432',
    POSTGRES_DB: env.GELDAR_GLASS_PG_DB ?? 'geldar',
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
  env: Record<string, string | undefined>,
): Reporter {
  const paths = runPaths(runDir);
  return {
    async reportRun() {
      const manifest = JSON.parse(files.read(paths.manifest) ?? '{}') as { started_at?: string };
      if (manifest.started_at === undefined)
        throw new Error('report: manifest.json has no started_at');
      const passwordFile = glassPasswordFile(repoRoot, env);
      if (!existsSync(passwordFile))
        throw new Error(`report: glass password file is missing: ${passwordFile}`);
      const res = await runner.exec(
        'node',
        [
          join(repoRoot, 'tools', 'adam-report', 'src', 'cli.ts'),
          '--life',
          lifeOf(profile),
          '--from',
          manifest.started_at,
          '--to',
          new Date(clock.nowMs()).toISOString(),
          '--manifest',
          paths.manifest,
          '--out',
          runDir,
          '--format',
          'both',
        ],
        reportEnv(passwordFile, env),
      );
      if (res.code !== 0) throw new Error(`adam-report exited ${res.code}`);
    },
  };
}

/** The file names in a folder; none when the folder is missing. */
export function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The thoughts and intents rows a life holds, read once and the client closed; null when Postgres cannot be read. */
export async function countLifeRows(sql: SqlClient, lifeId: string): Promise<LifeRows | null> {
  try {
    const row = await readOnly(sql, async (q) => {
      const res = await q.query(
        'SELECT (SELECT count(*)::int FROM thoughts WHERE life_id = $1) AS t, (SELECT count(*)::int FROM intents WHERE life_id = $1) AS i',
        [lifeId],
      );
      return res.rows[0];
    });
    return { thoughts: Number(row?.t ?? 0), intents: Number(row?.i ?? 0) };
  } catch {
    return null;
  } finally {
    await sql.close?.().catch(() => undefined);
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
  sql: SqlClient;
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
      const paperVolumes = prepared === null ? null : await opts.worldVolumes.paperVolumes();
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
          paperVolumes,
          worldVolumeEnv: opts.env[WORLD_VOLUME_ENV],
          lifeId: LIFE_ID[opts.profile],
          lifeRows: await countLifeRows(opts.sql, LIFE_ID[opts.profile]),
          mind: mindLifeOf(shardYaml),
          secretsMissing: unreadablePaths(startSecretPaths(opts.repoRoot, opts.env)),
        },
        seed: readSeed(shardYaml),
        shardConfigSha256: sha256Hex(shardYaml),
        shardCommittedSha256,
        criteriaSha256: sha256Hex(opts.criteriaText),
      };
    },
  };
}
