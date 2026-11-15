import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Domain } from '@geldar/psyche';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  proficiencyPushSubject,
  proficiencyRequestSubject,
} from '../../../contract/src/subjects.ts';
import { ProficiencyCache, type StateTransport } from './proficiency-cache.ts';

const SHARD = 'phase0';
const LIFE = 'ag_test_01';
const REQUEST = `geldar.${SHARD}.state.${LIFE}.proficiency`;
const PUSH = `geldar.${SHARD}.state.${LIFE}.level`;
const DOMAINS: readonly Domain[] = [
  'combat',
  'farming',
  'mining',
  'building',
  'crafting',
  'exploring',
  'social',
];
const SHEET = {
  version: 1,
  attributes: { curiosity: 2, common_sense: 3, cleverness: 4, aggression: 5 },
  alignment: { law: 1, good: 2 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
};

type Pair = [level: number, xp: number];

function levelMap(
  over: Partial<Record<Domain, Pair>> = {},
): Record<string, { level: number; xp: number }> {
  const out: Record<string, { level: number; xp: number }> = {};
  for (const d of DOMAINS) {
    const [level, xp] = over[d] ?? [0, 0];
    out[d] = { level, xp };
  }
  return out;
}

function stateBody(version: number, over: Partial<Record<Domain, Pair>> = {}) {
  return JSON.stringify({ life_id: LIFE, version, levels: levelMap(over) });
}

function pushBody(domain: Domain, level: number, xp: number, version: number): string {
  return JSON.stringify({ life_id: LIFE, domain, level, xp, version });
}

const REFUSED = () => Promise.reject(new Error('no responders'));

class FakeTransport implements StateTransport {
  readonly requests: { subject: string; body: string; timeoutMs: number }[] = [];
  readonly listeners = new Map<string, Set<(body: string) => void>>();
  readonly unsubscribed: string[] = [];
  responder: (subject: string, body: string) => Promise<string> = REFUSED;

  request(subject: string, body: string, timeoutMs: number): Promise<string> {
    this.requests.push({ subject, body, timeoutMs });
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      this.responder(subject, body).then(
        (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  subscribe(subject: string, onMessage: (body: string) => void): () => void {
    const set = this.listeners.get(subject) ?? new Set<(body: string) => void>();
    set.add(onMessage);
    this.listeners.set(subject, set);
    return () => {
      set.delete(onMessage);
      this.unsubscribed.push(subject);
    };
  }

  emit(subject: string, body: string): void {
    for (const onMessage of [...(this.listeners.get(subject) ?? [])]) onMessage(body);
  }
}

let transport: FakeTransport;
let logs: string[];
let cache: ProficiencyCache | undefined;

function make(o: { retryMs?: number } = {}): ProficiencyCache {
  cache = new ProficiencyCache({
    transport,
    shard: SHARD,
    lifeId: LIFE,
    log: (line) => logs.push(line),
    ...o,
  });
  return cache;
}

beforeEach(() => {
  vi.useFakeTimers();
  transport = new FakeTransport();
  logs = [];
  cache = undefined;
});

afterEach(() => {
  cache?.stop();
  vi.useRealTimers();
});

describe('ProficiencyCache', () => {
  it('cold start: a reply sets levels and version', async () => {
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    const c = make();
    await c.start();
    expect(transport.requests[0]?.subject).toBe(REQUEST);
    expect(JSON.parse(transport.requests[0]?.body ?? '{}')).toEqual({ life_id: LIFE });
    expect(transport.requests[0]?.timeoutMs).toBe(2000);
    expect(c.version).toBe(40);
    expect(c.level('combat')).toBe(1);
    expect(c.level('mining')).toBe(0);
    expect(c.degraded).toBe(false);
    expect(logs).toEqual([]);
  });

  it('first adoption: a cold reply at version 0 fills the cache', async () => {
    transport.responder = () => Promise.resolve(stateBody(0, { combat: [1, 12] }));
    const c = make();
    await c.start();
    expect(c.version).toBe(0);
    expect(c.level('combat')).toBe(1);
    expect(c.degraded).toBe(false);
  });

  it('a reply that carries a sheet is refused: the cache keeps no sheet and no baseline', async () => {
    const withSheet = JSON.parse(stateBody(40, { combat: [1, 12] }));
    transport.responder = () => Promise.resolve(JSON.stringify({ ...withSheet, sheet: SHEET }));
    const c = make();
    await c.start();
    expect(c.version).toBe(0);
    expect(c.level('combat')).toBe(0);
    expect(c.degraded).toBe(true);
    expect('baseline' in c).toBe(false);
    expect(logs.some((l) => /invalid/.test(l))).toBe(true);
  });

  it('level() answers from memory before start, without blocking', () => {
    const c = make();
    expect(c.level('combat')).toBe(0);
    expect(c.version).toBe(0);
    expect(c.degraded).toBe(true);
  });

  it('no responder: zeros, degraded, three attempts, then a retry after retryMs, logged once', async () => {
    const c = make();
    await c.start();
    expect(transport.requests).toHaveLength(3);
    expect(c.degraded).toBe(true);
    expect(c.level('combat')).toBe(0);
    expect(c.version).toBe(0);
    expect(logs).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(transport.requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.requests).toHaveLength(6);
    expect(logs).toHaveLength(1);
    expect(c.degraded).toBe(true);
  });

  it('the last allowed attempt can succeed and then nothing more is sent', async () => {
    let calls = 0;
    transport.responder = () => {
      calls += 1;
      return calls < 3
        ? Promise.reject(new Error('no responders'))
        : Promise.resolve(stateBody(7, { social: [2, 40] }));
    };
    const c = make();
    await c.start();
    expect(transport.requests).toHaveLength(3);
    expect(c.degraded).toBe(false);
    expect(c.version).toBe(7);
    expect(c.level('social')).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.requests).toHaveLength(3);
    expect(logs).toEqual([]);
  });

  it('a timeout counts as a failed attempt, with the timeout passed to the transport', async () => {
    transport.responder = () => new Promise<string>(() => undefined);
    const c = make();
    const started = c.start();
    await vi.advanceTimersByTimeAsync(6000);
    await started;
    expect(transport.requests).toHaveLength(3);
    expect(transport.requests.every((r) => r.timeoutMs === 2000)).toBe(true);
    expect(c.degraded).toBe(true);
    expect(logs).toHaveLength(1);
  });

  it('a push changes nothing by itself; a newer push starts one confirming request', async () => {
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    const c = make();
    await c.start();
    transport.responder = REFUSED;
    transport.emit(PUSH, pushBody('mining', 2, 35, 50));
    expect(transport.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.version).toBe(40);
    expect(c.level('mining')).toBe(0);
    expect(c.degraded).toBe(false);
  });

  it('a push during start is not adopted; the confirming reply is', async () => {
    let calls = 0;
    transport.responder = () => {
      calls += 1;
      if (calls === 1) {
        transport.emit(PUSH, pushBody('exploring', 1, 10, 5));
        return REFUSED();
      }
      return Promise.resolve(stateBody(5, { exploring: [1, 10] }));
    };
    const c = make();
    await c.start();
    expect(c.version).toBe(5);
    expect(c.level('exploring')).toBe(1);
    expect(c.degraded).toBe(false);
    expect(transport.requests).toHaveLength(3);
  });

  it('a level-up push during a refresh is not adopted; the reply that confirms it is', async () => {
    const c = make();
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    await c.start();
    let calls = 0;
    transport.responder = () => {
      calls += 1;
      if (calls === 1) {
        transport.emit(PUSH, pushBody('combat', 2, 33, 45));
        return Promise.resolve(stateBody(40, { combat: [1, 12] }));
      }
      return Promise.resolve(stateBody(45, { combat: [2, 33] }));
    };
    await c.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.version).toBe(45);
    expect(c.level('combat')).toBe(2);
    expect(c.degraded).toBe(false);
  });

  it('a failed refresh keeps the previously validated state and records degraded', async () => {
    const c = make();
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    await c.start();
    transport.responder = REFUSED;
    await c.refresh();
    expect(transport.requests).toHaveLength(4);
    expect(c.degraded).toBe(true);
    expect(c.version).toBe(40);
    expect(c.level('combat')).toBe(1);
  });

  it('an equal-version reply is adopted; an older reply is ignored; an equal push changes nothing', async () => {
    const c = make();
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    await c.start();
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [3, 80] }));
    await c.refresh();
    expect(c.level('combat')).toBe(3);
    transport.responder = () => Promise.resolve(stateBody(39, {}));
    await c.refresh();
    expect(c.version).toBe(40);
    expect(c.level('combat')).toBe(3);
    const before = transport.requests.length;
    transport.emit(PUSH, pushBody('mining', 1, 10, 40));
    expect(transport.requests).toHaveLength(before);
    expect(c.level('mining')).toBe(0);
  });

  it('an equal-version reply after a push at that version fills the other domains', async () => {
    transport.responder = () => {
      transport.emit(PUSH, pushBody('combat', 2, 33, 40));
      return Promise.resolve(stateBody(40, { mining: [2, 35] }));
    };
    const c = make();
    await c.start();
    expect(c.version).toBe(40);
    expect(c.level('mining')).toBe(2);
    expect(c.level('combat')).toBe(0);
    expect(c.degraded).toBe(false);
  });

  it('an invalid reply is ignored and logged without its values', async () => {
    const bad = JSON.stringify({
      life_id: LIFE,
      version: 9,
      levels: levelMap({ combat: [2, 10] }),
      sheet: { ...SHEET, attributes: { ...SHEET.attributes, aggression: 9 } },
    });
    transport.responder = () => Promise.resolve(bad);
    const c = make();
    await c.start();
    expect(c.version).toBe(0);
    expect(c.level('combat')).toBe(0);
    expect(c.degraded).toBe(true);
    expect(logs.some((l) => /invalid/.test(l))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/aggression|xp|combat/);
  });

  it('a reply whose level does not match its xp is ignored', async () => {
    transport.responder = () => Promise.resolve(stateBody(9, { combat: [3, 10] }));
    const c = make();
    await c.start();
    expect(c.version).toBe(0);
    expect(c.level('combat')).toBe(0);
    expect(c.degraded).toBe(true);
  });

  it('a reply with an unsafe or non-integer version or xp is ignored', async () => {
    const bodies = [
      JSON.stringify({ life_id: LIFE, version: 1e300, levels: levelMap() }),
      JSON.stringify({ life_id: LIFE, version: 4.5, levels: levelMap() }),
      JSON.stringify({ life_id: LIFE, version: 9, levels: levelMap({ combat: [3, 1e300] }) }),
      JSON.stringify({ life_id: LIFE, version: 9, levels: levelMap({ combat: [0, 4.5] }) }),
    ];
    for (const body of bodies) {
      transport.responder = () => Promise.resolve(body);
      const c = make();
      await c.start();
      expect(c.version).toBe(0);
      expect(c.degraded).toBe(true);
      c.stop();
    }
  });

  it('the invalid-reply line is logged once per episode and again after a valid reply', async () => {
    const bad = JSON.stringify({
      life_id: LIFE,
      version: 9,
      levels: levelMap({ combat: [2, 10] }),
    });
    const invalid = () => logs.filter((l) => /invalid proficiency reply/.test(l));
    transport.responder = () => Promise.resolve(bad);
    const c = make();
    await c.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(transport.requests).toHaveLength(6);
    expect(invalid()).toHaveLength(1);
    transport.responder = () => Promise.resolve(stateBody(40, {}));
    await c.refresh();
    expect(c.degraded).toBe(false);
    transport.responder = () => Promise.resolve(bad);
    await c.refresh();
    expect(invalid()).toHaveLength(2);
  });

  it('a reply for another life is ignored', async () => {
    transport.responder = () =>
      Promise.resolve(JSON.stringify({ ...JSON.parse(stateBody(4)), life_id: 'ag_other_01' }));
    const c = make();
    await c.start();
    expect(c.version).toBe(0);
    expect(c.degraded).toBe(true);
  });

  it('an invalid push is ignored and logged', async () => {
    const c = make();
    transport.responder = REFUSED;
    await c.start();
    transport.emit(PUSH, pushBody('combat', 2, 10, 5));
    transport.emit(PUSH, pushBody('fishing' as Domain, 1, 10, 6));
    expect(c.version).toBe(0);
    expect(c.level('combat')).toBe(0);
    expect(logs.filter((l) => /invalid/.test(l))).toHaveLength(2);
  });

  it('a push for another life is refused and sends nothing', async () => {
    const c = make();
    transport.responder = REFUSED;
    await c.start();
    const before = transport.requests.length;
    transport.emit(
      PUSH,
      JSON.stringify({ ...JSON.parse(pushBody('combat', 2, 33, 50)), life_id: 'ag_other_01' }),
    );
    expect(transport.requests).toHaveLength(before);
    expect(logs.some((l) => /invalid proficiency push/.test(l))).toBe(true);
  });

  it('an unsafe or non-integer push is refused and sends nothing', async () => {
    const c = make();
    transport.responder = REFUSED;
    await c.start();
    const before = transport.requests.length;
    transport.emit(PUSH, pushBody('combat', 3, 1e300, 1e300));
    transport.emit(PUSH, pushBody('combat', 1, 12, 4.5));
    expect(transport.requests).toHaveLength(before);
    expect(logs.filter((l) => /invalid proficiency push/.test(l))).toHaveLength(2);
  });

  it('a burst of 100 newer pushes starts one confirming request', async () => {
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    const c = make();
    await c.start();
    transport.responder = () => Promise.resolve(stateBody(140, { combat: [2, 33] }));
    for (let v = 41; v <= 140; v++) transport.emit(PUSH, pushBody('combat', 2, 33, v));
    expect(transport.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.version).toBe(140);
    expect(c.level('combat')).toBe(2);
    expect(transport.requests).toHaveLength(2);
  });

  it('stop unsubscribes, cancels the retry timer and ignores a late reply', async () => {
    const c = make();
    await c.start();
    expect(transport.requests).toHaveLength(3);
    c.stop();
    expect(transport.unsubscribed).toEqual([PUSH]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.requests).toHaveLength(3);
  });

  it('stop clears the pending retry timer', async () => {
    const c = make();
    await c.start();
    expect(vi.getTimerCount()).toBe(1);
    c.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.requests).toHaveLength(3);
  });

  it('a push delivered after stop changes nothing and sends nothing', async () => {
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    const c = make();
    await c.start();
    const listener = [...(transport.listeners.get(PUSH) ?? [])][0];
    expect(listener).toBeDefined();
    c.stop();
    const before = transport.requests.length;
    listener?.(pushBody('mining', 2, 35, 50));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.requests).toHaveLength(before);
    expect(c.version).toBe(40);
    expect(c.level('mining')).toBe(0);
  });

  it('a reply that lands after stop changes nothing', async () => {
    let answer: ((body: string) => void) | undefined;
    transport.responder = () =>
      new Promise<string>((resolve) => {
        answer = resolve;
      });
    const c = make();
    const started = c.start();
    c.stop();
    answer?.(stateBody(9, { combat: [3, 90] }));
    await vi.advanceTimersByTimeAsync(6000);
    await started;
    expect(c.version).toBe(0);
    expect(c.level('combat')).toBe(0);
  });

  it('two concurrent refreshes leave exactly one retry timer', async () => {
    const c = make();
    await c.start();
    expect(vi.getTimerCount()).toBe(1);
    await Promise.all([c.refresh(), c.refresh()]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('start twice does not leak the first subscription', async () => {
    transport.responder = () => Promise.resolve(stateBody(40, {}));
    const c = make();
    await c.start();
    await c.start();
    expect(transport.listeners.get(PUSH)?.size).toBe(1);
    c.stop();
    expect(transport.listeners.get(PUSH)?.size).toBe(0);
    expect(transport.unsubscribed).toEqual([PUSH]);
  });

  it('a throwing log neither rejects start nor makes the retry an unhandled rejection', async () => {
    transport.responder = REFUSED;
    const c = new ProficiencyCache({
      transport,
      shard: SHARD,
      lifeId: LIFE,
      log: () => {
        throw new Error('log down');
      },
    });
    cache = c;
    await expect(c.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(transport.requests).toHaveLength(6);
  });

  it('a bad threshold list is refused at construction', () => {
    expect(
      () =>
        new ProficiencyCache({
          transport,
          shard: SHARD,
          lifeId: LIFE,
          thresholds: [30, 10, 70],
          log: () => undefined,
        }),
    ).toThrow(RangeError);
  });

  it('golem/src has no pg import', () => {
    const root = join(import.meta.dirname, '..');
    const files = readdirSync(root, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts'));
    const pg = /from\s+['"]pg(\/[^'"]*)?['"]|require\(\s*['"]pg['"]\s*\)|import\(\s*['"]pg['"]/;
    for (const f of files) {
      expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(pg);
    }
  });
});

// Drift guard: the cache's local subject strings must equal the contract's helpers, and both must refuse the same
// shard and life id inputs.
const VALID_PAIRS: [string, string][] = [
  ['phase0', 'ag_test_01'],
  ['a-b', 'ag_a_00'],
  ['ab', `ag_${'a'.repeat(16)}_99`],
  ['a'.repeat(32), 'ag_x1_123'],
];
const INVALID_PAIRS: [string, string][] = [
  ['Phase_0', LIFE],
  ['p', LIFE],
  ['1abc', LIFE],
  ['a.b', LIFE],
  ['a*', LIFE],
  ['', LIFE],
  ['a'.repeat(33), LIFE],
  [SHARD, 'AG'],
  [SHARD, 'ag_test_1'],
  [SHARD, 'ag_Test_01'],
  [SHARD, 'anything-1'],
  [SHARD, 'ag_a.b_01'],
  [SHARD, 'ag__01'],
  [SHARD, `ag_${'a'.repeat(17)}_01`],
  [SHARD, 'ag_test_01 '],
  [SHARD, 'ag_test_01*'],
];

describe('subject drift against contract/src/subjects.ts', () => {
  it.each(VALID_PAIRS)(
    'valid %s / %s: the local strings equal the contract helpers',
    (shard, life) => {
      const c = new ProficiencyCache({ transport, shard, lifeId: life, log: () => undefined });
      void c.start();
      c.stop();
      expect(transport.requests[0]?.subject).toBe(proficiencyRequestSubject(shard, life));
      expect([...transport.listeners.keys()]).toEqual([proficiencyPushSubject(shard, life)]);
    },
  );

  it.each(INVALID_PAIRS)('invalid %s / %s: both refuse', (shard, life) => {
    expect(() => proficiencyRequestSubject(shard, life)).toThrow();
    expect(() => proficiencyPushSubject(shard, life)).toThrow();
    expect(
      () => new ProficiencyCache({ transport, shard, lifeId: life, log: () => undefined }),
    ).toThrow(RangeError);
  });
});
