import { STANDARD_SHEET } from '@geldar/psyche';
import { describe, expect, it, vi } from 'vitest';
import type { LifeCharacter } from './character-config.ts';
import { natsStateTransport, type StateNats, startProficiency } from './proficiency-host.ts';

const SHARD = 'phase0';
const LIFE = 'ag_adam_01';
const REQUEST = `geldar.${SHARD}.state.${LIFE}.proficiency`;
const DOMAINS = ['combat', 'farming', 'mining', 'building', 'crafting', 'exploring', 'social'];
const VALID_STATE = JSON.stringify({
  life_id: LIFE,
  version: 1,
  levels: Object.fromEntries(DOMAINS.map((d) => [d, { level: 0, xp: 0 }])),
});
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CONFIG: LifeCharacter = {
  config: { mode: 'sheet', rolls: false, proficiency: { enabled: true, thresholds: [10, 20, 30] } },
  sheet: STANDARD_SHEET,
  source: 'config',
};
const STANDARD: LifeCharacter = { ...CONFIG, source: 'standard' };
const OFF: LifeCharacter = {
  config: { mode: 'off', rolls: false, proficiency: { enabled: false, thresholds: [10, 20, 30] } },
  sheet: null,
  source: 'off',
};

/** A NATS connection as the host sees it: it records each request and unsubscribe, and yields the given status. */
function fakeNats(statuses: Array<{ type: string }> = []) {
  const requests: string[] = [];
  let unsubscribed = 0;
  const nc: StateNats = {
    async request(subject) {
      requests.push(subject);
      return { data: encoder.encode(VALID_STATE) };
    },
    subscribe() {
      return {
        unsubscribe() {
          unsubscribed += 1;
        },
      };
    },
    status() {
      return (async function* () {
        yield* statuses;
      })();
    },
  };
  return { nc, requests, unsubscribed: () => unsubscribed };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('natsStateTransport (AN-12a)', () => {
  it('requests with the body and the timeout, and returns the decoded reply', async () => {
    const calls: Array<{ subject: string; data: string; timeout: number }> = [];
    const transport = natsStateTransport({
      request: async (subject, data, opts) => {
        calls.push({ subject, data: decoder.decode(data), timeout: opts.timeout });
        return { data: encoder.encode('{"ok":true}') };
      },
      subscribe: () => ({ unsubscribe: () => undefined }),
    });
    await expect(transport.request(REQUEST, '{"q":1}', 2000)).resolves.toBe('{"ok":true}');
    expect(calls).toEqual([{ subject: REQUEST, data: '{"q":1}', timeout: 2000 }]);
  });

  it('delivers a message without error, drops one with an error, and unsubscribes once', () => {
    const delivered: string[] = [];
    let unsubscribed = 0;
    let callback: ((err: unknown, msg: { data: Uint8Array }) => void) | undefined;
    const transport = natsStateTransport({
      request: async () => ({ data: new Uint8Array() }),
      subscribe: (_subject, opts) => {
        callback = opts.callback;
        return {
          unsubscribe() {
            unsubscribed += 1;
          },
        };
      },
    });
    const off = transport.subscribe(REQUEST, (body) => delivered.push(body));
    callback?.(null, { data: encoder.encode('first') });
    callback?.(new Error('bad frame'), { data: encoder.encode('dropped') });
    expect(delivered).toEqual(['first']);
    off();
    expect(unsubscribed).toBe(1);
  });
});

describe('startProficiency (AN-12a)', () => {
  it('starts only for a config sheet: a standard or off life gets no cache and sends no request', async () => {
    for (const character of [undefined, STANDARD, OFF]) {
      const fake = fakeNats();
      const cache = startProficiency({
        nc: fake.nc,
        shard: SHARD,
        lifeId: LIFE,
        character,
        log: () => undefined,
      });
      await flush();
      expect(cache).toBeUndefined();
      expect(fake.requests).toEqual([]);
    }
  });

  it('a config sheet starts one cache that requests the state on start', async () => {
    const fake = fakeNats();
    const cache = startProficiency({
      nc: fake.nc,
      shard: SHARD,
      lifeId: LIFE,
      character: CONFIG,
      log: () => undefined,
    });
    expect(cache).toBeDefined();
    await flush();
    expect(fake.requests).toEqual([REQUEST]);
    cache?.stop();
  });

  it('validates replies against the config thresholds: a level 2 at xp 15 is adopted on [5,15,40]', async () => {
    const reply = JSON.stringify({
      life_id: LIFE,
      version: 1,
      levels: Object.fromEntries(
        DOMAINS.map((d) => [d, d === 'combat' ? { level: 2, xp: 15 } : { level: 0, xp: 0 }]),
      ),
    });
    const requests: string[] = [];
    const nc: StateNats = {
      async request(subject) {
        requests.push(subject);
        return { data: encoder.encode(reply) };
      },
      subscribe: () => ({ unsubscribe: () => undefined }),
      status: () => (async function* () {})(),
    };
    const character: LifeCharacter = {
      ...CONFIG,
      config: { ...CONFIG.config, proficiency: { enabled: true, thresholds: [5, 15, 40] } },
    };
    const cache = startProficiency({
      nc,
      shard: SHARD,
      lifeId: LIFE,
      character,
      log: () => undefined,
    });
    await flush();
    expect(requests).toEqual([REQUEST]);
    expect(cache?.level('combat')).toBe(2);
    cache?.stop();
  });

  it('proficiency.enabled false: no cache is built and no request is sent', async () => {
    const fake = fakeNats();
    const character: LifeCharacter = {
      ...CONFIG,
      config: { ...CONFIG.config, proficiency: { enabled: false, thresholds: [10, 20, 30] } },
    };
    const cache = startProficiency({
      nc: fake.nc,
      shard: SHARD,
      lifeId: LIFE,
      character,
      log: () => undefined,
    });
    await flush();
    expect(cache).toBeUndefined();
    expect(fake.requests).toEqual([]);
  });

  it('a malformed life id is logged once and gives no cache: no throw, no request', async () => {
    const fake = fakeNats();
    const lines: string[] = [];
    let cache: ReturnType<typeof startProficiency>;
    expect(() => {
      cache = startProficiency({
        nc: fake.nc,
        shard: SHARD,
        lifeId: 'Adam',
        character: CONFIG,
        log: (line) => lines.push(line),
      });
    }).not.toThrow();
    await flush();
    expect(cache).toBeUndefined();
    expect(fake.requests).toEqual([]);
    expect(lines).toEqual([
      'proficiency cache not built: the shard or life id is not a valid subject token',
    ]);
  });

  it('refreshes on each reconnect and not on other status changes', async () => {
    const fake = fakeNats([{ type: 'disconnect' }, { type: 'reconnect' }]);
    const cache = startProficiency({
      nc: fake.nc,
      shard: SHARD,
      lifeId: LIFE,
      character: CONFIG,
      log: () => undefined,
    });
    await vi.waitFor(() => expect(fake.requests).toEqual([REQUEST, REQUEST]));
    await flush();
    expect(fake.requests).toHaveLength(2);
    cache?.stop();
  });

  it('stop is idempotent: the subscription is released once, and no refresh follows', async () => {
    const fake = fakeNats();
    const cache = startProficiency({
      nc: fake.nc,
      shard: SHARD,
      lifeId: LIFE,
      character: CONFIG,
      log: () => undefined,
    });
    await flush();
    cache?.stop();
    expect(() => cache?.stop()).not.toThrow();
    expect(fake.unsubscribed()).toBe(1);
    await cache?.refresh();
    expect(fake.requests).toHaveLength(1);
  });
});
