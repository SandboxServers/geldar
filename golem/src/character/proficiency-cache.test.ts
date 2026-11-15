import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Domain } from '@geldar/psyche';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function stateBody(version: number, over: Partial<Record<Domain, Pair>> = {}, sheet?: unknown) {
  const body: Record<string, unknown> = { life_id: LIFE, version, levels: levelMap(over) };
  if (sheet !== undefined) body.sheet = sheet;
  return JSON.stringify(body);
}

function pushBody(domain: Domain, level: number, xp: number, version: number): string {
  return JSON.stringify({ life_id: LIFE, domain, level, xp, version });
}

class FakeTransport implements StateTransport {
  readonly requests: { subject: string; body: string; timeoutMs: number }[] = [];
  readonly listeners = new Map<string, Set<(body: string) => void>>();
  readonly unsubscribed: string[] = [];
  responder: (subject: string, body: string) => Promise<string> = () =>
    Promise.reject(new Error('no responders'));

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
  it('cold start: a reply sets levels, version and the adopted baseline', async () => {
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }, SHEET));
    const c = make();
    await c.start();
    expect(transport.requests[0]?.subject).toBe(REQUEST);
    expect(JSON.parse(transport.requests[0]?.body ?? '{}')).toEqual({ life_id: LIFE });
    expect(transport.requests[0]?.timeoutMs).toBe(2000);
    expect(c.version).toBe(40);
    expect(c.level('combat')).toBe(1);
    expect(c.level('mining')).toBe(0);
    expect(c.degraded).toBe(false);
    expect(c.baseline?.sheet).toEqual(SHEET);
    expect(c.baseline?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(logs).toEqual([]);
  });

  it('level() answers from memory before start, without blocking', () => {
    const c = make();
    expect(c.level('combat')).toBe(0);
    expect(c.version).toBe(0);
    expect(c.degraded).toBe(true);
    expect(c.baseline).toBeNull();
  });

  it('no responder: zeros, degraded, three attempts, then a retry after retryMs, logged once', async () => {
    const c = make();
    await c.start();
    expect(transport.requests).toHaveLength(3);
    expect(c.degraded).toBe(true);
    expect(c.level('combat')).toBe(0);
    expect(c.version).toBe(0);
    expect(c.baseline).toBeNull();
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

  it('a stale reply after a newer push is ignored', async () => {
    transport.responder = () => {
      transport.emit(PUSH, pushBody('mining', 2, 35, 50));
      return Promise.resolve(stateBody(40, { combat: [1, 12] }));
    };
    const c = make();
    await c.start();
    expect(c.version).toBe(50);
    expect(c.level('mining')).toBe(2);
    expect(c.level('combat')).toBe(0);
    expect(c.degraded).toBe(false);
  });

  it('a push during start is not lost', async () => {
    transport.responder = () => {
      transport.emit(PUSH, pushBody('exploring', 1, 10, 5));
      return Promise.reject(new Error('no responders'));
    };
    const c = make();
    await c.start();
    expect(c.version).toBe(5);
    expect(c.level('exploring')).toBe(1);
    expect(c.degraded).toBe(true);
  });

  it('a level-up push during a reconnect refresh is kept over the older reply', async () => {
    const c = make();
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    await c.start();
    transport.responder = () => {
      transport.emit(PUSH, pushBody('combat', 2, 33, 45));
      return Promise.resolve(stateBody(40, { combat: [1, 12] }));
    };
    await c.refresh();
    expect(c.version).toBe(45);
    expect(c.level('combat')).toBe(2);
    expect(c.degraded).toBe(false);
  });

  it('a failed refresh keeps the previously validated state and records degraded', async () => {
    const c = make();
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }, SHEET));
    await c.start();
    transport.responder = () => Promise.reject(new Error('no responders'));
    await c.refresh();
    expect(transport.requests).toHaveLength(4);
    expect(c.degraded).toBe(true);
    expect(c.version).toBe(40);
    expect(c.level('combat')).toBe(1);
    expect(c.baseline?.sheet).toEqual(SHEET);
  });

  it('an equal version is ignored, for a reply and for a push', async () => {
    const c = make();
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [1, 12] }));
    await c.start();
    transport.responder = () => Promise.resolve(stateBody(40, { combat: [3, 80] }));
    await c.refresh();
    expect(c.level('combat')).toBe(1);
    transport.emit(PUSH, pushBody('mining', 1, 10, 40));
    expect(c.level('mining')).toBe(0);
    expect(c.version).toBe(40);
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
    expect(c.baseline).toBeNull();
    expect(c.degraded).toBe(true);
    expect(logs.some((l) => /invalid/.test(l))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/aggression|xp|combat/);
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
    transport.responder = () => Promise.reject(new Error('no responders'));
    await c.start();
    transport.emit(PUSH, pushBody('combat', 2, 10, 5));
    transport.emit(PUSH, pushBody('fishing' as Domain, 1, 10, 6));
    expect(c.version).toBe(0);
    expect(c.level('combat')).toBe(0);
    expect(logs.filter((l) => /invalid/.test(l))).toHaveLength(2);
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
