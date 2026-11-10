import { describe, expect, it } from 'vitest';
import { type GlassFs, LOG_CAP_BYTES } from './fs-ops.ts';
import {
  type FetchStatus,
  GLASS_MARKER,
  type GlassDeps,
  glassPaths,
  runGlass,
} from './glass-ctl.ts';
import { parsePidFile } from './pid-file.ts';
import type { ProcessIdentity, ProcessOps, SpawnRequest } from './process-ops.ts';

/** A password that must never reach output, the log or the PID file. */
const CANARY = 'canary-pw-7f3a9c-do-not-print';
const REPO = '/repo';
const paths = glassPaths(REPO);
const NEW_START = 'S-NEW';
const SPAWNED_PID = 4242;

class MemFs implements GlassFs {
  files = new Map<string, string>();
  sizeOverride = new Map<string, number>();
  dirs = new Set<string>();
  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  size(path: string): number {
    return this.sizeOverride.get(path) ?? Buffer.byteLength(this.files.get(path) ?? '');
  }
  read(path: string, start: number, length: number): string {
    return Buffer.from(this.files.get(path) ?? '')
      .subarray(start, start + length)
      .toString('utf8');
  }
  readText(path: string): string | null {
    return this.files.get(path) ?? null;
  }
  writeText(path: string, text: string): void {
    this.files.set(path, text);
  }
  remove(path: string): void {
    this.files.delete(path);
  }
  rename(from: string, to: string): void {
    const text = this.files.get(from);
    if (text === undefined) throw new Error(`no file ${from}`);
    this.files.delete(from);
    this.files.set(to, text);
  }
  mkdir(path: string): void {
    this.dirs.add(path);
  }
}

/** Processes the test names; `spawn` makes the next one (or fails). Waits do not sleep. */
class FakeOps implements ProcessOps {
  platform: NodeJS.Platform = 'linux';
  live = new Map<number, ProcessIdentity>();
  unreadable = new Set<number>();
  signals: string[] = [];
  spawned: SpawnRequest[] = [];
  spawnPid: number | undefined = SPAWNED_PID;
  spawnError: Error | null = null;
  exitOnGraceful = true;
  exitOnForce = true;
  alive(pid: number): boolean {
    return this.live.has(pid);
  }
  identity(pid: number): ProcessIdentity | null {
    if (this.unreadable.has(pid)) return null;
    return this.live.get(pid) ?? null;
  }
  graceful(pid: number): void {
    this.signals.push(`graceful ${pid}`);
    if (this.exitOnGraceful) this.live.delete(pid);
  }
  force(pid: number): void {
    this.signals.push(`force ${pid}`);
    if (this.exitOnForce) this.live.delete(pid);
  }
  spawnDetached(request: SpawnRequest): number | undefined {
    this.spawned.push(request);
    if (this.spawnError !== null) throw this.spawnError;
    if (this.spawnPid !== undefined) {
      this.live.set(this.spawnPid, { started: NEW_START, commandLine: `node ${request.args[0]}` });
    }
    return this.spawnPid;
  }
  async sleep(): Promise<void> {}
}

/** The Glass process as a PID file names it: same start time, and a command line with the marker. */
const glassIdentity = (started = NEW_START): ProcessIdentity => ({
  started,
  commandLine: `/usr/bin/node /repo/${GLASS_MARKER}`,
});

const pidFileText = (pid: number, started: string): string =>
  `${JSON.stringify({ format: 2, pid, started, marker: GLASS_MARKER })}\n`;

interface Harness {
  fs: MemFs;
  ops: FakeOps;
  fetched: string[];
  fetchAnswer: number | null;
}

function harness(): Harness {
  const fs = new MemFs();
  fs.files.set(paths.passwordFile, `${CANARY}\n`);
  return { fs, ops: new FakeOps(), fetched: [], fetchAnswer: 200 };
}

function depsOf(h: Harness, env: NodeJS.ProcessEnv = {}): GlassDeps {
  const fetchStatus: FetchStatus = async (url) => {
    h.fetched.push(url);
    if (h.fetchAnswer === null) throw new Error('fetch failed');
    return h.fetchAnswer;
  };
  return {
    repoRoot: REPO,
    paths,
    env,
    fs: h.fs,
    ops: h.ops,
    fetchStatus,
    nodePath: '/usr/bin/node',
  };
}

/** Puts a current PID file and its live process in place. */
function runningGlass(h: Harness, pid = SPAWNED_PID, started = NEW_START): void {
  h.fs.files.set(paths.pidFile, pidFileText(pid, started));
  h.ops.live.set(pid, glassIdentity(started));
}

const pidFile = (h: Harness) => parsePidFile(h.fs.files.get(paths.pidFile) ?? '{}');

describe('glass up', () => {
  it('starts Glass detached and writes a format-2 PID file', async () => {
    const h = harness();
    const outcome = await runGlass('up', depsOf(h));
    expect(outcome.exitCode).toBe(0);
    expect(h.ops.spawned).toHaveLength(1);
    const [request] = h.ops.spawned;
    expect(request?.args).toEqual([paths.mainTs]);
    expect(request?.command).toBe('/usr/bin/node');
    expect(request?.logPath).toBe(paths.logFile);
    expect(request?.env.GELDAR_GLASS_HOST).toBe('127.0.0.1');
    expect(request?.env.GELDAR_GLASS_PG_PASSWORD_FILE).toBe(paths.passwordFile);
    const raw = h.fs.files.get(paths.pidFile) ?? '';
    expect(JSON.parse(raw)).toEqual({
      format: 2,
      pid: SPAWNED_PID,
      started: NEW_START,
      marker: GLASS_MARKER,
    });
    expect(pidFile(h)).toEqual({
      kind: 'current',
      record: { pid: SPAWNED_PID, started: NEW_START, marker: GLASS_MARKER },
    });
  });

  it('refuses a bind other than loopback before anything starts', async () => {
    for (const host of ['0.0.0.0', 'localhost', '192.168.1.5', '']) {
      const h = harness();
      const outcome = await runGlass('up', depsOf(h, { GELDAR_GLASS_HOST: host }));
      expect(outcome.exitCode).toBe(1);
      expect(h.ops.spawned).toHaveLength(0);
      expect(h.fs.files.has(paths.pidFile)).toBe(false);
    }
  });

  it('leaves no PID file when the spawn fails or gives no process', async () => {
    const thrown = harness();
    thrown.ops.spawnError = new Error('spawn node ENOENT');
    expect((await runGlass('up', depsOf(thrown))).exitCode).toBe(1);
    expect(thrown.fs.files.has(paths.pidFile)).toBe(false);

    const noPid = harness();
    noPid.ops.spawnPid = undefined;
    const outcome = await runGlass('up', depsOf(noPid));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines.join('\n')).toContain('no process id');
    expect(noPid.fs.files.has(paths.pidFile)).toBe(false);
  });

  it('refuses without the password file, and never opens it', async () => {
    const h = harness();
    h.fs.files.delete(paths.passwordFile);
    const outcome = await runGlass('up', depsOf(h));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.lines.join('\n')).toContain('postgres-glass.txt is missing');
    expect(h.ops.spawned).toHaveLength(0);
  });

  it('rotates a log over 5 MB to .1 at start and keeps a small one', async () => {
    const big = harness();
    big.fs.files.set(paths.logFile, 'old\n');
    big.fs.sizeOverride.set(paths.logFile, LOG_CAP_BYTES + 1);
    await runGlass('up', depsOf(big));
    expect(big.fs.files.has(`${paths.logFile}.1`)).toBe(true);
    expect(big.fs.files.get(`${paths.logFile}.1`)).toBe('old\n');

    const small = harness();
    small.fs.files.set(paths.logFile, 'keep\n');
    await runGlass('up', depsOf(small));
    expect(small.fs.files.has(`${paths.logFile}.1`)).toBe(false);
    expect(small.fs.files.get(paths.logFile)).toBe('keep\n');
  });

  it('does not start a second Glass over a live one', async () => {
    const h = harness();
    runningGlass(h);
    const outcome = await runGlass('up', depsOf(h));
    expect(outcome.exitCode).toBe(0);
    expect(outcome.lines.join('\n')).toContain('already up');
    expect(h.ops.spawned).toHaveLength(0);
  });

  it('keeps an unverifiable PID file and starts nothing', async () => {
    const h = harness();
    runningGlass(h);
    h.ops.unreadable.add(SPAWNED_PID);
    const outcome = await runGlass('up', depsOf(h));
    expect(outcome.exitCode).toBe(1);
    expect(h.ops.spawned).toHaveLength(0);
    expect(h.fs.files.has(paths.pidFile)).toBe(true);
  });
});

describe('glass down ownership matrix', () => {
  it('match: stops the Glass process gracefully and removes the PID file', async () => {
    const h = harness();
    runningGlass(h);
    const outcome = await runGlass('down', depsOf(h));
    expect(outcome.exitCode).toBe(0);
    expect(h.ops.signals).toEqual([`graceful ${SPAWNED_PID}`]);
    expect(h.fs.files.has(paths.pidFile)).toBe(false);
  });

  it('match: forces the stop when the graceful one does not end the process', async () => {
    const h = harness();
    runningGlass(h);
    h.ops.exitOnGraceful = false;
    const outcome = await runGlass('down', depsOf(h));
    expect(outcome.exitCode).toBe(0);
    expect(h.ops.signals).toEqual([`graceful ${SPAWNED_PID}`, `force ${SPAWNED_PID}`]);
    expect(h.fs.files.has(paths.pidFile)).toBe(false);
  });

  it('match: a stop that fails keeps the PID file and exits 1', async () => {
    const h = harness();
    runningGlass(h);
    h.ops.exitOnGraceful = false;
    h.ops.exitOnForce = false;
    const outcome = await runGlass('down', depsOf(h));
    expect(outcome.exitCode).toBe(1);
    expect(h.fs.files.has(paths.pidFile)).toBe(true);
  });

  it('mismatch: a reused PID is never signalled, and the stale file goes', async () => {
    const h = harness();
    runningGlass(h, SPAWNED_PID, 'S-OTHER');
    h.ops.live.set(SPAWNED_PID, glassIdentity('S-REUSED'));
    const outcome = await runGlass('down', depsOf(h));
    expect(outcome.exitCode).toBe(0);
    expect(h.ops.signals).toEqual([]);
    expect(h.fs.files.has(paths.pidFile)).toBe(false);
  });

  it('mismatch: a live process without the Glass marker is not signalled', async () => {
    const h = harness();
    runningGlass(h);
    h.ops.live.set(SPAWNED_PID, { started: NEW_START, commandLine: '/usr/bin/vim notes.txt' });
    expect((await runGlass('down', depsOf(h))).exitCode).toBe(0);
    expect(h.ops.signals).toEqual([]);
    expect(h.fs.files.has(paths.pidFile)).toBe(false);
  });

  it('unverifiable: nothing is signalled and the PID file stays', async () => {
    const h = harness();
    runningGlass(h);
    h.ops.unreadable.add(SPAWNED_PID);
    const outcome = await runGlass('down', depsOf(h));
    expect(outcome.exitCode).toBe(1);
    expect(h.ops.signals).toEqual([]);
    expect(h.fs.files.has(paths.pidFile)).toBe(true);
  });

  it('unverifiable: a PID file that recorded no start time is kept too', async () => {
    const h = harness();
    runningGlass(h, SPAWNED_PID, 'unknown');
    const outcome = await runGlass('down', depsOf(h));
    expect(outcome.exitCode).toBe(1);
    expect(h.ops.signals).toEqual([]);
    expect(h.fs.files.has(paths.pidFile)).toBe(true);
  });

  it('dead: the file goes and nothing is signalled', async () => {
    const h = harness();
    h.fs.files.set(paths.pidFile, pidFileText(SPAWNED_PID, NEW_START));
    const outcome = await runGlass('down', depsOf(h));
    expect(outcome.exitCode).toBe(0);
    expect(h.ops.signals).toEqual([]);
    expect(h.fs.files.has(paths.pidFile)).toBe(false);
  });

  it('an old-format PID file is never trusted: kept, exit 1', async () => {
    const h = harness();
    h.fs.files.set(paths.pidFile, `${SPAWNED_PID}\n`);
    h.ops.live.set(SPAWNED_PID, glassIdentity());
    expect((await runGlass('down', depsOf(h))).exitCode).toBe(1);
    expect(h.ops.signals).toEqual([]);
    expect(h.fs.files.has(paths.pidFile)).toBe(true);
  });
});

describe('glass status', () => {
  it('probes the thoughts API on loopback and prints the URL', async () => {
    const h = harness();
    runningGlass(h);
    const outcome = await runGlass('status', depsOf(h));
    expect(outcome.exitCode).toBe(0);
    expect(h.fetched).toEqual(['http://127.0.0.1:8787/api/thoughts?limit=1']);
    expect(outcome.lines).toEqual([
      `glass up (pid ${SPAWNED_PID})`,
      'url http://127.0.0.1:8787/',
      'probe GET /api/thoughts answers (HTTP 200)',
    ]);
  });

  it('reports a probe that gets no answer as one line, and the port from the environment', async () => {
    const h = harness();
    h.fetchAnswer = null;
    const outcome = await runGlass('status', depsOf(h, { GELDAR_GLASS_PORT: '8899' }));
    expect(h.fetched).toEqual(['http://127.0.0.1:8899/api/thoughts?limit=1']);
    expect(outcome.lines[0]).toBe('glass down (no pid file)');
    expect(outcome.lines[1]).toBe('url http://127.0.0.1:8899/');
    expect(outcome.lines[2]).toBe('probe GET /api/thoughts does not answer (fetch failed)');
  });
});

describe('glass logs', () => {
  it('says so when there is no log, and prints the lines of the log', async () => {
    const h = harness();
    expect((await runGlass('logs', depsOf(h))).lines).toEqual(['glass: no log yet']);
    h.fs.files.set(paths.logFile, 'first\nsecond\nthird\n');
    expect((await runGlass('logs', depsOf(h))).lines).toEqual(['first', 'second', 'third']);
  });

  it('reads at most the last 64 KB and drops the partial line at the cut', async () => {
    const h = harness();
    const line = `${'x'.repeat(999)}\n`;
    const text = `head-marker\n${line.repeat(80)}tail-marker\n`;
    h.fs.files.set(paths.logFile, text);
    const lines = (await runGlass('logs', depsOf(h))).lines;
    expect(lines.at(-1)).toBe('tail-marker');
    expect(lines).not.toContain('head-marker');
    expect(lines.every((l) => l === 'x'.repeat(999) || l === 'tail-marker')).toBe(true);
  });
});

describe('glass CLI verbs', () => {
  it('exits 2 with the usage for an unknown verb', async () => {
    const outcome = await runGlass('restart', depsOf(harness()));
    expect(outcome.exitCode).toBe(2);
    expect(outcome.lines[0]).toContain('usage');
  });
});

describe('the password', () => {
  it('never appears in any output, PID file, log or spawn argument', async () => {
    const h = harness();
    const seen: string[] = [];
    const deps = depsOf(h);
    seen.push(...(await runGlass('up', deps)).lines);
    seen.push(...(await runGlass('status', deps)).lines);
    seen.push(...(await runGlass('logs', deps)).lines);
    seen.push(...(await runGlass('down', deps)).lines);
    seen.push(...(await runGlass('down', deps)).lines);
    // Every file the commands wrote (the password file is the input, not an output).
    const written = [...h.fs.files]
      .filter(([path]) => path !== paths.passwordFile)
      .map(([, text]) => text);
    seen.push(...written, JSON.stringify(h.ops.spawned), JSON.stringify(h.fetched));
    expect(h.fs.files.get(paths.passwordFile)).toContain(CANARY);
    expect(seen.join('\n')).not.toContain(CANARY);
  });
});
