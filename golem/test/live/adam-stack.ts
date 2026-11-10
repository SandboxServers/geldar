/**
 * Shared pieces of the Mind live cases (P0-33b): start and stop the three host processes of
 * decision 0050 (Adam's Body, animus, lantern-local), poll Postgres for what the Mind recorded, and
 * the pure checks the cases use. Nothing here needs Ollama: the unit test runs it with fakes and a
 * trivial child process.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { repoRoot } from '../../src/config.ts';

/** The live Mind cases need the shard (`GELDAR_IT=1`) and Ollama (`GELDAR_OLLAMA=1`). */
export const mindLiveEnabled = process.env.GELDAR_IT === '1' && process.env.GELDAR_OLLAMA === '1';

/** The 8B life of decision 0051 that these cases run. */
export const ADAM_LIFE_ID = 'ag_adam_02';

const LOG_RING = 300;

/** One host process to start. */
export interface ProcessSpec {
  name: string;
  /** Path of the entry file, run with the current node. */
  script: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The log line that says the process is ready. */
  ready: RegExp;
  /** After this process is ready, wait for a line in another process's log (by its name). */
  awaits?: { process: string; pattern: RegExp };
}

/**
 * The three process specs, in the start order of `./geldar.ps1 adam up`: the Body, animus, then
 * lantern-local, after which the stack waits for animus to log `thinker_connected`. They get the
 * environment `adam up` gives them: the shard name and the loopback defaults the processes read
 * themselves; secrets are read by the processes from `compose/secrets/*.txt`, never passed here.
 */
export function adamProcessSpecs(root: string, base: NodeJS.ProcessEnv): ProcessSpec[] {
  const env = { ...base, GELDAR_SHARD: base.GELDAR_SHARD ?? 'phase0' };
  return [
    {
      name: 'adam-body',
      script: join(root, 'golem', 'src', 'adam', 'main.ts'),
      cwd: root,
      env,
      ready: /"event":"body_started"/,
    },
    {
      name: 'animus',
      script: join(root, 'animus', 'src', 'main.ts'),
      cwd: root,
      env,
      ready: /"event":"mind_started"/,
    },
    {
      name: 'lantern-local',
      script: join(root, 'lantern-local', 'src', 'main.ts'),
      cwd: root,
      env,
      ready: /serving /,
      awaits: { process: 'animus', pattern: /"event":"thinker_connected"/ },
    },
  ];
}

/** A running host process with its captured log. */
export class HostProcess {
  readonly spec: ProcessSpec;
  readonly lines: string[] = [];
  readonly child: ChildProcess;
  /** Resolves with the exit code (null when killed by a signal) once the process is gone. */
  readonly exited: Promise<number | null>;
  private done = false;

  constructor(spec: ProcessSpec) {
    this.spec = spec;
    this.child = spawn(process.execPath, [spec.script], {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.exited = new Promise((resolve) => {
      this.child.once('exit', (code) => {
        this.done = true;
        resolve(code);
      });
      this.child.once('error', (error) => {
        this.lines.push(`spawn error: ${error.message}`);
        this.done = true;
        resolve(null);
      });
    });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      let rest = '';
      stream?.on('data', (chunk: Buffer) => {
        const parts = (rest + chunk.toString('utf8')).split(/\r?\n/);
        rest = parts.pop() ?? '';
        for (const line of parts) this.push(line);
      });
    }
  }

  get running(): boolean {
    return !this.done;
  }

  /** The last log lines, for failure messages. */
  tail(count = 15): string {
    return this.lines.slice(-count).join('\n');
  }

  /** Waits until a log line matches `pattern`; throws with the log tail on exit or timeout. */
  async waitForLog(pattern: RegExp, timeoutMs: number): Promise<void> {
    await pollUntil(async () => (this.lines.some((l) => pattern.test(l)) ? true : null), {
      what: `${this.spec.name} to log ${pattern}`,
      timeoutMs,
      intervalMs: 100,
      seen: () => `running ${this.running}; log tail:\n${this.tail()}`,
      abort: async () => (this.running ? null : 'the process exited'),
    });
  }

  /** Asks the process to stop, then kills it after `graceMs`. */
  async stop(graceMs = 5_000): Promise<void> {
    if (!this.running) return;
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), graceMs);
    await this.exited;
    clearTimeout(timer);
  }

  /** Kills the process at once, as a crash would. */
  async kill(): Promise<void> {
    if (!this.running) return;
    this.child.kill('SIGKILL');
    await this.exited;
  }

  private push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > LOG_RING) this.lines.splice(0, this.lines.length - LOG_RING);
  }
}

/** How `pollUntil` waits; tests inject a clock. */
export interface PollOptions {
  /** What is being waited for, for the failure message. */
  what: string;
  timeoutMs: number;
  intervalMs?: number;
  /** The state seen so far; printed in the failure message. */
  seen: () => string;
  /** Returns non-null to stop the wait early with an error (a process that exited). */
  abort?: () => Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls `probe` until it returns a value that is not null, undefined or false. Throws an error that
 * names what was awaited and the state seen, on the deadline or when `abort` fires.
 */
export async function pollUntil<T>(
  probe: () => Promise<T | null | undefined | false>,
  options: PollOptions,
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    const aborted = options.abort ? await options.abort() : null;
    if (aborted !== null && aborted !== undefined) {
      throw new Error(
        `stopped waiting for ${options.what}: ${String(aborted)}; saw ${options.seen()}`,
      );
    }
    if (now() >= deadline) {
      throw new Error(
        `timed out after ${options.timeoutMs} ms waiting for ${options.what}; saw ${options.seen()}`,
      );
    }
    await sleep(options.intervalMs ?? 500);
  }
}

/** The three processes of one Adam run. */
export class AdamStack {
  readonly processes: HostProcess[] = [];
  private readonly specs: ProcessSpec[];

  constructor(specs: ProcessSpec[]) {
    this.specs = specs;
  }

  /**
   * Starts the Body (the first spec) and waits for its ready line, then runs `afterBody`, then starts
   * the Mind processes in order, waiting for their ready lines and for the lines a spec says to wait
   * for in another process (animus's `thinker_connected`). `afterBody` runs before the Mind starts,
   * so the world it sets up is in place when the Mind first looks. Stops what it started on failure.
   */
  async start(readyTimeoutMs = 120_000, afterBody?: () => Promise<void>): Promise<void> {
    try {
      const [body, ...mind] = this.specs;
      if (body === undefined) throw new Error('no process specs to start');
      await this.launch(body, readyTimeoutMs);
      if (afterBody !== undefined) await afterBody();
      for (const spec of mind) await this.launch(spec, readyTimeoutMs);
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  /** Starts one process and waits for its ready line, and for its `awaits` line in another process. */
  private async launch(spec: ProcessSpec, readyTimeoutMs: number): Promise<void> {
    const proc = new HostProcess(spec);
    this.processes.push(proc);
    await proc.waitForLog(spec.ready, readyTimeoutMs);
    if (spec.awaits !== undefined) {
      const other = this.processes.find((p) => p.spec.name === spec.awaits?.process);
      await other?.waitForLog(spec.awaits.pattern, readyTimeoutMs);
    }
  }

  /** The Body process (the first one started). */
  get body(): HostProcess {
    const body = this.processes.find((p) => p.spec.name === 'adam-body');
    if (body === undefined) throw new Error('the Body process was not started');
    return body;
  }

  /** Kills the Body at once and starts a new one; resolves when it logs `body_started`. */
  async restartBody(readyTimeoutMs = 120_000): Promise<HostProcess> {
    const old = this.body;
    await old.kill();
    const spec = this.specs.find((s) => s.name === 'adam-body');
    if (spec === undefined) throw new Error('no Body spec');
    const fresh = new HostProcess(spec);
    this.processes.splice(this.processes.indexOf(old), 1, fresh);
    await fresh.waitForLog(spec.ready, readyTimeoutMs);
    return fresh;
  }

  /** Stops the Mind first, then the local Thinker, and the Body last (it leaves its checkpoint). */
  async stop(): Promise<void> {
    const order = ['animus', 'lantern-local', 'adam-body'];
    const ranked = [...this.processes].sort(
      (a, b) => order.indexOf(a.spec.name) - order.indexOf(b.spec.name),
    );
    for (const proc of ranked) await proc.stop().catch(() => undefined);
  }

  /** The log tails of every process, for failure messages. */
  logs(): string {
    return this.processes.map((p) => `--- ${p.spec.name} ---\n${p.tail(10)}`).join('\n');
  }
}

/** The slice of `pg` the queries use (a fake in tests). */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** An open Postgres connection and the way to close it. */
export interface MindDb extends Queryable {
  close(): Promise<void>;
}

/** Opens the shard's Postgres on loopback with the password from `compose/secrets/postgres.txt`. */
export async function openMindDb(env: NodeJS.ProcessEnv = process.env): Promise<MindDb> {
  const file = env.POSTGRES_PASSWORD_FILE ?? join(repoRoot(), 'compose', 'secrets', 'postgres.txt');
  const pool = new pg.Pool({
    host: env.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(env.POSTGRES_PORT ?? 5432),
    user: env.POSTGRES_USER ?? 'geldar',
    database: env.POSTGRES_DB ?? 'geldar',
    password: (await readFile(file, 'utf8')).trim(),
    max: 2,
  });
  await pool.query('SELECT 1');
  return { query: (sql, params) => pool.query(sql, params), close: () => pool.end() };
}

/** One `thoughts` row, as the cases read it. */
export interface ThoughtRow {
  thought_id: string;
  wake_reason: string;
  at: string;
  latency_ms: number | null;
  /** The output passed the validator (`parsed` is set). */
  valid: boolean;
  /** The model produced output (`raw_output` is set). */
  has_output: boolean;
  body_generation: number | null;
  /** The messages array sent; only when asked for. */
  model_input: unknown;
}

/** Thoughts of a life recorded at or after `sinceIso`, oldest first. */
export async function thoughtsSince(
  db: Queryable,
  lifeId: string,
  sinceIso: string,
  withInput = false,
): Promise<ThoughtRow[]> {
  const { rows } = await db.query(
    `SELECT thought_id, wake_reason, at, latency_ms, parsed IS NOT NULL AS valid,
            raw_output IS NOT NULL AS has_output,
            (snapshot->>'body_generation')::int AS body_generation,
            ${withInput ? 'model_input' : 'NULL::jsonb AS model_input'}
       FROM thoughts WHERE life_id = $1 AND at >= $2::timestamptz ORDER BY at, thought_id`,
    [lifeId, sinceIso],
  );
  return rows.map((r) => ({
    thought_id: String(r.thought_id),
    wake_reason: String(r.wake_reason),
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    latency_ms: r.latency_ms === null ? null : Number(r.latency_ms),
    valid: r.valid === true,
    has_output: r.has_output === true,
    body_generation: r.body_generation === null ? null : Number(r.body_generation),
    model_input: r.model_input,
  }));
}

/** One `intents` row, as the cases read it. */
export interface IntentRow {
  intent_id: string;
  thought_id: string | null;
  body_generation: number;
  state: string;
  program: string | null;
  goal: string | null;
}

/** Every intent of a life, oldest id first (ULIDs sort by time). */
export async function intentsOf(db: Queryable, lifeId: string): Promise<IntentRow[]> {
  const { rows } = await db.query(
    `SELECT intent_id, thought_id, body_generation, state, program, goal
       FROM intents WHERE life_id = $1 ORDER BY intent_id`,
    [lifeId],
  );
  return rows.map((r) => ({
    intent_id: String(r.intent_id),
    thought_id: r.thought_id === null ? null : String(r.thought_id),
    body_generation: Number(r.body_generation),
    state: String(r.state),
    program: r.program === null ? null : String(r.program),
    goal: r.goal === null ? null : String(r.goal),
  }));
}

/** One `actions` row, as the cases read it. */
export interface ActionRow {
  action_id: string;
  intent_id: string | null;
  body_generation: number;
  state: string;
  kind: string | null;
}

/** Every action of a life, oldest id first (ULIDs sort by time). */
export async function actionsOf(db: Queryable, lifeId: string): Promise<ActionRow[]> {
  const { rows } = await db.query(
    `SELECT action_id, intent_id, body_generation, state, kind
       FROM actions WHERE life_id = $1 ORDER BY action_id`,
    [lifeId],
  );
  return rows.map((r) => ({
    action_id: String(r.action_id),
    intent_id: r.intent_id === null ? null : String(r.intent_id),
    body_generation: Number(r.body_generation),
    state: String(r.state),
    kind: r.kind === null ? null : String(r.kind),
  }));
}

/** The memories a set of thoughts wrote (`source_thought`), as `kind:subject` labels. */
export async function memoriesFrom(db: Queryable, thoughtIds: string[]): Promise<string[]> {
  if (thoughtIds.length === 0) return [];
  const { rows } = await db.query(
    'SELECT kind, subject FROM memories WHERE source_thought = ANY($1::text[]) ORDER BY memory_id',
    [thoughtIds],
  );
  return rows.map((r) => `${String(r.kind)}:${String(r.subject)}`);
}

/** One line per thought for failure messages: id tail, wake reason, validity, latency, generation. */
export function describeThoughts(rows: ThoughtRow[]): string {
  if (rows.length === 0) return 'no thoughts';
  return rows
    .map(
      (r) =>
        `${r.thought_id.slice(-6)} ${r.wake_reason} ${r.valid ? 'valid' : r.has_output ? 'rejected' : 'no-call'} ` +
        `${r.latency_ms ?? '-'}ms gen ${r.body_generation ?? '-'}`,
    )
    .join('; ');
}

/** One line per intent for failure messages. */
export function describeIntents(rows: IntentRow[]): string {
  if (rows.length === 0) return 'no intents';
  return rows
    .map((r) => `${r.intent_id.slice(-6)} ${r.program ?? '-'} ${r.state} gen ${r.body_generation}`)
    .join('; ');
}

/** One line per action for failure messages. */
export function describeActions(rows: ActionRow[]): string {
  if (rows.length === 0) return 'no actions';
  return rows
    .map((r) => `${r.action_id.slice(-6)} ${r.kind ?? '-'} ${r.state} gen ${r.body_generation}`)
    .join('; ');
}

/** What became of the intent that ran when the chatter spoke. */
export type IntentFate = 'resumed' | 'replaced' | 'lost' | 'none';

/**
 * Compares the intents before a line and after Adam's answer. `resumed`: the intent that was running
 * is still running or completed; `replaced`: a newer intent was accepted; `lost`: it ended another
 * way and nothing took its place; `none`: nothing was running before.
 */
export function intentFate(before: IntentRow[], after: IntentRow[]): IntentFate {
  const running = before.find((i) => i.state === 'running');
  if (running === undefined) return 'none';
  const now = after.find((i) => i.intent_id === running.intent_id);
  if (now !== undefined && (now.state === 'running' || now.state === 'completed')) return 'resumed';
  const known = new Set(before.map((i) => i.intent_id));
  return after.some((i) => !known.has(i.intent_id)) ? 'replaced' : 'lost';
}

const WORLD_TEXT_OPEN = 'QUOTED WORLD TEXT (';
const WORLD_TEXT_CLOSE = 'END OF QUOTED WORLD TEXT';

/**
 * Audits a rendered prompt (the `model_input` messages array) for hostile lines. Each marker is a
 * distinctive piece of one hostile line. Returns the problems found (empty means the lines stayed
 * quoted): a marker in a message that is not the user message, outside the quoted section or on a
 * line that is not a `- heard` JSON line; a forged section header or footer that is not the real one.
 */
export function auditWorldText(modelInput: unknown, markers: string[]): string[] {
  const problems: string[] = [];
  if (!Array.isArray(modelInput)) return ['model_input is not an array of messages'];
  const messages = modelInput as { role?: unknown; content?: unknown }[];
  const needles = markers.map((m) => m.toLowerCase());
  for (const [index, message] of messages.entries()) {
    const content = typeof message.content === 'string' ? message.content : '';
    const lines = content.split('\n');
    if (message.role !== 'user') {
      for (const m of needles) {
        if (content.toLowerCase().includes(m)) {
          problems.push(`message ${index} (${String(message.role)}) contains '${m}'`);
        }
      }
      continue;
    }
    const opens = lines.filter((l) => l.startsWith(WORLD_TEXT_OPEN)).length;
    const closes = lines.filter((l) => l === WORLD_TEXT_CLOSE).length;
    if (opens > 1 || closes > 1) {
      problems.push(`user message has ${opens} section headers and ${closes} footers`);
    }
    let inside = false;
    for (const line of lines) {
      if (line.startsWith(WORLD_TEXT_OPEN)) inside = true;
      const hit = needles.find((m) => line.toLowerCase().includes(m));
      if (hit !== undefined) {
        if (!inside) problems.push(`'${hit}' outside the quoted section: ${line.slice(0, 80)}`);
        else if (!QUOTED_LINE.test(line)) {
          problems.push(
            `'${hit}' on a line that is not a heard or wake_speech line: ${line.slice(0, 80)}`,
          );
        } else if (!quotedLineParses(line)) {
          problems.push(`'${hit}' on a quoted line that is not JSON: ${line.slice(0, 80)}`);
        }
      }
      if (line === WORLD_TEXT_CLOSE) inside = false;
    }
  }
  return problems;
}

/** World text appears only as `- heard {json}` or `- wake_speech {json}` lines. */
const QUOTED_LINE = /^- (heard|wake_speech) \{/;

/** Whether the quoted line carries a JSON object. */
function quotedLineParses(line: string): boolean {
  try {
    const value: unknown = JSON.parse(line.replace(/^- \w+ /, ''));
    return typeof value === 'object' && value !== null;
  } catch {
    return false;
  }
}
