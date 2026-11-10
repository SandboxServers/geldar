import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  compare,
  installedFromTags,
  lookup,
  normalizeDigest,
  PLACEHOLDER_DIGEST,
  preflightProblems,
  readLives,
  readPins,
  readSeed,
  readTierTags,
  SEED_PLACEHOLDER,
} from './pins.ts';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const shardDoc: unknown = parse(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'shards', 'phase0.yaml'), 'utf8'),
);

describe('shard file readers', () => {
  it('reads the pins, the tiers, the lives and the seed of shards/phase0.yaml', () => {
    expect(readPins(shardDoc).map((p) => `${p.kind}:${p.tag}`)).toEqual([
      'model:qwen3:32b',
      'model:qwen3:8b',
      'embedding:nomic-embed-text',
    ]);
    expect(readTierTags(shardDoc, 'strong')).toEqual(['qwen3:32b']);
    expect(readTierTags(shardDoc, 'fast')).toEqual(['qwen3:8b']);
    expect(readLives(shardDoc)).toEqual({ strong: 'ag_adam_01', fast: 'ag_adam_02' });
    expect(typeof readSeed(shardDoc)).toBe('string');
  });
});

describe('digest matching', () => {
  const installed = installedFromTags({
    models: [
      { name: 'qwen3:32b', digest: HEX_A },
      { name: 'nomic-embed-text:latest', digest: `sha256:${HEX_B}` },
    ],
  });

  it('normalises Ollama digests to the sha256: form', () => {
    expect(normalizeDigest(HEX_A.toUpperCase())).toBe(`sha256:${HEX_A}`);
    expect(normalizeDigest(`sha256:${HEX_A}`)).toBe(`sha256:${HEX_A}`);
  });

  it('finds an untagged name through :latest, and nothing else', () => {
    expect(lookup(installed, 'nomic-embed-text')).toBe(`sha256:${HEX_B}`);
    expect(lookup(installed, 'qwen3:8b')).toBeNull();
    expect(lookup(installed, 'qwen3')).toBeNull();
  });

  it('classifies ok, mismatch, missing, placeholder and invalid pins', () => {
    const rows = compare(
      [
        { tag: 'qwen3:32b', digest: `sha256:${HEX_A}`, kind: 'model' },
        { tag: 'nomic-embed-text', digest: `sha256:${HEX_A}`, kind: 'embedding' },
        { tag: 'qwen3:8b', digest: `sha256:${HEX_A}`, kind: 'model' },
        { tag: 'qwen3:32b', digest: PLACEHOLDER_DIGEST, kind: 'model' },
        { tag: 'qwen3:32b', digest: 'sha256:short', kind: 'model' },
      ],
      installed,
    );
    expect(rows.map((r) => r.state)).toEqual([
      'ok',
      'mismatch',
      'missing',
      'placeholder',
      'invalid',
    ]);
  });

  it('rejects a tags answer with no models list', () => {
    expect(() => installedFromTags({})).toThrow(/models list/);
  });
});

describe('preflight', () => {
  const pins = [
    { tag: 'qwen3:32b', digest: PLACEHOLDER_DIGEST, kind: 'model' as const },
    { tag: 'qwen3:8b', digest: PLACEHOLDER_DIGEST, kind: 'model' as const },
    { tag: 'nomic-embed-text', digest: `sha256:${HEX_B}`, kind: 'embedding' as const },
  ];
  const installed = new Map([
    ['qwen3:32b', `sha256:${HEX_A}`],
    ['qwen3:8b', `sha256:${HEX_A}`],
    ['nomic-embed-text:latest', `sha256:${HEX_B}`],
  ]);

  it('refuses the digest placeholder with the command to run, for the chosen tier only', () => {
    const problems = preflightProblems(compare(pins, installed), ['qwen3:8b'], 'a seed');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'qwen3:8b'");
    expect(problems[0]).toContain('adam models --record');
  });

  it('refuses the seed placeholder and tells the owner what to do', () => {
    const rows = compare(
      [
        { tag: 'qwen3:8b', digest: `sha256:${HEX_A}`, kind: 'model' },
        { tag: 'nomic-embed-text', digest: `sha256:${HEX_B}`, kind: 'embedding' },
      ],
      installed,
    );
    const problems = preflightProblems(rows, ['qwen3:8b'], SEED_PLACEHOLDER);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('owner must approve a seed');
  });

  it('passes when every pin of the tier and the embedding model is ok and the seed is real', () => {
    const rows = compare(
      [
        { tag: 'qwen3:8b', digest: `sha256:${HEX_A}`, kind: 'model' },
        { tag: 'nomic-embed-text', digest: `sha256:${HEX_B}`, kind: 'embedding' },
      ],
      installed,
    );
    expect(preflightProblems(rows, ['qwen3:8b'], 'curious, stubborn')).toEqual([]);
  });

  it('tells the owner to pull a missing model', () => {
    const rows = compare(pins, new Map());
    expect(preflightProblems(rows, ['qwen3:32b'], 'x').join('\n')).toContain(
      'ollama pull qwen3:32b',
    );
  });
});
