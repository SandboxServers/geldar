/**
 * The ports the run protocol uses. The real adapters live in `adapters.ts`; the tests pass fakes, so no test sleeps,
 * starts a process or touches the disk.
 */
import { posix } from 'node:path';

/** The services the protocol watches and stops. Start order: body, animus, lantern-local (as `./geldar.ps1 adam up`). */
export const PROBES = [
  'animus',
  'body',
  'lantern-local',
  'ollama',
  'postgres',
  'nats',
  'paper',
] as const;
export type Probe = (typeof PROBES)[number];

/** The Golem-side services the protocol stops, in stop order: the reverse of the start order, so the Body is last. */
export type Service = 'body' | 'animus' | 'lantern-local';

export interface Clock {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

/** The only disk writes the protocol makes. `append` is the one used on `status.log`, which is never rewritten. */
export interface FileStore {
  /** The file text, or null when the file does not exist. */
  read(path: string): string | null;
  /** Creates the file or replaces it; used for manifest.json, benchmark reads, abort.json. */
  write(path: string, text: string): void;
  append(path: string, text: string): void;
}

export interface ProcessView {
  pid: number;
  /** The start time as the platform reports it; compared with the start time the run recorded. */
  startedAt: string;
  commandLine: string;
}

export interface Processes {
  list(): ProcessView[];
  /** A graceful request, or a forced kill when `force` is true. */
  signal(pid: number, force: boolean): void;
}

/** The supervisor actions. `restartBody` ends the Body process and respawns it through `adam-cli restart-body`; the protocol only waits for `body_started`. */
export interface Supervisor {
  /** The existing start path: `./geldar.ps1 adam up`. Never used for live cases. */
  up(): Promise<void>;
  /** The planned restart: stops and starts the stack through the supervisor. */
  restartStack(): Promise<void>;
  /** A harness-injected Body restart, used mid-intent. The moment is recorded by the caller. */
  restartBody(): Promise<void>;
  /** Stops one service through the existing stop path. */
  stop(service: Service): Promise<void>;
}

/** The report step (W6-12). It reads the run folder; the protocol calls it after a complete run and after an abort. */
export interface Reporter {
  reportRun(runId: string): Promise<void>;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs one program with an argument array, never a shell string. The adapters use it for `ollama`, `nvidia-smi`, `pg`.
 * `env` adds variables to the child's inherited environment; none means the child inherits it unchanged.
 */
export interface Runner {
  exec(
    file: string,
    args: readonly string[],
    env?: Record<string, string | undefined>,
  ): Promise<ExecResult>;
}

/** One status sample. Missing measures are null, never zero. */
export interface Observation {
  atMs: number;
  lifeId: string | null;
  /** Process liveness and service reachability, one flag per probe. */
  alive: Record<Probe, boolean>;
  thoughts: number;
  lastThoughtAtMs: number | null;
  tps: number | null;
  latencyP95Ms: number | null;
  /** The intent the Body is running, or null when none is active. */
  activeIntentId: string | null;
  deaths: number;
  gpuPresent: boolean;
  diskFreeGb: number;
  bodyConnected: boolean;
  /** Errors logged by the stack since the previous sample. */
  errorsSinceLast: number;
}

export interface Sampler {
  /** One sample. `runStartMs` is when the run began: deaths are counted from it, not from the life's birth. */
  observe(runStartMs: number): Promise<Observation>;
  /** Releases the SQL connection when the run ends, so the process can exit. */
  close?(): Promise<void>;
}

/** The files a run writes, under its run folder (`.geldar/runs/<run-id>`). */
export function runPaths(runDir: string): { manifest: string; status: string; abort: string } {
  return {
    manifest: posix.join(runDir, 'manifest.json'),
    status: posix.join(runDir, 'status.log'),
    abort: posix.join(runDir, 'abort.json'),
  };
}
