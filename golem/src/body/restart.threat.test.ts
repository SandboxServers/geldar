import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createThreatPolicy } from './reflexes/threat-policy.ts';
import { boot, buckets } from './restart.fakes.ts';

// Captures the options each createBody call receives; the real builder still runs.
const created = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('./create-body.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./create-body.ts')>();
  return {
    ...real,
    createBody: (options: Parameters<typeof real.createBody>[0]) => {
      created.push({ ...options });
      return real.createBody(options);
    },
  };
});

const policy = () =>
  createThreatPolicy({
    aggression: 3,
    combat: 0,
    rolls: false,
    rollAt: () => {
      throw new Error('not called here');
    },
  });

describe('restartBody and the threat policy (AN-12a)', () => {
  it('starts with no bindThreat as before: the Body takes its generation and runs', async () => {
    const kv = buckets();
    const restarted = await boot(kv, {});
    expect(restarted.generation).toBeGreaterThan(0);
    expect(restarted.body.runtime).toBeDefined();
  });

  it('calls bindThreat with the generation this start takes, once, and uses what it returns', async () => {
    const kv = buckets();
    const seen: number[] = [];
    const bound = policy();
    const restarted = await boot(kv, {
      restart: {
        bindThreat: (generation) => {
          seen.push(generation);
          return bound;
        },
      },
    });
    expect(seen).toEqual([restarted.generation]);
  });

  it('treats an undefined return from bindThreat as no policy', async () => {
    const kv = buckets();
    const seen: number[] = [];
    const restarted = await boot(kv, {
      restart: {
        bindThreat: (generation) => {
          seen.push(generation);
          return undefined;
        },
      },
    });
    expect(seen).toEqual([restarted.generation]);
    expect(restarted.body.runtime).toBeDefined();
  });

  beforeEach(() => {
    created.length = 0;
  });

  it('passes the bound policy to createBody as threat, and no threat key without one', async () => {
    const bound = policy();
    await boot(buckets(), { restart: { bindThreat: () => bound } });
    expect(created).toHaveLength(1);
    expect(created[0]?.threat).toBe(bound);
    expect(created[0]).toHaveProperty('threat', bound);

    created.length = 0;
    await boot(buckets(), {});
    expect(created).toHaveLength(1);
    expect(created[0]).not.toHaveProperty('threat');
    expect(created[0]).not.toHaveProperty('bindThreat');
  });

  it('a throwing bindThreat rejects the restart and createBody is never called', async () => {
    await expect(
      boot(buckets(), {
        restart: {
          bindThreat: () => {
            throw new Error('bind failed');
          },
        },
      }),
    ).rejects.toThrow('bind failed');
    expect(created).toHaveLength(0);
  });
});
