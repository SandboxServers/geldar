import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileStore } from './ports.ts';
import {
  buildManifest,
  LIFE_ID,
  type ManifestInput,
  readPins,
  sha256Hex,
  writeManifest,
} from './manifest.ts';

const SHARD_YAML = `
model_pins:
  "qwen3:32b":
    digest: "sha256:aaa"
  "qwen3:8b":
    digest: "sha256:bbb"
embedding:
  model: nomic-embed-text
  digest: "sha256:ccc"
`;

const input: ManifestInput = {
  runId: 'r1',
  profile: '8b',
  seed: 8675309,
  startedAt: '2026-11-10T00:00:00.000Z',
  plannedRestartAt: '2026-11-10T12:00:00.000Z',
  git: { sha: 'eba101b', clean: true },
  shardConfigSha256: 'x'.repeat(64),
  pins: readPins(SHARD_YAML),
  observedDigests: { 'qwen3:8b': 'sha256:bbb', 'qwen3:32b': 'sha256:other' },
  criteriaSha256: 'y'.repeat(64),
};

/** Memory store: `write` replaces, `append` adds; the tests read it back. */
function memoryStore(): FileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (p) => files.get(p) ?? null,
    write: (p, text) => files.set(p, text),
    append: (p, text) => files.set(p, (files.get(p) ?? '') + text),
  };
}

describe('readPins', () => {
  it.each([
    ['model_pins entries and the embedding model', SHARD_YAML, ['qwen3:32b', 'qwen3:8b', 'nomic-embed-text']],
    ['no embedding block', 'model_pins:\n  "qwen3:8b":\n    digest: "sha256:bbb"\n', ['qwen3:8b']],
  ])('reads %s', (_name, yaml, tags) => {
    expect(readPins(yaml).map((p) => p.tag)).toEqual(tags);
  });

  it.each([
    ['no model_pins block', 'shard: phase0\n'],
    ['an entry without a digest', 'model_pins:\n  "qwen3:8b": {}\n'],
  ])('throws on %s', (_name, yaml) => {
    expect(() => readPins(yaml)).toThrow();
  });
});

describe('buildManifest', () => {
  it.each([
    ['32b', 'ag_adam_01'],
    ['8b', 'ag_adam_02'],
    ['smoke', LIFE_ID.smoke],
  ] as const)('the %s profile runs life %s', (profile, life) => {
    expect(buildManifest({ ...input, profile }).life_id).toBe(life);
  });

  it('records the observed digest, and null for a tag Ollama does not have', () => {
    const m = buildManifest(input);
    expect(m.model_pins).toEqual([
      { tag: 'qwen3:32b', pinned_digest: 'sha256:aaa', observed_digest: 'sha256:other', matches: false },
      { tag: 'qwen3:8b', pinned_digest: 'sha256:bbb', observed_digest: 'sha256:bbb', matches: true },
      { tag: 'nomic-embed-text', pinned_digest: 'sha256:ccc', observed_digest: null, matches: false },
    ]);
  });

  it('carries the sha, the clean flag, the seed, the restart time and the TPS target', () => {
    const m = buildManifest(input);
    expect(m).toMatchObject({
      schema: 'adam-run-manifest/1',
      seed: 8675309,
      git: { sha: 'eba101b', clean: true },
      planned_restart_at: '2026-11-10T12:00:00.000Z',
      tps_target: 20,
    });
  });
});

describe('sha256Hex', () => {
  it('matches the known vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('writeManifest', () => {
  it('writes manifest.json under the run directory and the text round-trips', () => {
    const store = memoryStore();
    writeManifest(store, '/runs/r1', buildManifest(input));
    const text = store.files.get(join('/runs/r1', 'manifest.json'));
    expect(text).toBeDefined();
    expect(JSON.parse(text ?? '{}').run_id).toBe('r1');
  });

  it('never contains passwords, tokens, connection strings or environment values (canary)', () => {
    const store = memoryStore();
    const env = {
      PGPASSWORD: 'canary-pw-7f3a',
      GELDAR_TOKEN: 'canary-token-91bc',
      DATABASE_URL: 'postgres://geldar:canary-pw-7f3a@127.0.0.1:5432/geldar',
    };
    writeManifest(store, '/runs/r1', buildManifest(input));
    const text = store.files.get(join('/runs/r1', 'manifest.json')) ?? '';
    for (const [key, value] of Object.entries(env)) {
      expect(text, `manifest must not contain ${key}`).not.toContain(value);
    }
    expect(text).not.toMatch(/postgres:\/\/|password|token/i);
  });
});
