import { describe, expect, it } from 'vitest';
import { type AbortCriteria, evaluateAbort, type Sample, sustained } from './abort.ts';

const MIN = 60_000;
const criteria: AbortCriteria = {
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

/** A healthy sample at minute `m`; each test overrides the field it exercises. */
function healthy(m: number, over: Partial<Sample> = {}): Sample {
  return {
    atMs: m * MIN,
    tps: 20,
    latencyP95Ms: 5_000,
    ollamaUp: true,
    postgresUp: true,
    natsUp: true,
    bodyConnected: true,
    gpuPresent: true,
    deaths: 0,
    diskFreeGb: 100,
    lastThoughtAtMs: m * MIN,
    ...over,
  };
}

/** Samples for minutes 0..last, with `bad` applied to each minute from `from` to `last`. */
function run(last: number, from: number, bad: Partial<Sample>): Sample[] {
  const out: Sample[] = [];
  for (let m = 0; m <= last; m++) {
    out.push(m >= from ? healthy(m, bad) : healthy(m));
  }
  return out;
}

describe('sustained', () => {
  it('needs the whole window, and a good sample breaks the run', () => {
    const h = [healthy(0), healthy(1, { tps: 10 }), healthy(2, { tps: 10 })];
    const low = (s: Sample) => s.tps !== null && s.tps < 19.5;
    expect(sustained(h, 2 * MIN, MIN, low)).toBe(true);
    expect(sustained(h, 2 * MIN, 2 * MIN, low)).toBe(false);
    expect(sustained([healthy(0, { tps: 10 }), healthy(1)], MIN, MIN, low)).toBe(false);
  });
});

describe('evaluateAbort', () => {
  const now = 30 * MIN;

  it('does not fire on a healthy run', () => {
    expect(evaluateAbort(run(30, 99, {}), now, criteria)).toBeNull();
  });

  it('returns null for an empty history', () => {
    expect(evaluateAbort([], now, criteria)).toBeNull();
  });

  // Table: each rule fires when its condition holds for its window, and does not fire one minute short.
  const table: Array<{
    name: string;
    rule: string;
    bad: Partial<Sample>;
    from: number;
    last: number;
  }> = [
    {
      name: 'TPS under 19.5 for 5 minutes fires',
      rule: 'tps',
      bad: { tps: 19.4 },
      from: 25,
      last: 30,
    },
    {
      name: 'TPS under 19.5 for 4 minutes does not',
      rule: '',
      bad: { tps: 19.4 },
      from: 27,
      last: 30,
    },
    {
      name: 'p95 over 15 s for 30 minutes fires',
      rule: 'latency',
      bad: { latencyP95Ms: 15_001 },
      from: 0,
      last: 30,
    },
    {
      name: 'p95 over 15 s for 29 minutes does not',
      rule: '',
      bad: { latencyP95Ms: 15_001 },
      from: 1,
      last: 30,
    },
    {
      name: 'Ollama down for 5 minutes fires',
      rule: 'ollama',
      bad: { ollamaUp: false },
      from: 25,
      last: 30,
    },
    {
      name: 'Postgres down for 5 minutes fires',
      rule: 'postgres',
      bad: { postgresUp: false },
      from: 25,
      last: 30,
    },
    {
      name: 'NATS down for 5 minutes fires',
      rule: 'nats',
      bad: { natsUp: false },
      from: 25,
      last: 30,
    },
    {
      name: 'NATS down for 4 minutes does not',
      rule: '',
      bad: { natsUp: false },
      from: 27,
      last: 30,
    },
    {
      name: 'Body disconnected for 5 minutes fires',
      rule: 'body',
      bad: { bodyConnected: false },
      from: 25,
      last: 30,
    },
    {
      name: 'a hung Body (no events, process alive) for 5 minutes fires',
      rule: 'body',
      bad: { bodyConnected: false },
      from: 25,
      last: 30,
    },
    {
      name: 'a hung Body (no events, process alive) for 4 minutes does not',
      rule: '',
      bad: { bodyConnected: false },
      from: 26,
      last: 30,
    },
    {
      name: 'GPU absent fires at once',
      rule: 'gpu',
      bad: { gpuPresent: false },
      from: 30,
      last: 30,
    },
    {
      name: 'a death fires as life_ended (deaths fail the run)',
      rule: 'life_ended',
      bad: { deaths: 1 },
      from: 30,
      last: 30,
    },
    {
      name: 'free disk under 10 GB fires',
      rule: 'disk',
      bad: { diskFreeGb: 9.9 },
      from: 30,
      last: 30,
    },
    {
      name: 'disk exactly 10 GB does not fire',
      rule: '',
      bad: { diskFreeGb: 10 },
      from: 30,
      last: 30,
    },
    {
      name: 'no thought for 10 minutes fires',
      rule: 'no-thought',
      bad: { lastThoughtAtMs: 0 },
      from: 0,
      last: 30,
    },
    {
      name: 'no thought for 9 minutes does not',
      rule: '',
      bad: { lastThoughtAtMs: 21 * MIN },
      from: 21,
      last: 30,
    },
  ];

  for (const row of table) {
    it(row.name, () => {
      const hit = evaluateAbort(run(row.last, row.from, row.bad), row.last * MIN, criteria);
      expect(hit?.rule ?? '').toBe(row.rule);
    });
  }

  it('a death does not fire when deaths do not fail the run', () => {
    const c = { ...criteria, deathFailsRun: false };
    expect(evaluateAbort(run(30, 30, { deaths: 1 }), now, c)).toBeNull();
  });

  it('no thought does not fire once the life has ended', () => {
    const c = { ...criteria, deathFailsRun: false };
    // The life ended at minute 5; its last thought was at 0, so only the ended life explains the silence.
    const h = run(30, 5, { deaths: 1, lastThoughtAtMs: 0 });
    expect(evaluateAbort(h, now, c)).toBeNull();
  });

  it('a death counted before the first sample still fires life_ended (deaths are counted from the run start)', () => {
    const h = run(30, 0, { deaths: 2 });
    expect(evaluateAbort(h, now, criteria)).toMatchObject({ rule: 'life_ended' });
  });

  it('a null TPS or p95 (not reported yet) never fires the TPS or latency rule', () => {
    expect(evaluateAbort(run(30, 0, { tps: null, latencyP95Ms: null }), now, criteria)).toBeNull();
  });
});
