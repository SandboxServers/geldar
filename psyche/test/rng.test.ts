import { describe, expect, it } from 'vitest';
import {
  type DrawKey,
  d20,
  decisionId,
  ENGINE_VERSION,
  type Rng,
  rngFor,
  seedFor,
} from '../src/index.ts';

const BASE: DrawKey = {
  lifeId: 'life-a',
  producer: 'body',
  generation: 1,
  tick: 100,
  fx: 'novelty',
  decisionSeq: 0,
};

function firstDraws(key: DrawKey, count: number): number[] {
  const rng = rngFor(key);
  return Array.from({ length: count }, () => rng.next());
}

describe('decisionId and seeds', () => {
  it('builds the id from producer, life, generation, tick, fx and decisionSeq', () => {
    expect(decisionId(BASE)).toBe('body:life-a:1:100:novelty:0');
  });

  it('gives the same stream for the same key, every time', () => {
    expect(firstDraws(BASE, 5)).toEqual(firstDraws({ ...BASE }, 5));
  });

  it('gives three fixed first draws for three fixed keys (seed vectors)', () => {
    const vectors: Array<[DrawKey, number]> = [
      [BASE, 0.8088091281242669],
      [{ ...BASE, generation: 2 }, 0.7848049020394683],
      [
        {
          lifeId: 'life-b',
          producer: 'kit',
          generation: 1,
          tick: 7,
          fx: 'idle_pick',
          decisionSeq: 3,
        },
        0.5825570339802653,
      ],
    ];
    for (const [key, first] of vectors) {
      expect(rngFor(key).next()).toBe(first);
    }
    expect(seedFor(BASE)).toBe(90700039);
  });

  it('changes the stream when any identity field changes', () => {
    const first = rngFor(BASE).next();
    const variants: Partial<DrawKey>[] = [
      { lifeId: 'life-b' },
      { producer: 'kit' },
      { generation: 2 },
      { tick: 101 },
      { fx: 'insight' },
      { decisionSeq: 1 },
    ];
    for (const change of variants) {
      expect(rngFor({ ...BASE, ...change }).next(), JSON.stringify(change)).not.toBe(first);
    }
  });

  it('gives a restart a new stream: same life and tick, new generation', () => {
    expect(firstDraws({ ...BASE, generation: 2 }, 5)).not.toEqual(firstDraws(BASE, 5));
    expect(decisionId({ ...BASE, generation: 2 })).not.toBe(decisionId(BASE));
  });

  it('changes the seed when the engine version changes', () => {
    expect(ENGINE_VERSION).toBe(1);
    expect(seedFor(BASE, 1)).not.toBe(seedFor(BASE, 2));
    expect(seedFor(BASE)).toBe(seedFor(BASE, ENGINE_VERSION));
  });
});

describe('rng', () => {
  it('counts its draws and stays in [0, 1)', () => {
    const rng: Rng = rngFor(BASE);
    expect(rng.draws).toBe(0);
    for (let i = 0; i < 10000; i++) {
      const value = rng.next();
      expect(value >= 0 && value < 1).toBe(true);
    }
    expect(rng.draws).toBe(10000);
  });
});

describe('d20', () => {
  function fixed(value: number): Rng {
    return { next: () => value, draws: 0 };
  }

  it('maps [0, 1) onto 1 to 20 with floor', () => {
    expect(d20(fixed(0))).toBe(1);
    expect(d20(fixed(0.5))).toBe(11);
    expect(d20(fixed(0.05))).toBe(2);
    expect(d20(fixed(0.99999))).toBe(20);
  });

  it('stays within 1 to 20 over a seeded stream', () => {
    const rng = rngFor(BASE);
    for (let i = 0; i < 2000; i++) {
      const roll = d20(rng);
      expect(roll >= 1 && roll <= 20).toBe(true);
    }
  });
});
