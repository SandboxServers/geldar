import { describe, expect, it } from 'vitest';
import { validateCheckpointManifest, validateShardConfig } from '../src/generated/validators.js';

const digest = `sha256:${'a'.repeat(64)}`;
const manifest = {
  checkpoint_id: '01HZX3V9Q4M2K8R7T6Y5W4E3D5',
  image_digest: digest,
  created_at: '2026-11-10T12:00:00Z',
  parts: [{ name: 'postgres', sha256: 'b'.repeat(64), bytes: 1024 }],
};

describe('CheckpointManifest', () => {
  it('accepts a manifest with a ULID id and one part per known name', () => {
    const parts = ['postgres', 'nats', 'world'].map((name) => ({
      name,
      sha256: 'c'.repeat(64),
      bytes: 0,
    }));
    expect(validateCheckpointManifest({ ...manifest, parts })).toBe(true);
  });

  it('accepts a UUID v4 checkpoint id', () => {
    const checkpoint_id = '3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34';
    expect(validateCheckpointManifest({ ...manifest, checkpoint_id })).toBe(true);
  });

  it('rejects a missing image_digest', () => {
    const { image_digest: _omitted, ...rest } = manifest;
    expect(validateCheckpointManifest(rest)).toBe(false);
  });

  it('rejects a digest that is not sha256 plus 64 hex characters', () => {
    expect(validateCheckpointManifest({ ...manifest, image_digest: 'sha256:abc' })).toBe(false);
    expect(validateCheckpointManifest({ ...manifest, image_digest: `md5:${'a'.repeat(64)}` })).toBe(
      false,
    );
  });

  it('rejects an unknown part name', () => {
    const parts = [{ name: 'redis', sha256: 'd'.repeat(64), bytes: 1 }];
    expect(validateCheckpointManifest({ ...manifest, parts })).toBe(false);
  });

  it('rejects a checkpoint id that is neither a ULID nor a UUID v4', () => {
    expect(validateCheckpointManifest({ ...manifest, checkpoint_id: 'ck-1' })).toBe(false);
  });
});

describe('ShardConfig', () => {
  const config = { cpu_limit: 2, memory_limit: '4096m' };

  it('accepts the two required keys alone', () => {
    expect(validateShardConfig(config)).toBe(true);
  });

  it('accepts a full config with a telemetry url', () => {
    expect(
      validateShardConfig({
        ...config,
        minecraft_port: 25570,
        bind_address: '127.0.0.1',
        telemetry_url: 'https://telemetry.example.test/ingest',
      }),
    ).toBe(true);
  });

  it('rejects port 25566', () => {
    expect(validateShardConfig({ ...config, minecraft_port: 25566 })).toBe(false);
  });

  it('rejects a port outside 1024 to 65535', () => {
    expect(validateShardConfig({ ...config, minecraft_port: 80 })).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(validateShardConfig({ ...config, replicas: 3 })).toBe(false);
  });

  it('rejects a cpu limit of zero', () => {
    expect(validateShardConfig({ ...config, cpu_limit: 0 })).toBe(false);
  });

  it('rejects a memory limit that is not a Docker size', () => {
    expect(validateShardConfig({ ...config, memory_limit: '4G' })).toBe(false);
  });

  it('rejects a bind address that is not an IPv4 address', () => {
    expect(validateShardConfig({ ...config, bind_address: 'localhost' })).toBe(false);
  });

  it('rejects a config without cpu_limit', () => {
    expect(validateShardConfig({ memory_limit: '4096m' })).toBe(false);
  });
});
