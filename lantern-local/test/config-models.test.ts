import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, PLACEHOLDER_DIGEST, warmOrder } from '../src/config.ts';
import { discoverModels, selectModels } from '../src/models.ts';
import { FakeOllama, GOOD_DIGEST, pin } from './thinker.fakes.ts';

describe('warmOrder', () => {
  const pins = [pin('qwen3:32b'), pin('qwen3:8b')];
  const tiers = { strong: ['qwen3:32b'], fast: ['qwen3:8b'] };

  it('warms only the run tier models when mind.run_tier names a tier', () => {
    expect(warmOrder({ run_tier: 'fast' }, tiers, pins)).toEqual(['qwen3:8b']);
  });

  it('warms nothing when no run tier is known and two chat tiers could both need VRAM', () => {
    expect(warmOrder({}, tiers, pins)).toEqual([]);
    expect(warmOrder({ run_tier: 'missing' }, tiers, pins)).toEqual([]);
  });

  it('warms the only configured chat tier when no run tier is known', () => {
    expect(warmOrder({}, { fast: ['qwen3:8b'] }, pins)).toEqual(['qwen3:8b']);
  });
});

function shardFile(digest: string, warmTimeoutS: number | string = 180, pingS?: number): string {
  const file = join(mkdtempSync(join(tmpdir(), 'lantern-')), 'shard.yaml');
  const ping = pingS === undefined ? '' : `, keep_alive_ping_s: ${pingS}`;
  writeFileSync(
    file,
    [
      'mind:',
      `  thinker: { host: 127.0.0.1, port: 7410, name: local, heartbeat_s: 15, warm_timeout_s: ${warmTimeoutS}${ping} }`,
      'model_pins:',
      '  "qwen3:8b":',
      `    digest: "${digest}"`,
      '    num_ctx: 8192',
      '    keep_alive: 30m',
      '    max_concurrent: 1',
      '',
    ].join('\n'),
  );
  return file;
}

describe('loadConfig', () => {
  it('reads the pins and the Thinker socket with the defaults', () => {
    const config = loadConfig({ file: shardFile(GOOD_DIGEST), env: {} });
    expect(config.wsUrl).toBe('ws://127.0.0.1:7410/v1/thinker/stream');
    expect(config.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(config.heartbeatMs).toBe(15_000);
    expect(config.warmTimeoutMs).toBe(180_000);
    expect(config.pins).toEqual([pin('qwen3:8b')]);
  });

  it('reads the warm-up timeout and refuses one that is not a whole number of seconds of at least 1', () => {
    expect(loadConfig({ file: shardFile(GOOD_DIGEST, 90), env: {} }).warmTimeoutMs).toBe(90_000);
    expect(loadConfig({ file: shardFile(GOOD_DIGEST), env: {} }).keepAlivePingMs).toBe(600_000);
    expect(loadConfig({ file: shardFile(GOOD_DIGEST, 180, 90), env: {} }).keepAlivePingMs).toBe(
      90_000,
    );
    expect(() => loadConfig({ file: shardFile(GOOD_DIGEST, 0), env: {} })).toThrow(
      /warm_timeout_s must be an integer of at least 1/,
    );
    expect(() => loadConfig({ file: shardFile(GOOD_DIGEST, 'soon'), env: {} })).toThrow(
      /warm_timeout_s/,
    );
  });

  it('reads the real shard file with placeholders allowed', () => {
    const config = loadConfig({ env: {}, allowPlaceholders: true });
    expect(config.pins.map((p) => p.name)).toEqual(['qwen3:32b', 'qwen3:8b']);
    expect(config.warmTimeoutMs).toBe(180_000);
  });

  it('refuses the placeholder digest unless tests allow it', () => {
    const file = shardFile(PLACEHOLDER_DIGEST);
    expect(() => loadConfig({ file, env: {} })).toThrow(/placeholder/);
    expect(loadConfig({ file, env: {}, allowPlaceholders: true }).pins).toHaveLength(1);
  });

  it('loads the real shard file strictly, with its recorded digests', () => {
    const config = loadConfig({ env: {} });
    expect(config.pins.map((p) => p.name)).toEqual(['qwen3:32b', 'qwen3:8b']);
    for (const p of config.pins) expect(p.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('refuses a malformed digest', () => {
    expect(() => loadConfig({ file: shardFile('sha256:abc'), env: {} })).toThrow(/64 hex/);
  });

  it('takes the URLs from the environment but only on loopback', () => {
    const file = shardFile(GOOD_DIGEST);
    const env = { GELDAR_MIND_WS_URL: 'ws://localhost:9/x', OLLAMA_URL: 'http://127.0.0.1:1' };
    expect(loadConfig({ file, env }).wsUrl).toBe('ws://localhost:9/x');
    expect(() => loadConfig({ file, env: { OLLAMA_URL: 'http://ollama.example:11434' } })).toThrow(
      /loopback/,
    );
    expect(() => loadConfig({ file, env: { GELDAR_MIND_WS_URL: 'ws://10.0.0.5:7410/x' } })).toThrow(
      /loopback/,
    );
  });
});

describe('selectModels', () => {
  const pins = [pin('qwen3:32b'), pin('qwen3:8b')];

  it('advertises a pin whose digest matches, with or without the sha256 prefix', () => {
    const bare = GOOD_DIGEST.slice('sha256:'.length);
    const out = selectModels(pins, { models: [{ name: 'qwen3:32b', digest: bare }] });
    expect(out.advertised.map((m) => m.name)).toEqual(['qwen3:32b']);
  });

  it('does not advertise a digest mismatch or a missing tag, and says why', () => {
    const out = selectModels(pins, { models: [{ name: 'qwen3:8b', digest: 'b'.repeat(64) }] });
    expect(out.advertised).toEqual([]);
    expect(out.rejected).toHaveLength(2);
    expect(out.rejected[0]).toMatch(/qwen3:32b.*not present/);
    expect(out.rejected[1]).toMatch(/qwen3:8b.*differs/);
  });
});

describe('discoverModels', () => {
  let ollama: FakeOllama;
  beforeEach(async () => {
    ollama = new FakeOllama();
    await ollama.start();
  });
  afterEach(() => ollama.stop());

  it('asks /api/tags and filters by digest', async () => {
    const bare = GOOD_DIGEST.slice('sha256:'.length);
    ollama.handler = (_r, res) =>
      ollama.reply(res, {
        models: [
          { name: 'qwen3:8b', digest: bare },
          { name: 'qwen3:32b', digest: 'c'.repeat(64) },
        ],
      });
    const out = await discoverModels(ollama.url, [pin('qwen3:32b'), pin('qwen3:8b')]);
    expect(ollama.requests[0]?.path).toBe('/api/tags');
    expect(out.advertised.map((m) => m.name)).toEqual(['qwen3:8b']);
    expect(out.rejected).toHaveLength(1);
  });
});
