import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coloServiceEnv } from './colo-compose.fixture.ts';
import { loadAnimusConfig, repoRoot } from './config.ts';

const COLO_MIND_FILE = join(repoRoot(), 'shards', 'colo-mind.yaml');

// The colo Mind reads the env block of compose/colo.yml exactly as compose resolves it (decision 0131).
describe('animus in compose/colo.yml', () => {
  it('loads its config from the exact compose env and the Mind shard file', async () => {
    const config = await loadAnimusConfig({ env: coloServiceEnv('animus'), file: COLO_MIND_FILE });
    expect(config.shard).toBe('colo');
    expect(config.natsUrl).toBe('nats://nats:4222');
    expect(config.postgres.host).toBe('postgres');
    expect(config.agent.username).toBe('ag_adam_03');
  });

  it('refuses an arbitrary host even with the in-network opt-in', async () => {
    const env = coloServiceEnv('animus');
    await expect(
      loadAnimusConfig({ env: { ...env, POSTGRES_HOST: 'evil.example' }, file: COLO_MIND_FILE }),
    ).rejects.toThrow(/POSTGRES_HOST must be 127.0.0.1 or localhost, got 'evil.example'/);
    await expect(
      loadAnimusConfig({
        env: { ...env, GELDAR_NATS_URL: 'nats://evil.example:4222' },
        file: COLO_MIND_FILE,
      }),
    ).rejects.toThrow(/GELDAR_NATS_URL/);
  });

  it('refuses the compose service names without the opt-in', async () => {
    const {
      GELDAR_IN_NETWORK_HOSTS: _optIn,
      GELDAR_NATS_URL: _nats,
      ...env
    } = coloServiceEnv('animus');
    await expect(loadAnimusConfig({ env, file: COLO_MIND_FILE })).rejects.toThrow(
      /POSTGRES_HOST must be 127.0.0.1 or localhost, got 'postgres'/,
    );
    await expect(
      loadAnimusConfig({
        env: { GELDAR_SHARD: 'colo', GELDAR_NATS_URL: 'nats://nats:4222' },
        file: COLO_MIND_FILE,
      }),
    ).rejects.toThrow(/GELDAR_NATS_URL/);
  });
});
