import { describe, expect, it } from 'vitest';
import { parsePresence, watchPresence } from './presence.ts';

const LIFE = 'ag_jason_01';

function record(desired: 'up' | 'down', life = LIFE): string {
  return JSON.stringify({
    life_id: life,
    state: desired === 'up' ? 'awake' : 'hibernating',
    desired_body: desired,
    at: '2026-11-09T12:00:00Z',
  });
}

/** Yields the values in order, then ends. */
async function* values(items: (string | null)[]): AsyncGenerator<string | null> {
  for (const item of items) yield item;
}

describe('parsePresence', () => {
  it('reads a valid record of the life', () => {
    expect(parsePresence(record('up'), LIFE)?.desired_body).toBe('up');
  });

  it('refuses a record of another life', () => {
    expect(parsePresence(record('up', 'ag_billy_01'), LIFE)).toBeNull();
  });

  it('refuses text that is not JSON and JSON that fails the contract', () => {
    expect(parsePresence('{not json', LIFE)).toBeNull();
    expect(parsePresence(JSON.stringify({ life_id: LIFE, desired_body: 'up' }), LIFE)).toBeNull();
  });
});

describe('watchPresence', () => {
  it('calls up and down in the order the records arrive, skipping deletions', async () => {
    const calls: string[] = [];
    const logs: Record<string, unknown>[] = [];
    await watchPresence({
      lifeId: LIFE,
      entries: values([record('up'), null, record('down'), '{bad', record('up')]),
      handlers: {
        async up() {
          calls.push('up');
        },
        async down() {
          calls.push('down');
        },
      },
      signal: new AbortController().signal,
      log: (line) => logs.push(line),
    });
    expect(calls).toEqual(['up', 'down', 'up']);
    expect(logs.some((line) => line.event === 'presence_ignored')).toBe(true);
  });

  it('logs a presence line only when the state changes, but still acts on every record', async () => {
    const calls: string[] = [];
    const logs: Record<string, unknown>[] = [];
    await watchPresence({
      lifeId: LIFE,
      entries: values([record('up'), record('up'), record('up'), record('down'), record('down')]),
      handlers: {
        async up() {
          calls.push('up');
        },
        async down() {
          calls.push('down');
        },
      },
      signal: new AbortController().signal,
      log: (line) => logs.push(line),
    });
    expect(calls).toEqual(['up', 'up', 'up', 'down', 'down']);
    expect(logs.filter((line) => line.event === 'presence')).toHaveLength(2);
  });

  it('ends at once when the signal aborts, even with no entry pending', async () => {
    const controller = new AbortController();
    const never = (async function* () {
      await new Promise<void>(() => undefined);
    })();
    const done = watchPresence({
      lifeId: LIFE,
      entries: never,
      handlers: { up: async () => undefined, down: async () => undefined },
      signal: controller.signal,
      log: () => undefined,
    });
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  });
});
