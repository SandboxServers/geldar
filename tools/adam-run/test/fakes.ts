/**
 * Fake ports for the run tests. The clock only moves when something sleeps, so a 3-hour run takes milliseconds.
 * `Scenario` is the fake stack's health: a test changes it from `onObserve` at the minute it wants.
 */
import type { AbortCriteria } from '../src/abort.ts';
import { LIFE_ID, type Profile } from '../src/manifest.ts';
import type {
  Clock,
  FileStore,
  Observation,
  Processes,
  ProcessView,
  Reporter,
  Sampler,
  Service,
  Supervisor,
} from '../src/ports.ts';
import type { Preflight, PreflightFacts } from '../src/sequence.ts';
import { PREPARED_SCHEMA, type VolumeState, type WorldVolumes } from '../src/world-volume.ts';

/** The world volume the fake gate reports as prepared and selected through GELDAR_WORLD_VOLUME. */
const FAKE_WORLD_VOLUME = 'geldar-phase0-world-run-1';

export const MIN = 60_000;
export const START_MS = Date.parse('2026-11-10T00:00:00Z');

export const CRITERIA: AbortCriteria = {
  tpsMin: 19.5,
  tpsWindowMs: 5 * MIN,
  latencyP95MaxMs: 15_000,
  latencyWindowMs: 30 * MIN,
  serviceDownMs: 5 * MIN,
  bodyDisconnectedMs: 5 * MIN,
  noThoughtMs: 10 * MIN,
  diskMinGb: 10,
  deathFailsRun: true,
};

export class FakeClock implements Clock {
  private t = START_MS;
  nowMs(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.t += ms;
  }
}

export class MemoryFiles implements FileStore {
  readonly files = new Map<string, string>();
  /** Every write and append, so a test can assert that nothing was written. */
  writes = 0;
  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }
  write(path: string, text: string): void {
    this.writes++;
    this.files.set(path, text);
  }
  append(path: string, text: string): void {
    this.writes++;
    this.files.set(path, (this.files.get(path) ?? '') + text);
  }
  lines(path: string): Record<string, unknown>[] {
    const text = this.files.get(path) ?? '';
    return text
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

export interface Scenario {
  tps: number | null;
  latencyP95Ms: number | null;
  ollamaUp: boolean;
  postgresUp: boolean;
  natsUp: boolean;
  gpuPresent: boolean;
  deaths: number;
  diskFreeGb: number;
  /** When false, no thought has been made: `lastThoughtAtMs` is null. */
  thinking: boolean;
  lifeId: string;
  /** The life id the stack reports after a planned restart. */
  lifeAfterRestart: string;
  /** The stack is down before this time (ms). A restart takes it down for three minutes. */
  stackDownUntil: number;
  /** The Body is down before this time (ms). A kill takes it down for two minutes. */
  bodyDownUntil: number;
  /** A killed Body never comes back. */
  bodyNeverBack: boolean;
  /** The intent the Body runs at a time, or null. */
  intent: (atMs: number) => string | null;
  /** Samples throw from this time on, or never when null. */
  sampleFailsFrom: number | null;
  /** Runs before each observation; tests change the health here. */
  onObserve?: (atMs: number, s: Scenario) => void;
}

export function scenario(lifeId: string, over: Partial<Scenario> = {}): Scenario {
  return {
    tps: 20,
    latencyP95Ms: 5_000,
    ollamaUp: true,
    postgresUp: true,
    natsUp: true,
    gpuPresent: true,
    deaths: 0,
    diskFreeGb: 100,
    thinking: true,
    lifeId,
    lifeAfterRestart: lifeId,
    stackDownUntil: 0,
    bodyDownUntil: 0,
    bodyNeverBack: false,
    intent: () => null,
    sampleFailsFrom: null,
    ...over,
  };
}

export class FakeSampler implements Sampler {
  private samples = 0;
  private readonly clock: FakeClock;
  readonly s: Scenario;
  constructor(clock: FakeClock, s: Scenario) {
    this.clock = clock;
    this.s = s;
  }
  async observe(): Promise<Observation> {
    const now = this.clock.nowMs();
    this.s.onObserve?.(now, this.s);
    if (this.s.sampleFailsFrom !== null && now >= this.s.sampleFailsFrom) {
      throw new Error('the sampler could not reach the stack');
    }
    this.samples++;
    const stackUp = now >= this.s.stackDownUntil;
    const bodyUp = stackUp && now >= this.s.bodyDownUntil;
    return {
      atMs: now,
      lifeId: this.s.lifeId,
      alive: {
        animus: stackUp,
        body: bodyUp,
        'lantern-local': stackUp,
        ollama: this.s.ollamaUp,
        postgres: this.s.postgresUp && stackUp,
        nats: this.s.natsUp && stackUp,
        paper: stackUp,
      },
      thoughts: this.samples,
      lastThoughtAtMs: this.s.thinking ? now : null,
      tps: stackUp ? this.s.tps : null,
      latencyP95Ms: this.s.latencyP95Ms,
      activeIntentId: bodyUp ? this.s.intent(now) : null,
      deaths: this.s.deaths,
      gpuPresent: this.s.gpuPresent,
      diskFreeGb: this.s.diskFreeGb,
      bodyConnected: bodyUp,
      errorsSinceLast: 0,
    };
  }
}

export class FakeSupervisor implements Supervisor {
  readonly calls: string[] = [];
  /** A service whose stop throws. */
  failStop: Service | null = null;
  private readonly clock: FakeClock;
  private readonly s: Scenario;
  constructor(clock: FakeClock, s: Scenario) {
    this.clock = clock;
    this.s = s;
  }
  async up(): Promise<void> {
    this.calls.push('up');
  }
  async restartStack(): Promise<void> {
    this.calls.push('restartStack');
    this.s.stackDownUntil = this.clock.nowMs() + 3 * MIN;
    this.s.lifeId = this.s.lifeAfterRestart;
  }
  async restartBody(): Promise<void> {
    this.calls.push('restartBody');
    this.s.bodyDownUntil = this.s.bodyNeverBack
      ? Number.POSITIVE_INFINITY
      : this.clock.nowMs() + 2 * MIN;
  }
  async stop(service: Service): Promise<void> {
    this.calls.push(`stop:${service}`);
    if (this.failStop === service) throw new Error(`${service} would not stop`);
  }
  count(call: string): number {
    return this.calls.filter((c) => c === call).length;
  }
}

/** A process table. `survives` lists the PIDs that ignore both signals. */
export class FakeProcesses implements Processes {
  table: ProcessView[] = [];
  readonly signals: { pid: number; force: boolean }[] = [];
  readonly survives = new Set<number>();
  list(): ProcessView[] {
    return this.table.map((p) => ({ ...p }));
  }
  signal(pid: number, force: boolean): void {
    this.signals.push({ pid, force });
    if (!this.survives.has(pid)) this.table = this.table.filter((p) => p.pid !== pid);
  }
}

/**
 * The Docker volume port in memory. `create` makes a labelled, empty, unused volume, as the real create does. The port
 * has no remove method, so a test cannot see a deletion; `calls` records every call for the reuse checks.
 */
export class FakeWorldVolumes implements WorldVolumes {
  readonly volumes = new Map<string, VolumeState>();
  readonly calls: string[] = [];
  async inspect(name: string): Promise<VolumeState> {
    this.calls.push(`inspect:${name}`);
    const found = this.volumes.get(name);
    return { ...(found ?? { exists: false, labelled: false, empty: false, usedBy: [] }) };
  }
  async create(name: string, runId: string): Promise<void> {
    this.calls.push(`create:${name}:${runId}`);
    this.volumes.set(name, { exists: true, labelled: true, empty: true, usedBy: [] });
  }
}

export class FakeReporter implements Reporter {
  readonly runs: string[] = [];
  fail = false;
  async reportRun(runId: string): Promise<void> {
    this.runs.push(runId);
    if (this.fail) throw new Error('the report could not be written');
  }
}

/** Facts that pass every precondition for the profile: a clean tree, a gate at HEAD, the profile's life id. */
export function passingPreflight(
  profile: Profile,
  over: { otherChanges?: string[]; shardEdit?: import('../src/shard-edit.ts').ShardEdit } = {},
): Preflight {
  const bench = {
    meta: { commit: 'abc123' },
    truncated: false,
    summary: [{ scenario: 'food', tps: 20, successPct: 100 }],
  };
  return {
    async gather(): Promise<PreflightFacts> {
      return {
        facts: {
          profile,
          headSha: 'abc123',
          otherChanges: over.otherChanges ?? [],
          shardEdit: over.shardEdit ?? { kind: 'none' },
          bench: { file: '20261109T000000Z-abc123.json', text: JSON.stringify(bench) },
          pins: [],
          observedDigests: {},
          loadedModels: [],
          prepared:
            profile === 'smoke'
              ? null
              : {
                  schema: PREPARED_SCHEMA,
                  profile,
                  runId: 'run-1',
                  worldVolume: FAKE_WORLD_VOLUME,
                  preparedAt: '2026-11-10T00:00:00Z',
                },
          volume:
            profile === 'smoke' ? null : { exists: true, labelled: true, empty: true, usedBy: [] },
          worldVolumeEnv: FAKE_WORLD_VOLUME,
          lifeId: LIFE_ID[profile],
        },
        shardConfigSha256: 'a'.repeat(64),
        criteriaSha256: 'b'.repeat(64),
      };
    },
  };
}
