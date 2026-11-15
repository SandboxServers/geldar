import { describe, expect, it } from 'vitest';
import { type Env, loadHelperConfig, type SecretFs } from './helperConfig.ts';
import { type BodyTemplateInput, bodyContainerConfig } from './template.ts';

// The network and stack wiring: today's values are the defaults, and a second value reaches the container spec.
const FS: SecretFs = {
  stat: () => ({ mode: 0o100600, uid: 0 }),
  read: () => 'secret',
};

const ENV: Env = {
  GELDAR_SHARD: 'colo',
  GELDAR_NATS_URL: 'nats://nats:4222',
  GELDAR_NATS_USER: 'helper',
  GELDAR_NATS_PASSWORD_FILE: '/run/secrets/nats-helper.txt',
  GELDAR_PG_HOST: 'postgres',
  GELDAR_PG_DATABASE: 'geldar',
  GELDAR_PG_USER: 'geldar_helper',
  GELDAR_PG_PASSWORD_FILE: '/run/secrets/pg-helper.txt',
  GELDAR_DOCKER_SOCKET: '/var/run/docker.sock',
  GELDAR_BODY_IMAGE: 'geldar/body:test',
  GELDAR_MC_HOST: 'velocity',
  GELDAR_MC_PORT: '25565',
  GELDAR_BODY_NATS_SECRET_HOST_PATH: '/host/secrets/nats-body.txt',
  GELDAR_BODY_SHARD_HOST_PATH: '/host/shards/colo.yaml',
  GELDAR_BODY_NANO_CPUS: '1000000000',
  GELDAR_BODY_MEMORY_BYTES: '536870912',
  GELDAR_BODY_PIDS_LIMIT: '256',
};

function template(env: Env): Record<string, unknown> {
  const wiring = loadHelperConfig(env, FS).wiring;
  const input: BodyTemplateInput = {
    name: 'ranger',
    owner: 'own-a',
    loginName: 'Ranger',
    image: 'geldar/body:test',
    wiring,
    limits: { nanoCpus: 1_000_000_000, memory: 536_870_912, pidsLimit: 256 },
  };
  return bodyContainerConfig(input);
}

describe('network and stack wiring from the helper config', () => {
  it('defaults to the current geldar-colo network and colo stack', () => {
    const wiring = loadHelperConfig(ENV, FS).wiring;
    expect(wiring.network).toBe('geldar-colo');
    expect(wiring.stack).toBe('colo');
  });

  it('treats an empty GELDAR_NETWORK and GELDAR_STACK as unset', () => {
    const wiring = loadHelperConfig({ ...ENV, GELDAR_NETWORK: '', GELDAR_STACK: '' }, FS).wiring;
    expect(wiring.network).toBe('geldar-colo');
    expect(wiring.stack).toBe('colo');
  });

  it('passes a second network and stack from the env into the container spec', () => {
    const config = template({ ...ENV, GELDAR_NETWORK: 'geldar-staging', GELDAR_STACK: 'staging' });
    const host = config.HostConfig as Record<string, unknown>;
    const labels = config.Labels as Record<string, string>;
    expect(host.NetworkMode).toBe('geldar-staging');
    expect(labels['com.geldar.stack']).toBe('staging');
  });

  it('keeps the default network and stack in the container spec when the env sets none', () => {
    const config = template(ENV);
    const host = config.HostConfig as Record<string, unknown>;
    const labels = config.Labels as Record<string, string>;
    expect(host.NetworkMode).toBe('geldar-colo');
    expect(labels['com.geldar.stack']).toBe('colo');
  });

  it('refuses a network name Docker would not accept', () => {
    expect(() => loadHelperConfig({ ...ENV, GELDAR_NETWORK: 'bad net' }, FS)).toThrow(
      'GELDAR_NETWORK must be a Docker network name',
    );
    expect(() => loadHelperConfig({ ...ENV, GELDAR_NETWORK: '-leading' }, FS)).toThrow(
      'GELDAR_NETWORK must be a Docker network name',
    );
  });

  it('refuses a stack label outside lower-case letters, digits and hyphens', () => {
    expect(() => loadHelperConfig({ ...ENV, GELDAR_STACK: 'Staging' }, FS)).toThrow(
      'GELDAR_STACK must be lower-case letters, digits or hyphens',
    );
  });
});
