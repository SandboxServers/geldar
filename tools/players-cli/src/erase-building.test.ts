import { describe, expect, it } from 'vitest';
import { type ErasureKvs, type ErasureRequest, type KvPort, runErasure } from './erase-owner.ts';

const OWNER = 'owner-7731';
// life-alpha and life-altar belong to OWNER. life-alphabet starts with life-alpha but is another life (the dot matters), and
// life-beta belongs to another owner: none of those two may be touched.
const LIVES = [
  { lifeId: 'life-alpha', username: 'ranger_one' },
  { lifeId: 'life-altar', username: 'ranger_two' },
];
const REQUEST: ErasureRequest = {
  ownerId: OWNER,
  lives: LIVES,
  execute: true,
  confirm: OWNER,
};

const SEEN_KEYS = [
  'life-alpha.0.0.0',
  'life-alpha.1.0.0',
  'life-altar.0.0.0',
  'life-alphabet.0.0.0',
  'life-beta.0.0.0',
];
const PLAN_KEYS = [
  'life-alpha.plan-x.0',
  'life-alpha.plan-x.1',
  'life-altar.plan-y.0',
  'life-alphabet.plan-q.0',
  'life-beta.plan-z.0',
];
const CHECKPOINT_KEYS = [
  'life-alpha.plan',
  'life-altar.plan',
  // The body checkpoint of an erased life is keyed by the bare life id in this bucket. It is out of scope here.
  'life-alpha',
  'life-alphabet.plan',
  'life-beta.plan',
];

/** A fake bucket: `data` holds the live keys. `failOn` makes one purge throw. */
function bucket(initial: string[], failOn?: string) {
  const data = new Set(initial);
  const port = {
    async get(key: string) {
      return data.has(key) ? { value: new Uint8Array([1]) } : null;
    },
    async purge(key: string) {
      if (key === failOn) throw new Error(`boom on ${key}`);
      data.delete(key);
    },
    async keys() {
      return [...data];
    },
  };
  return { port, data };
}

/** The skins and registry buckets, holding one key per life, so the existing erasure has data too. */
function core() {
  return {
    skins: bucket(['life-alpha', 'life-altar', 'life-beta']).port as KvPort,
    registry: bucket(['ranger_one', 'ranger_two', 'ranger_b']).port as KvPort,
  };
}

describe('building erasure: seen maps, plan chunks and checkpoints', () => {
  it('erases exactly the erased lives keys in the three building buckets and leaves other keys', async () => {
    const seen = bucket(SEEN_KEYS);
    const plans = bucket(PLAN_KEYS);
    const checkpoints = bucket(CHECKPOINT_KEYS);
    const outcome = await runErasure(REQUEST, {
      ...core(),
      seen: seen.port,
      plans: plans.port,
      checkpoints: checkpoints.port,
    });

    expect(outcome.status).toBe('purged');
    expect([...seen.data].sort()).toEqual(['life-alphabet.0.0.0', 'life-beta.0.0.0']);
    expect([...plans.data].sort()).toEqual(['life-alphabet.plan-q.0', 'life-beta.plan-z.0']);
    expect([...checkpoints.data].sort()).toEqual([
      'life-alpha',
      'life-alphabet.plan',
      'life-beta.plan',
    ]);
    expect(outcome.building.map((c) => [c.name, c.found, c.purged])).toEqual([
      ['geldar-seen', 3, 3],
      ['geldar-plans', 3, 3],
      ['geldar-checkpoints', 2, 2],
    ]);
  });

  it('a second run after a full erase finds nothing left to purge', async () => {
    const seen = bucket(SEEN_KEYS);
    const plans = bucket(PLAN_KEYS);
    const checkpoints = bucket(CHECKPOINT_KEYS);
    const kvs: ErasureKvs = {
      ...core(),
      seen: seen.port,
      plans: plans.port,
      checkpoints: checkpoints.port,
    };
    await runErasure(REQUEST, kvs);
    const again = await runErasure(REQUEST, kvs);

    expect(again.status).toBe('purged');
    expect(again.building.every((c) => c.found === 0 && c.purged === 0)).toBe(true);
  });

  it('a missing building bucket is tolerated: the flag was never on', async () => {
    const outcome = await runErasure(REQUEST, core());

    expect(outcome.status).toBe('purged');
    expect(outcome.building.map((c) => [c.name, c.absent])).toEqual([
      ['geldar-seen', true],
      ['geldar-plans', true],
      ['geldar-checkpoints', true],
    ]);
    expect(outcome.lines).toContain('geldar-seen: bucket absent, nothing to erase');
  });

  it('a dry run reads the building buckets and changes none of them', async () => {
    const seen = bucket(SEEN_KEYS);
    const plans = bucket(PLAN_KEYS);
    const checkpoints = bucket(CHECKPOINT_KEYS);
    const outcome = await runErasure(
      { ...REQUEST, execute: false, confirm: undefined },
      { ...core(), seen: seen.port, plans: plans.port, checkpoints: checkpoints.port },
    );

    expect(outcome.status).toBe('dry-run');
    expect(outcome.building.map((c) => c.found)).toEqual([3, 3, 2]);
    expect(seen.data.size).toBe(SEEN_KEYS.length);
    expect(plans.data.size).toBe(PLAN_KEYS.length);
    expect(checkpoints.data.size).toBe(CHECKPOINT_KEYS.length);
  });

  it('a purge error in a building bucket fails the run and keeps the count of what was purged', async () => {
    const seen = bucket(SEEN_KEYS);
    const plans = bucket(PLAN_KEYS, 'life-alpha.plan-x.1');
    const outcome = await runErasure(REQUEST, { ...core(), seen: seen.port, plans: plans.port });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('a purge failed; run again to finish');
    expect(outcome.building.find((c) => c.name === 'geldar-plans')).toMatchObject({
      found: 3,
      purged: 1,
    });
    // The seen bucket was purged before the failing plan purge, so its keys are gone.
    expect([...seen.data].sort()).toEqual(['life-alphabet.0.0.0', 'life-beta.0.0.0']);
  });

  it('a failed read of a building bucket changes nothing', async () => {
    const seen = bucket(SEEN_KEYS);
    const broken = {
      ...seen.port,
      keys: async () => {
        throw new Error('boom');
      },
    };
    const outcome = await runErasure(REQUEST, { ...core(), seen: broken });

    expect(outcome.status).toBe('failed');
    expect(seen.data.size).toBe(SEEN_KEYS.length);
  });
});
