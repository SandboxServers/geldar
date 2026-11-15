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

  // Docker's reserved modes, in any case, and a container:<id> join: a start failure, never a spec.
  it.each([
    'host',
    'HOST',
    'Host',
    'bridge',
    'BRIDGE',
    'none',
    'NONE',
    'default',
    'Default',
    'container:abc',
    'CONTAINER:abc',
  ])('refuses the reserved network mode %s', (network) => {
    expect(() => loadHelperConfig({ ...ENV, GELDAR_NETWORK: network }, FS)).toThrow(
      /GELDAR_NETWORK must/,
    );
  });

  // Length, shape and metacharacters: each is a start failure that names the variable.
  it.each([
    ['a'.repeat(64)],
    ['a'.repeat(5000)],
    [' '],
    [' geldar'],
    ['bad net'],
    ['$(id)'],
    ['`id`'],
    ['a;b'],
    ['"x"'],
    ['{"a":1}'],
    ['a\nb'],
    ['a\n'],
    ['../x'],
    ['-'],
    ['--'],
    ['-leading'],
  ])('refuses a bad network name (case %#)', (network) => {
    expect(() => loadHelperConfig({ ...ENV, GELDAR_NETWORK: network }, FS)).toThrow(
      /GELDAR_NETWORK must/,
    );
  });

  it.each([
    ['-'],
    ['--'],
    ['-x'],
    ['a'.repeat(64)],
    ['a'.repeat(5000)],
    [' '],
    ['a b'],
    ['$(id)'],
    ['a_b'],
    ['a\n'],
  ])('refuses a bad stack value (case %#)', (stack) => {
    expect(() => loadHelperConfig({ ...ENV, GELDAR_STACK: stack }, FS)).toThrow(
      /GELDAR_STACK must/,
    );
  });

  it('accepts the boundary values: 63 characters, a name that only starts like a reserved mode', () => {
    const net63 = 'n'.repeat(63);
    const stack63 = 's'.repeat(63);
    expect(loadHelperConfig({ ...ENV, GELDAR_NETWORK: 'hosts' }, FS).wiring.network).toBe('hosts');
    const wiring = loadHelperConfig(
      { ...ENV, GELDAR_NETWORK: net63, GELDAR_STACK: stack63 },
      FS,
    ).wiring;
    expect(wiring.network).toBe(net63);
    expect(wiring.stack).toBe(stack63);
    expect(template({ ...ENV, GELDAR_NETWORK: net63 }).HostConfig).toMatchObject({
      NetworkMode: net63,
    });
  });
});
