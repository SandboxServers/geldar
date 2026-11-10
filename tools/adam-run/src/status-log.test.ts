import { describe, expect, it } from 'vitest';
import { appendStatus, type StatusLine, statusLine } from './status-log.ts';
import { PROBES, type FileStore, type Observation } from './ports.ts';

const obs = (atMs: number, tps: number | null): Observation => ({
  atMs,
  lifeId: 'ag_adam_01',
  alive: Object.fromEntries(PROBES.map((p) => [p, true])) as Observation['alive'],
  thoughts: 4,
  lastThoughtAtMs: atMs - 5_000,
  tps,
  latencyP95Ms: 9_000,
  activeIntentId: null,
  deaths: 0,
  gpuPresent: true,
  diskFreeGb: 50,
  bodyConnected: true,
  errorsSinceLast: 0,
});

function appendOnlyStore(): FileStore & { text: () => string } {
  let text = '';
  return { read: () => text, write: () => {}, append: (_p, t) => (text += t), text: () => text };
}

describe('statusLine', () => {
  it.each([
    ['a sample with a TPS reading', 20, 20],
    ['a sample when the Golem has not reported', null, null],
  ])('%s keeps the TPS as null, never zero', (_name, tps, expected) => {
    expect(statusLine(obs(60_000, tps), 1).tps).toBe(expected);
  });

  it('writes every probe, the thought count and the last thought time', () => {
    const line = statusLine(obs(120_000, 20), 2);
    expect(Object.keys(line.alive).sort()).toEqual([...PROBES].sort());
    expect(line).toMatchObject({ minute: 2, thoughts: 4, last_thought_at: '1970-01-01T00:01:55.000Z' });
  });

  it('marks a harness event on its own line', () => {
    expect(statusLine(obs(0, 20), 0, 'body-kill', 'intent i-7').event).toBe('body-kill');
  });
});

describe('appendStatus', () => {
  it('appending twice keeps the first line byte-identical', () => {
    const store = appendOnlyStore();
    const first: StatusLine = statusLine(obs(60_000, 20), 1);
    appendStatus(store, 'status.log', first);
    const beforeSecond = store.text();
    appendStatus(store, 'status.log', statusLine(obs(120_000, 19.8), 2));
    expect(store.text().startsWith(beforeSecond)).toBe(true);
    expect(store.text().split('\n').filter((l) => l !== '')).toHaveLength(2);
  });

  it('writes one JSON object per line', () => {
    const store = appendOnlyStore();
    appendStatus(store, 'status.log', statusLine(obs(60_000, 20), 1));
    expect(() => JSON.parse(store.text().trim())).not.toThrow();
  });
});
