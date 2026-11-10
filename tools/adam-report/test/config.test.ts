import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/config.ts';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'adam-run-manifest.json',
);

/** The real manifest of smoke run smoke-w6-20-a, written by adam-run's buildManifest. */
const fixtureText = (): string => readFileSync(FIXTURE, 'utf8');

describe('parseManifest reads the adam-run manifest', () => {
  it('parses the real smoke manifest into the report fields', () => {
    const m = parseManifest(fixtureText());
    expect(m.runId).toBe('smoke-w6-20-a');
    expect(m.lifeId).toBe('ag_smoke_01');
    expect(m.worldSeed).toBe('0');
    expect(m.gitSha).toBe('20a644ff305718d136261ac92950152336b723f3');
    expect(m.shardConfigHash).toBe(
      '35cd37cd2e666a92e11f4a8c231dccc5256792f8ba6cb01f3aea1cfc4b28caa6',
    );
    expect(m.startTimeMs).toBe(Date.parse('2026-11-10T14:08:12.606Z'));
    expect(m.tpsTarget).toBe(20);
    expect(m.restarts).toEqual([]);
  });

  it('takes each model tag with its pinned digest, in the file order', () => {
    const m = parseManifest(fixtureText());
    expect(m.modelTags.map((t) => t.tag)).toEqual(['qwen3:32b', 'qwen3:8b', 'nomic-embed-text']);
    expect(m.modelTags[1]).toEqual({
      tag: 'qwen3:8b',
      digest: 'sha256:500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41',
    });
  });

  it('refuses a manifest with another schema, so a reader cannot guess at a new shape', () => {
    const raw = JSON.parse(fixtureText()) as Record<string, unknown>;
    expect(() => parseManifest(JSON.stringify({ ...raw, schema: 'adam-run-manifest/2' }))).toThrow(
      'schema must be adam-run-manifest/1',
    );
  });

  it('refuses the W6-13 shape, which no adam-run writes', () => {
    const w613 = JSON.stringify({
      run_id: 'r',
      life_id: 'l',
      world_seed: 's',
      git_sha: 'g',
      model_tags: [],
      shard_config_hash: 'c',
      start_time: '2026-11-10T00:00:00Z',
      restarts: [],
      tps_target: 20,
    });
    expect(() => parseManifest(w613)).toThrow('schema must be adam-run-manifest/1');
  });
});
