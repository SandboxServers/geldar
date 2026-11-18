import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type CollectionTag, parse } from 'yaml';

// The NeoForge shard has no server whitelist (owner decision of 2026-11-17, decision 0387). The autonomous Paper shard
// (compose/phase0.yml) keeps its whitelist. These tests fail if the NeoForge whitelist is turned back on, or if the
// change leaks into the autonomous shard.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, 'utf8');

/** compose replaces the list under !override instead of appending to it; the parse only needs to accept the tag. */
const OVERRIDE: CollectionTag = {
  tag: '!override',
  collection: 'seq',
  resolve: (node: unknown) => ({ override: true, items: (node as { toJSON(): unknown }).toJSON() }),
};
const OVERRIDE_MAP: CollectionTag = {
  tag: '!override',
  collection: 'map',
  resolve: (node: unknown) => (node as { toJSON(): unknown }).toJSON(),
};

type Env = Record<string, string>;
interface Service {
  environment?: Env;
}
interface ComposeFile {
  services: Record<string, Service>;
}

const load = (rel: string): ComposeFile =>
  parse(read(rel), { customTags: [OVERRIDE, OVERRIDE_MAP] }) as ComposeFile;

const NF_LIVE = 'compose/nf-live.yml';
const SCRATCH = 'compose/opt-in/scratch.yml';
const SCRATCH_NF = 'compose/opt-in/scratch-neoforge.yml';
const PHASE0 = 'compose/phase0.yml';

const WHITELIST_KEYS = ['ENABLE_WHITELIST', 'ENFORCE_WHITELIST'] as const;

/** compose merges environment maps key by key: the rendered value is the last file's value for each key. */
const renderedPaperEnv = (): Env => ({
  ...load(PHASE0).services.paper?.environment,
  ...load(SCRATCH).services.paper?.environment,
  ...load(SCRATCH_NF).services.paper?.environment,
});

describe('NeoForge shard: no server whitelist (owner decision 2026-11-17)', () => {
  it('live project: the neoforge server has both whitelist flags FALSE', () => {
    const env = load(NF_LIVE).services.neoforge?.environment ?? {};
    expect(env.ENABLE_WHITELIST).toBe('FALSE');
    expect(env.ENFORCE_WHITELIST).toBe('FALSE');
  });

  it('scratch overlay: the file itself sets both flags FALSE', () => {
    const env = load(SCRATCH_NF).services.paper?.environment ?? {};
    expect(env.ENABLE_WHITELIST).toBe('FALSE');
    expect(env.ENFORCE_WHITELIST).toBe('FALSE');
  });

  it('scratch overlay over phase0 and scratch.yml: the rendered paper service has both flags FALSE', () => {
    const env = renderedPaperEnv();
    expect(env.ENABLE_WHITELIST).toBe('FALSE');
    expect(env.ENFORCE_WHITELIST).toBe('FALSE');
  });

  it('sets no WHITELIST or OVERRIDE_WHITELIST list on either NeoForge server', () => {
    for (const env of [load(NF_LIVE).services.neoforge?.environment, renderedPaperEnv()]) {
      expect(env).not.toHaveProperty('WHITELIST');
      expect(env).not.toHaveProperty('OVERRIDE_WHITELIST');
    }
  });
});

describe('autonomous shard: the whitelist stays on (the change must not leak)', () => {
  it('phase0 paper keeps ENABLE_WHITELIST and ENFORCE_WHITELIST TRUE', () => {
    const env = load(PHASE0).services.paper?.environment ?? {};
    for (const key of WHITELIST_KEYS) expect(env[key]).toBe('TRUE');
  });
});
