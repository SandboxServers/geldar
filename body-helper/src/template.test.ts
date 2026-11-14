import { describe, expect, it } from 'vitest';
import { type BodyTemplateInput, bodyContainerConfig } from './template.ts';

const INPUT: BodyTemplateInput = {
  name: 'ranger',
  owner: 'own-a',
  loginName: 'Ranger',
  image: 'golem-body:test',
  wiring: {
    shard: 'colo',
    uid: '1000',
    mcHost: 'velocity',
    mcPort: '25565',
    natsUrl: 'nats://nats:4222',
    natsUser: 'body',
    natsSecretHostPath: '/root/secrets/nats-body.txt',
    shardHostPath: '/root/shards/colo.yaml',
  },
  limits: { nanoCpus: 1_000_000_000, memory: 1024 * 1024 * 1024, pidsLimit: 256 },
};

function host(config: Record<string, unknown>): Record<string, unknown> {
  return config.HostConfig as Record<string, unknown>;
}

describe('body container template', () => {
  it('drops every capability', () => {
    expect(host(bodyContainerConfig(INPUT)).CapDrop).toEqual(['ALL']);
  });

  it('sets no-new-privileges', () => {
    expect(host(bodyContainerConfig(INPUT)).SecurityOpt).toEqual(['no-new-privileges:true']);
  });

  it('keeps the root filesystem read-only with a noexec tmpfs on /tmp', () => {
    const h = host(bodyContainerConfig(INPUT));
    expect(h.ReadonlyRootfs).toBe(true);
    expect(h.Tmpfs).toEqual({ '/tmp': 'rw,noexec,nosuid,size=64m' });
  });

  it('caps memory and swap at the same limit', () => {
    const h = host(bodyContainerConfig(INPUT));
    expect(h.Memory).toBe(INPUT.limits.memory);
    expect(h.MemorySwap).toBe(INPUT.limits.memory);
  });

  it('caps the CPU and the process count', () => {
    const h = host(bodyContainerConfig(INPUT));
    expect(h.NanoCpus).toBe(1_000_000_000);
    expect(h.PidsLimit).toBe(256);
  });

  it('joins the colo network only', () => {
    expect(host(bodyContainerConfig(INPUT)).NetworkMode).toBe('geldar-colo');
  });

  it('restarts unless stopped and rotates logs', () => {
    const h = host(bodyContainerConfig(INPUT));
    expect(h.RestartPolicy).toEqual({ Name: 'unless-stopped' });
    expect(h.LogConfig).toEqual({
      Type: 'json-file',
      Config: { 'max-size': '10m', 'max-file': '3' },
    });
  });

  it('labels the owner and the lower-cased name, and opts out of Watchtower', () => {
    const labels = bodyContainerConfig(INPUT).Labels as Record<string, string>;
    expect(labels['geldar.owner']).toBe('own-a');
    expect(labels['geldar.player']).toBe('ranger');
    expect(labels['com.centurylinklabs.watchtower.enable']).toBe('false');
    expect(labels['com.geldar.stack']).toBe('colo');
  });

  it('runs as the configured uid with the house Adam entry point', () => {
    const config = bodyContainerConfig(INPUT);
    expect(config.User).toBe('1000:1000');
    expect(config.Entrypoint).toEqual(['node', 'src/adam/main.ts']);
    expect(config.Image).toBe('golem-body:test');
  });

  it('binds only the NATS secret and the shard file, both read-only', () => {
    expect(host(bodyContainerConfig(INPUT)).Binds).toEqual([
      '/root/secrets/nats-body.txt:/run/secrets/nats-body.txt:ro',
      '/root/shards/colo.yaml:/opt/geldar/shards/colo.yaml:ro',
    ]);
  });

  it('gives the Body no RCON port or secret', () => {
    const config = bodyContainerConfig(INPUT);
    expect(JSON.stringify(config)).not.toMatch(/RCON|25575|rcon/i);
  });

  it('ignores anything a caller might add to the input', () => {
    const smuggled = { ...INPUT, binds: ['/etc:/host:rw'], image: INPUT.image };
    const config = bodyContainerConfig(smuggled as BodyTemplateInput);
    expect(host(config).Binds).toHaveLength(2);
    expect(JSON.stringify(config)).not.toContain('/etc:/host');
  });
});
