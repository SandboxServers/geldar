import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseAdamConfig } from './adam/adam-config.ts';
import { assertLoopbackNatsUrl } from './body/restart.ts';
import { coloServiceEnv } from './colo-compose.fixture.ts';
import { loadStackConfig, repoRoot } from './config.ts';

// The colo Body reads the env block of compose/colo.yml exactly as compose resolves it (decision 0131).
describe('golem-body in compose/colo.yml', () => {
  it('loads its stack config from the exact compose env', () => {
    const cfg = loadStackConfig(coloServiceEnv('golem-body'));
    expect(cfg.mcHost).toBe('velocity');
    expect(cfg.mcPort).toBe(25565);
    expect(cfg.natsUrl).toBe('nats://nats:4222');
  });

  it('reads the Mind shard file mounted as shards/colo.yaml, for the colo shard', () => {
    const env = coloServiceEnv('golem-body');
    const file = join(repoRoot(), 'shards', 'colo-mind.yaml');
    const cfg = parseAdamConfig(parse(readFileSync(file, 'utf8')));
    expect(cfg.shard).toBe(env.GELDAR_SHARD);
    expect(cfg.lifeId).toBe('ag_colo_01');
  });

  it('accepts the NATS URL of the body container', () => {
    const env = coloServiceEnv('golem-body');
    expect(() => assertLoopbackNatsUrl(env.GELDAR_NATS_URL ?? '', env)).not.toThrow();
  });

  it('refuses an arbitrary host even with the in-network opt-in', () => {
    const env = coloServiceEnv('golem-body');
    expect(() => loadStackConfig({ ...env, GELDAR_MC_HOST: 'evil.example' })).toThrow(
      /GELDAR_MC_HOST/,
    );
    expect(() => loadStackConfig({ ...env, GELDAR_NATS_URL: 'nats://evil.example:4222' })).toThrow(
      /GELDAR_NATS_URL/,
    );
    expect(() =>
      assertLoopbackNatsUrl('nats://evil.example:4222', { GELDAR_IN_NETWORK_HOSTS: '1' }),
    ).toThrow(/NATS URL/);
  });

  it('refuses the compose service names without the opt-in', () => {
    const { GELDAR_IN_NETWORK_HOSTS: _optIn, ...env } = coloServiceEnv('golem-body');
    expect(() => loadStackConfig(env)).toThrow(/GELDAR_MC_HOST/);
    expect(() => loadStackConfig({ GELDAR_NATS_URL: 'nats://nats:4222' })).toThrow(
      /GELDAR_NATS_URL/,
    );
    expect(() => assertLoopbackNatsUrl('nats://nats:4222', env)).toThrow(/NATS URL/);
  });
});

// The players host runs golem/src/players/main.ts, which loads the same stack config, with RCON to Paper.
describe('players-host in compose/colo.yml', () => {
  it('loads the stack config from the exact compose env, with RCON to Paper', () => {
    const env = coloServiceEnv('players-host');
    const cfg = loadStackConfig(env);
    expect(cfg.mcHost).toBe('velocity');
    expect(cfg.rconHost).toBe('paper');
    expect(cfg.rconPort).toBe(25575);
    expect(cfg.rconPasswordFile).toBe('/run/secrets/rcon');
    expect(cfg.natsUrl).toBe('nats://nats:4222');
    expect(() => assertLoopbackNatsUrl(env.GELDAR_NATS_URL ?? '', env)).not.toThrow();
  });

  it('refuses an arbitrary RCON host even with the in-network opt-in', () => {
    const env = coloServiceEnv('players-host');
    expect(() => loadStackConfig({ ...env, GELDAR_RCON_HOST: 'evil.example' })).toThrow(
      /GELDAR_RCON_HOST/,
    );
  });

  it('refuses the Paper service name for RCON without the opt-in', () => {
    expect(() => loadStackConfig({ GELDAR_RCON_HOST: 'paper' })).toThrow(/GELDAR_RCON_HOST/);
  });
});
