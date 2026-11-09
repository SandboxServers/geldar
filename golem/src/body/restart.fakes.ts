import { fakeBot, fakeView, manualTicks } from './body.fakes.ts';
import type { BodyKv, CheckpointEntry, KvRecord } from './checkpoint.ts';
import { fakeId, LIFE, planFor, scriptedProgram, thought } from './executor.fakes.ts';
import { ProgramRegistry } from './program.ts';
import type { MemorySink } from './records.ts';
import { restartBody } from './restart.ts';
/** An in-memory bucket with revisions, so `create` and `update` conflict as JetStream's do. */
export interface FakeKv extends BodyKv {
  /** The live value of `key`, or undefined. */
  peek(key: string): string | undefined;
  /** Makes the next `n` calls of `put` reject. */
  failPuts(n: number): void;
  /** Writes `key` directly, as another process would. */
  seed(key: string, value: string): void;
  /** Makes the next `n` calls of `delete` reject. */
  failDeletes(n: number): void;
  /** Makes the next `n` calls of `get` reject. */
  failGets(n: number): void;
  puts: number;
  deletes: number;
  gets: number;
}

/** `gap` makes every `get` yield once after reading, so two racing callers see the same revision. */
export function fakeKv(opts: { gap?: boolean } = {}): FakeKv {
  const data = new Map<string, KvRecord>();
  let revision = 0;
  let failing = 0;
  let failingDeletes = 0;
  let failingGets = 0;
  const write = (key: string, value: string): number => {
    revision += 1;
    data.set(key, { value, revision });
    return revision;
  };
  const kv: FakeKv = {
    puts: 0,
    deletes: 0,
    gets: 0,
    failDeletes: (n) => {
      failingDeletes = n;
    },
    failGets: (n) => {
      failingGets = n;
    },
    peek: (key) => data.get(key)?.value,
    failPuts: (n) => {
      failing = n;
    },
    seed: (key, value) => {
      write(key, value);
    },
    async get(key) {
      kv.gets += 1;
      if (failingGets > 0) {
        failingGets -= 1;
        throw new Error('bucket unreadable');
      }
      const record = data.get(key);
      const copy = record ? { ...record } : null;
      if (opts.gap) await Promise.resolve();
      return copy;
    },
    async create(key, value) {
      if (data.has(key)) throw new Error('wrong last sequence');
      return write(key, value);
    },
    async update(key, value, expected) {
      if (data.get(key)?.revision !== expected) throw new Error('wrong last sequence');
      return write(key, value);
    },
    async put(key, value) {
      kv.puts += 1;
      if (failing > 0) {
        failing -= 1;
        throw new Error('bucket unavailable');
      }
      return write(key, value);
    },
    async delete(key) {
      kv.deletes += 1;
      if (failingDeletes > 0) {
        failingDeletes -= 1;
        throw new Error('bucket unavailable');
      }
      data.delete(key);
    },
  };
  return kv;
}

/** One Body life's two buckets, shared by every boot of the test. */
export function buckets(): { generations: FakeKv; checkpoints: FakeKv } {
  return { generations: fakeKv(), checkpoints: fakeKv() };
}

/** Boots a Body over fakes through `restartBody`. `programs` collects every program instance made. */
export async function boot(
  kv: ReturnType<typeof buckets>,
  opts: {
    /** The world tick the view starts at; null for a view that does not know it yet. */
    tick?: number | null;
    /** Sets the view's tick this many ms after the boot starts, as the first time update would. */
    laterTick?: { afterMs: number; tick: number };
    schedule?: (fire: () => void, ms: number) => () => void;
    restart?: Partial<Parameters<typeof restartBody>[0]>;
  } = {},
) {
  const ticks = manualTicks();
  const view = fakeView();
  const settable = view as { tick: number | null };
  settable.tick = opts.tick === undefined ? 0 : opts.tick;
  if (opts.laterTick !== undefined) {
    const later = opts.laterTick;
    setTimeout(() => {
      settable.tick = later.tick;
    }, later.afterMs);
  }
  const programs = new ProgramRegistry();
  const made: ReturnType<typeof scriptedProgram>[] = [];
  programs.register('fake', () => {
    const program = scriptedProgram([{ status: 'running' }]);
    made.push(program);
    return program;
  });
  const lines: string[] = [];
  const restarted = await restartBody({
    lifeId: LIFE,
    bot: fakeBot(),
    ticks: ticks.source,
    currentRevision: () => 5,
    view,
    programs,
    kv,
    log: (line) => lines.push(line),
    generation: { retryDelayMs: 0 },
    ...(opts.schedule === undefined ? {} : { schedule: opts.schedule }),
    ...opts.restart,
  });
  const records = restarted.body.records as MemorySink;
  return { ...restarted, view, made, lines, records };
}

/** Submits a `fake` intent as the Mind would for this boot's generation. */
export async function startIntent(b: Awaited<ReturnType<typeof boot>>, n = 1) {
  return b.body.executor.submit(
    thought({ intent: {} }),
    planFor(0, { n, bodyGeneration: b.generation }),
  );
}

/** A stored entry for the life, written as another Body would have left it. */
export function entry(over: Partial<CheckpointEntry> = {}): string {
  const intent = (thought({ intent: {} }) as { intent: CheckpointEntry['intent'] }).intent;
  const full: CheckpointEntry = {
    life_id: LIFE,
    body_generation: 1,
    intent_id: fakeId('in', 1),
    intent,
    program: 'fake',
    checkpoint: { steps: 3 },
    saved_at: '2026-01-01T00:00:00.000Z',
    expires_tick: 1000,
    ...over,
  };
  return JSON.stringify(full);
}
