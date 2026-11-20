import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_BUCKETS,
  type PreflightKvm,
  planBucketPreflight,
  preflightBuckets,
  REGISTRY_TTL_HINT,
  seedFailureMessage,
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

  it('keeps the raw seed error in the message and as the cause; the hint only for a registry config mismatch', async () => {
    const raw = new Error(
      'stream name already in use with a different configuration RAW-JS-DETAIL',
    );
    const lines: string[] = [];
    const attempt = preflightBuckets(
      fakeKvm(['geldar-life-registry']),
      (l) => lines.push(l),
      async () => {
        throw raw;
      },
    );
    const error = (await attempt.catch((e: unknown) => e)) as Error;
    expect(
      error.message.startsWith('identity buckets: could not create geldar-life-registry ('),
    ).toBe(true);
    expect(error.message).toContain('RAW-JS-DETAIL');
    expect(error.message).toContain(REGISTRY_TTL_HINT);
    expect(error.cause).toBe(raw);
    expect(lines).not.toContain('identity buckets created: geldar-life-registry');
  });

  it('shows the real permission error and no destructive hint when the registry create is denied', async () => {
    const raw = new Error(
      'permission violation for publish to $JS.API.STREAM.CREATE.KV_geldar-life-registry',
    );
    const attempt = preflightBuckets(
      fakeKvm(['geldar-life-registry']),
      () => undefined,
      async () => {
        throw raw;
      },
    );
    const error = (await attempt.catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('permission violation for publish');
    expect(error.message).not.toContain('nats stream rm');
    expect(error.cause).toBe(raw);
  });

  it('keeps the hint text in step with golem/src/registry.ts (the command it names)', () => {
    expect(readSource('../../../src/registry.ts')).toContain(
      'nats stream rm KV_geldar-life-registry',
    );
  });
});

describe('seedFailureMessage (CAP-3 review 2: the real cause; the hint only for a config mismatch)', () => {
  it('names the buckets and the raw cause, with no destructive hint, for a permission error', () => {
    const cause =
      'permission violation for publish to $JS.API.STREAM.CREATE.KV_geldar-life-registry';
    expect(seedFailureMessage(['geldar-life-registry', 'geldar-skins'], cause)).toBe(
      `identity buckets: could not create geldar-life-registry, geldar-skins (${cause})`,
    );
  });

  it('adds the registry hint for a config mismatch on the life registry', () => {
    const cause = 'stream name already in use with a different configuration';
    expect(seedFailureMessage(['geldar-life-registry'], cause)).toBe(
      `identity buckets: could not create geldar-life-registry (${cause}); ${REGISTRY_TTL_HINT}`,
    );
  });

  it('gives no hint for a config mismatch on the skins bucket alone', () => {
    const cause = 'stream name already in use with a different configuration';
    expect(seedFailureMessage(['geldar-skins'], cause)).not.toContain('nats stream rm');
  });
});

const CAPTURE = fileURLToPath(new URL('./provenance-capture.ts', import.meta.url));
const NOT_CREATED = join(tmpdir(), 'geldar-cap-preflight-test-never-created');

/** Runs the real capture entry point. Port 1 on loopback refuses at once, so a real run fails in the preflight. */
function runEntry(args: string[]) {
  return spawnSync(process.execPath, ['--experimental-strip-types', CAPTURE, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('the capture entry point runs the preflight on a real run only (CAP-3 review 2)', () => {
  it('--list prints the list and never reaches the bucket preflight', () => {
    const run = runEntry(['--list']);
    expect(run.status).toBe(0);
    expect(run.stdout.length).toBeGreaterThan(0);
    expect(run.stdout + run.stderr).not.toContain('identity buckets');
  });

  it('--dry-run prints the plan and never reaches the bucket preflight', () => {
    const run = runEntry(['--case', 'all', '--dry-run', '--out', NOT_CREATED]);
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).not.toContain('identity buckets');
  });

  it('a real run fails in the preflight before the first case, with the real cause and no doubled prefix', () => {
    const run = runEntry([
      '--case',
      'toss',
      '--nats-url',
      'nats://127.0.0.1:1',
      '--out',
      NOT_CREATED,
    ]);
    expect(run.status).toBe(2);
    expect(run.stdout).not.toContain('== case');
    const lines = run.stderr.split('\n').filter((line) => line.startsWith('identity buckets'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^identity buckets: could not connect to NATS \(/);
    expect(run.stderr).not.toContain('identity buckets: identity buckets');
  }, 60_000);
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
