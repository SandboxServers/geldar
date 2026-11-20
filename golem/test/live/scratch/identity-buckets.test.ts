import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_BUCKETS,
  type PreflightKvm,
  planBucketPreflight,
  preflightBuckets,
  REGISTRY_TTL_HINT,
} from './identity-buckets.ts';

const readSource = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8');

/** A KV manager whose `open` fails for the named buckets; `create` is never reached by the preflight. */
function fakeKvm(absent: readonly string[]): PreflightKvm {
  return {
    open: async (name: string) => {
      if (absent.includes(name)) throw new Error(`no bucket ${name}`);
      return {};
    },
    create: async () => ({}),
  } as unknown as PreflightKvm;
}

describe('planBucketPreflight (CAP-3 capture preflight)', () => {
  it('names the two identity buckets the plugin reads, life registry first', () => {
    expect(IDENTITY_BUCKETS).toEqual(['geldar-life-registry', 'geldar-skins']);
  });

  it('skips the creation when both buckets already open', () => {
    const plan = planBucketPreflight([
      ['geldar-life-registry', true],
      ['geldar-skins', true],
    ]);
    expect(plan.missing).toEqual([]);
    expect(plan.message).toBe(
      'identity buckets geldar-life-registry, geldar-skins already present: skipped',
    );
  });

  it('creates only the missing bucket and says which one was already there', () => {
    const plan = planBucketPreflight([
      ['geldar-life-registry', true],
      ['geldar-skins', false],
    ]);
    expect(plan.missing).toEqual(['geldar-skins']);
    expect(plan.message).toBe(
      'identity buckets: creating geldar-skins (already present: geldar-life-registry)',
    );
  });

  it('creates both, in plugin order, on a fresh volume', () => {
    const plan = planBucketPreflight([
      ['geldar-life-registry', false],
      ['geldar-skins', false],
    ]);
    expect(plan.missing).toEqual(['geldar-life-registry', 'geldar-skins']);
    expect(plan.message).toBe('identity buckets: creating geldar-life-registry, geldar-skins');
  });

  it('keeps a present bucket out of the creation list, whatever the order of the input', () => {
    const plan = planBucketPreflight([
      ['geldar-skins', false],
      ['geldar-life-registry', true],
    ]);
    expect(plan.missing).toEqual(['geldar-skins']);
  });
});

describe('preflightBuckets (the wiring of the seed, CAP-3 review 1)', () => {
  it('does not run the seed and logs the skip when both buckets open', async () => {
    const calls: unknown[] = [];
    const lines: string[] = [];
    const missing = await preflightBuckets(
      fakeKvm([]),
      (l) => lines.push(l),
      async (kvm) => {
        calls.push(kvm);
        return [];
      },
    );
    expect(missing).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(lines).toEqual([
      'identity buckets geldar-life-registry, geldar-skins already present: skipped',
    ]);
  });

  it('hands the same KV manager to the injected seed and runs it once when a bucket is missing', async () => {
    const kvm = fakeKvm(['geldar-skins']);
    const seen: unknown[] = [];
    const lines: string[] = [];
    const missing = await preflightBuckets(
      kvm,
      (l) => lines.push(l),
      async (k) => {
        seen.push(k);
        return ['geldar-life-registry', 'geldar-skins'];
      },
    );
    expect(missing).toEqual(['geldar-skins']);
    expect(seen).toEqual([kvm]);
    expect(lines).toEqual([
      'identity buckets: creating geldar-skins (already present: geldar-life-registry)',
      'identity buckets created: geldar-skins',
    ]);
  });

  it('throws the operator hint, not the raw seed error, and keeps the raw error as the cause', async () => {
    const raw = new Error('wrong stream config RAW-JS-DETAIL');
    const lines: string[] = [];
    const attempt = preflightBuckets(
      fakeKvm(['geldar-skins']),
      (l) => lines.push(l),
      async () => {
        throw raw;
      },
    );
    const error = (await attempt.catch((e: unknown) => e)) as Error;
    expect(error.message).toContain(REGISTRY_TTL_HINT);
    expect(error.message).toContain('nats stream rm KV_geldar-life-registry');
    expect(error.message).not.toContain('RAW-JS-DETAIL');
    expect(error.cause).toBe(raw);
    expect(lines).not.toContain('identity buckets created: geldar-skins');
  });

  it('keeps the hint text in step with golem/src/registry.ts (the command it names)', () => {
    expect(readSource('../../../src/registry.ts')).toContain(
      'nats stream rm KV_geldar-life-registry',
    );
  });
});

describe('capture wiring (source checks, CAP-3 review 1)', () => {
  it('imports the seed from golem and calls the injected seed, not a local create', () => {
    const src = readSource('./identity-buckets.ts');
    expect(src).toContain(
      "import { type SeedKvm, seedIdentityBuckets } from '../../../src/seed-buckets.ts'",
    );
    expect(src).toContain('seed: SeedFn = seedIdentityBuckets');
    expect(src).toContain('await seed(kvm);');
    expect(src).not.toMatch(/kvm\.create\(/);
  });

  it('calls the preflight after the list and dry-run returns and before the first case', () => {
    const src = readSource('./provenance-capture.ts');
    const list = src.indexOf("args.mode === 'list'");
    const dry = src.indexOf("args.mode === 'dry-run'");
    const call = src.indexOf('await ensureIdentityBuckets(args.natsUrl');
    const firstCase = src.indexOf('for (const c of args.cases)');
    expect(list).toBeGreaterThan(-1);
    expect(dry).toBeGreaterThan(list);
    expect(call).toBeGreaterThan(-1);
    expect(src.slice(dry, call)).toMatch(/return/);
    expect(firstCase).toBeGreaterThan(call);
    expect(src.split('ensureIdentityBuckets(').length - 1).toBe(1);
  });
});
