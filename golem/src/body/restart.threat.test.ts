import { describe, expect, it } from 'vitest';
import { createThreatPolicy } from './reflexes/threat-policy.ts';
import { boot, buckets } from './restart.fakes.ts';

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
});
