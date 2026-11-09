import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadAnimusConfig, parseAnimusConfig, repoRoot } from './config.ts';

// biome-ignore lint/suspicious/noExplicitAny: the tests edit arbitrary nested keys of the parsed YAML
type Doc = any;

const REAL_DIGEST = `sha256:${'a'.repeat(64)}`;
const FILE = join(repoRoot(), 'shards', 'phase0.yaml');

/** The Phase 0 shard file, parsed fresh so a test can break one key. */
function shardDoc(): Doc {
  return parse(readFileSync(FILE, 'utf8')) as Doc;
}

/** The shard file with every placeholder replaced by a real value. */
function approvedDoc(): Doc {
  const doc = shardDoc();
  doc.mind.agent.personality_seed = 'curious, careful, blunt; hums while working';
  for (const pin of Object.values<Doc>(doc.model_pins)) pin.digest = REAL_DIGEST;
  doc.embedding.digest = REAL_DIGEST;
  return doc;
}

describe('animus config', () => {
  it('reads the Phase 0 shard file when placeholders are allowed', async () => {
    const config = await loadAnimusConfig({ env: {}, allowPlaceholders: true });
    expect(config.shard).toBe('phase0');
    expect(config.agent).toMatchObject({ name: 'Adam', username: 'ag_adam_01', tier: 'strong' });
    expect(config.thinker).toEqual({
      host: '127.0.0.1',
      port: 7410,
      name: 'local',
      heartbeatS: 15,
    });
    expect(config.thought).toEqual({
      maxTokens: 600,
      temperature: 0.7,
      deadlineS: 25,
      reasoning: 'off',
    });
    expect(config.reflection).toMatchObject({ maxTokens: 1200, deadlineS: 180, reasoning: 'on' });
    expect(config.modelPins['qwen3:32b']).toMatchObject({ numCtx: 8192, keepAlive: '30m' });
    expect(config.embedding).toMatchObject({ model: 'nomic-embed-text', dims: 768, onCpu: true });
    expect(config.attention.minWakeupSpacingS).toBe(20);
    expect(config.memory.episodicTopK).toBe(8);
    expect(config.natsUrl).toBe('nats://127.0.0.1:4222');
    expect(config.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(config.postgres).toMatchObject({ host: '127.0.0.1', port: 5432 });
  });

  it('accepts an approved seed and recorded digests without the option', () => {
    expect(parseAnimusConfig(approvedDoc(), { env: {} }).modelPins['qwen3:8b']?.digest).toBe(
      REAL_DIGEST,
    );
  });

  it('refuses the placeholders unless allowed', () => {
    expect(() => parseAnimusConfig(shardDoc(), { env: {} })).toThrow('personality_seed');
    const seedOnly = shardDoc();
    seedOnly.mind.agent.personality_seed = 'approved seed';
    expect(() => parseAnimusConfig(seedOnly, { env: {} })).toThrow('digest is the placeholder');
    const embeddingOnly = approvedDoc();
    embeddingOnly.embedding.digest = 'sha256:RECORD_AT_DISPATCH';
    expect(() => parseAnimusConfig(embeddingOnly, { env: {} })).toThrow('embedding.digest');
    expect(() => parseAnimusConfig(shardDoc(), { env: {}, allowPlaceholders: true })).not.toThrow();
  });

  it('refuses a malformed digest even when placeholders are allowed', () => {
    const doc = approvedDoc();
    doc.model_pins['qwen3:32b'].digest = 'sha256:abc';
    expect(() => parseAnimusConfig(doc, { env: {}, allowPlaceholders: true })).toThrow('64 hex');
  });

  it('fails on a missing key and names its path', () => {
    const doc = approvedDoc();
    delete doc.mind.thought.max_tokens;
    expect(() => parseAnimusConfig(doc, { env: {} })).toThrow('mind.thought.max_tokens');
    const noBlock = approvedDoc();
    delete noBlock.attention;
    expect(() => parseAnimusConfig(noBlock, { env: {} })).toThrow('attention');
    const noPin = approvedDoc();
    delete noPin.model_pins['qwen3:32b'];
    expect(() => parseAnimusConfig(noPin, { env: {} })).toThrow("no entry for 'qwen3:32b'");
  });

  it('fails on an invalid value', () => {
    const doc = approvedDoc();
    doc.mind.reflection.reasoning = 'maybe';
    expect(() => parseAnimusConfig(doc, { env: {} })).toThrow('reasoning');
    const badLife = approvedDoc();
    badLife.mind.agent.username = 'Adam';
    expect(() => parseAnimusConfig(badLife, { env: {} })).toThrow('life id');
  });

  it('refuses a non-loopback address from the file or the environment', () => {
    const doc = approvedDoc();
    doc.mind.thinker.host = '0.0.0.0';
    expect(() => parseAnimusConfig(doc, { env: {} })).toThrow('127.0.0.1 or localhost');
    for (const env of [
      { GELDAR_NATS_URL: 'nats://10.0.0.5:4222' },
      { OLLAMA_URL: 'http://ollama.example.com:11434' },
      { POSTGRES_HOST: 'db.example.com' },
    ]) {
      expect(() => parseAnimusConfig(approvedDoc(), { env })).toThrow('127.0.0.1 or localhost');
    }
  });

  it('applies loopback overrides and rejects a bad scheme or port', () => {
    const config = parseAnimusConfig(approvedDoc(), {
      env: {
        GELDAR_NATS_URL: 'nats://localhost:4333',
        OLLAMA_URL: 'http://127.0.0.1:9999',
        POSTGRES_HOST: 'localhost',
        POSTGRES_PORT: '6543',
        POSTGRES_PASSWORD_FILE: 'pw.txt',
      },
    });
    expect(config.natsUrl).toBe('nats://localhost:4333');
    expect(config.ollamaUrl).toBe('http://127.0.0.1:9999');
    expect(config.postgres).toMatchObject({
      host: 'localhost',
      port: 6543,
      passwordFile: 'pw.txt',
    });
    expect(() =>
      parseAnimusConfig(approvedDoc(), { env: { GELDAR_NATS_URL: 'http://127.0.0.1:1' } }),
    ).toThrow('nats://');
    expect(() => parseAnimusConfig(approvedDoc(), { env: { POSTGRES_PORT: '99999' } })).toThrow(
      'port',
    );
  });

  it('requires the file to match GELDAR_SHARD', () => {
    expect(() => parseAnimusConfig(approvedDoc(), { env: { GELDAR_SHARD: 'other' } })).toThrow(
      "GELDAR_SHARD selects 'other'",
    );
  });
});
