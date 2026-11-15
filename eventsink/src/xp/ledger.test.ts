import { DEFAULT_THRESHOLDS, type Domain } from '@geldar/psyche';
import { describe, expect, it } from 'vitest';
import type { XpAward } from './awards.ts';
import { applyAward, type XpStore } from './ledger.ts';
import { xpEnabled, xpThresholds } from './xp-config.ts';

const LIFE = 'ag_kestrel_01';

interface OutboxRow {
  life: string;
  domain: string;
  level: number;
  xp: number;
  version: number;
}

/** An in-memory XpStore that mirrors the SQL's keys: evidence is keyed by (life, domain, key). */
function memoryStore(known: readonly string[] = [LIFE]) {
  const evidence = new Map<string, string>();
  const xp = new Map<string, number>();
  const outbox: OutboxRow[] = [];
  const bumps: string[] = [];
  const enqueues: number[] = [];
  const levels = new Map<string, number>();
  const store: XpStore = {
    async lifeExists(life) {
      return known.includes(life);
    },
    async insertEvidence(a) {
      const key = `${a.lifeId}|${a.domain}|${a.evidenceKey}`;
      if (evidence.has(key)) return false;
      evidence.set(key, a.sourceEventId);
      return true;
    },
    async bump(life, domain) {
      bumps.push(`${life}|${domain}`);
      const key = `${life}|${domain}`;
      const next = (xp.get(key) ?? 0) + 1;
      xp.set(key, next);
      return { xp: next, level: levels.get(key) ?? 0 };
    },
    async setLevel(life, domain, level) {
      levels.set(`${life}|${domain}`, level);
    },
    async totalXp(life) {
      let total = 0;
      for (const [key, value] of xp) if (key.startsWith(`${life}|`)) total += value;
      return total;
    },
    async enqueueLevel(life, domain, level, levelXp, version) {
      enqueues.push(level);
      // ON CONFLICT (life_id, domain, level) DO NOTHING
      if (!outbox.some((r) => r.life === life && r.domain === domain && r.level === level)) {
        outbox.push({ life, domain, level, xp: levelXp, version });
      }
    },
  };
  return { store, evidence, xp, outbox, bumps, enqueues, levels };
}

function award(key: string, source = `ev_${key}`, domain: Domain = 'mining'): XpAward {
  return { lifeId: LIFE, domain, evidenceKey: key, sourceEventId: source, worldTick: 100 };
}

describe('applyAward', () => {
  it('skips an unknown life with a log line and awards nothing', async () => {
    const m = memoryStore([]);
    const lines: string[] = [];
    const result = await applyAward(m.store, award('k1'), DEFAULT_THRESHOLDS, (l) => lines.push(l));
    expect(result).toEqual({ awarded: false, level: null });
    expect(m.bumps).toEqual([]);
    expect(m.evidence.size).toBe(0);
    expect(lines.join('\n')).toContain('xp_skipped_unknown_life');
  });

  it('a first award counts one XP and reaches no level', async () => {
    const m = memoryStore();
    const result = await applyAward(m.store, award('k1'), DEFAULT_THRESHOLDS);
    expect(result).toEqual({ awarded: true, level: null });
    expect(m.xp.get(`${LIFE}|mining`)).toBe(1);
  });

  it('a redelivered award adds nothing: the evidence insert returns no row and no bump runs', async () => {
    const m = memoryStore();
    await applyAward(m.store, award('k1'), DEFAULT_THRESHOLDS);
    const again = await applyAward(m.store, award('k1'), DEFAULT_THRESHOLDS);
    expect(again).toEqual({ awarded: false, level: null });
    expect(m.bumps).toHaveLength(1);
    expect(m.xp.get(`${LIFE}|mining`)).toBe(1);
  });

  it('two sources of one accomplishment give one XP, whichever arrives first', async () => {
    const running = memoryStore();
    await applyAward(running.store, award('k1', 'ev_running'), DEFAULT_THRESHOLDS);
    await applyAward(running.store, award('k1', 'ev_completed'), DEFAULT_THRESHOLDS);
    expect(running.xp.get(`${LIFE}|mining`)).toBe(1);
    expect(running.evidence.get(`${LIFE}|mining|k1`)).toBe('ev_running');

    const completed = memoryStore();
    await applyAward(completed.store, award('k1', 'ev_completed'), DEFAULT_THRESHOLDS);
    await applyAward(completed.store, award('k1', 'ev_running'), DEFAULT_THRESHOLDS);
    expect(completed.xp.get(`${LIFE}|mining`)).toBe(1);
    expect(completed.evidence.get(`${LIFE}|mining|k1`)).toBe('ev_completed');
  });

  it('enqueues exactly one outbox row per level, at 10, 30 and 70, and none past the last', async () => {
    const m = memoryStore();
    const levels: Array<number | null> = [];
    for (let i = 1; i <= 71; i++) {
      const result = await applyAward(m.store, award(`k${i}`), DEFAULT_THRESHOLDS);
      levels.push(result.level);
    }
    expect(levels.filter((l) => l !== null)).toEqual([1, 2, 3]);
    expect(levels[9]).toBe(1);
    expect(levels[29]).toBe(2);
    expect(levels[69]).toBe(3);
    expect(m.enqueues).toEqual([1, 2, 3]);
    expect(m.outbox.map((r) => [r.level, r.xp, r.version])).toEqual([
      [1, 10, 10],
      [2, 30, 30],
      [3, 70, 70],
    ]);
  });

  it('reaches no level and enqueues nothing below the first threshold', async () => {
    const m = memoryStore();
    for (let i = 1; i <= 9; i++) await applyAward(m.store, award(`k${i}`), DEFAULT_THRESHOLDS);
    expect(m.xp.get(`${LIFE}|mining`)).toBe(9);
    expect(m.enqueues).toEqual([]);
    expect(m.outbox).toEqual([]);
  });

  it('uses the thresholds the caller passes', async () => {
    const m = memoryStore();
    const levels: Array<number | null> = [];
    for (let i = 1; i <= 6; i++) {
      levels.push((await applyAward(m.store, award(`k${i}`), [5, 6, 7])).level);
    }
    expect(levels).toEqual([null, null, null, null, 1, 2]);
  });

  it('propagates a store error from the evidence insert and bumps nothing', async () => {
    const m = memoryStore();
    m.store.insertEvidence = async () => {
      throw new Error('connection lost');
    };
    await expect(applyAward(m.store, award('k1'), DEFAULT_THRESHOLDS)).rejects.toThrow(
      'connection lost',
    );
    expect(m.bumps).toEqual([]);
  });

  it('propagates a store error from the bump after the evidence insert', async () => {
    const m = memoryStore();
    m.store.bump = async () => {
      throw new Error('deadlock detected');
    };
    await expect(applyAward(m.store, award('k1'), DEFAULT_THRESHOLDS)).rejects.toThrow(
      'deadlock detected',
    );
    expect(m.enqueues).toEqual([]);
  });

  it('the stored level follows each crossing, so the next award compares with what is stored', async () => {
    const m = memoryStore();
    const stored: number[] = [];
    for (let i = 1; i <= 71; i++) {
      await applyAward(m.store, award(`k${i}`), DEFAULT_THRESHOLDS);
      stored.push(m.levels.get(`${LIFE}|mining`) ?? 0);
    }
    expect(stored[8]).toBe(0);
    expect(stored[9]).toBe(1);
    expect(stored[28]).toBe(1);
    expect(stored[29]).toBe(2);
    expect(stored[68]).toBe(2);
    expect(stored[69]).toBe(3);
    expect(stored[70]).toBe(3);
  });

  it('a zero threshold reaches level 1 on the first award', async () => {
    const m = memoryStore();
    expect(await applyAward(m.store, award('k1'), [0, 30, 70])).toEqual({
      awarded: true,
      level: 1,
    });
    expect(m.levels.get(`${LIFE}|mining`)).toBe(1);
    expect(m.outbox.map((r) => [r.level, r.xp, r.version])).toEqual([[1, 1, 1]]);
  });

  it('lowered thresholds after a restart reach the new level at the next award', async () => {
    const m = memoryStore();
    for (let i = 1; i <= 7; i++) await applyAward(m.store, award(`k${i}`), [10, 30, 70]);
    expect(m.levels.get(`${LIFE}|mining`) ?? 0).toBe(0);
    expect(await applyAward(m.store, award('k8'), [5, 30, 70])).toEqual({
      awarded: true,
      level: 1,
    });
    expect(m.levels.get(`${LIFE}|mining`)).toBe(1);
    expect(m.outbox.map((r) => [r.level, r.xp, r.version])).toEqual([[1, 8, 8]]);
  });

  it('tied thresholds: one award that crosses two levels stores and enqueues only the highest', async () => {
    const m = memoryStore();
    const levels: Array<number | null> = [];
    for (let i = 1; i <= 5; i++) {
      levels.push((await applyAward(m.store, award(`k${i}`), [5, 5, 70])).level);
    }
    expect(levels).toEqual([null, null, null, null, 2]);
    expect(m.levels.get(`${LIFE}|mining`)).toBe(2);
    expect(m.enqueues).toEqual([2]);
    expect(m.outbox.map((r) => [r.level, r.xp, r.version])).toEqual([[2, 5, 5]]);
  });

  it('the outbox version is the life total across domains, not the domain xp', async () => {
    const m = memoryStore();
    for (let i = 1; i <= 5; i++) {
      await applyAward(m.store, award(`c${i}`, `ev_c${i}`, 'combat'), DEFAULT_THRESHOLDS);
    }
    for (let i = 1; i <= 10; i++) await applyAward(m.store, award(`m${i}`), DEFAULT_THRESHOLDS);
    expect(m.xp.get(`${LIFE}|combat`)).toBe(5);
    expect(m.outbox).toEqual([{ life: LIFE, domain: 'mining', level: 1, xp: 10, version: 15 }]);
  });
});

describe('xp-config', () => {
  it('the ledger is on only when GELDAR_XP is exactly 1', () => {
    expect(xpEnabled({})).toBe(false);
    expect(xpEnabled({ GELDAR_XP: '0' })).toBe(false);
    expect(xpEnabled({ GELDAR_XP: 'true' })).toBe(false);
    expect(xpEnabled({ GELDAR_XP: ' 1' })).toBe(false);
    expect(xpEnabled({ GELDAR_XP: '1' })).toBe(true);
  });

  it('thresholds default to psyche DEFAULT_THRESHOLDS when unset or blank', () => {
    expect(xpThresholds({})).toEqual([10, 30, 70]);
    expect(xpThresholds({ GELDAR_PROFICIENCY_THRESHOLDS: '   ' })).toEqual([10, 30, 70]);
  });

  it('thresholds parse three integers from GELDAR_PROFICIENCY_THRESHOLDS', () => {
    expect(xpThresholds({ GELDAR_PROFICIENCY_THRESHOLDS: '5, 20,40' })).toEqual([5, 20, 40]);
  });

  it('malformed or unordered thresholds throw at startup instead of defaulting', () => {
    expect(() => xpThresholds({ GELDAR_PROFICIENCY_THRESHOLDS: '10,30' })).toThrow(RangeError);
    expect(() => xpThresholds({ GELDAR_PROFICIENCY_THRESHOLDS: 'a,b,c' })).toThrow(RangeError);
    expect(() => xpThresholds({ GELDAR_PROFICIENCY_THRESHOLDS: '30,10,70' })).toThrow(RangeError);
  });
});
