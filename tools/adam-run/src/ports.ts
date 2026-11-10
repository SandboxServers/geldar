/**
 * The ports the run protocol uses. The real adapters live in `adapters.ts`; the tests pass fakes, so no test sleeps,
 * starts a process or touches the disk.
 */

/** The services the protocol watches and stops. Start order: body, animus, lantern-local (as `./geldar.ps1 adam up`). */
export const PROBES = ['animus', 'body', 'lantern-local', 'ollama', 'postgres', 'nats', 'paper'] as const;
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

export interface Supervisor {
  /** The existing start path: `./geldar.ps1 adam up`. Never used for live cases. */
  up(): Promise<void>;
  /** The planned restart: stops and starts the stack through the supervisor. */
  restartStack(): Promise<void>;
  /** A harness-injected Body kill, used mid-intent. The moment is recorded by the caller. */
  killBody(): Promise<void>;
  /** Starts the Body again after a kill; it resumes from its checkpoint. */
  startBody(): Promise<void>;
  stop(service: Service): Promise<void>;
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
  observe(): Promise<Observation>;
}
