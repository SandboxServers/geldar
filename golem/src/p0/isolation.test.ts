import { describe, expect, it } from 'vitest';
import { checkIsolation, IsolationRefusal } from './isolation.ts';

/** A scratch env that passes every rule; each test changes one key. */
function scratchEnv(
  over: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    GELDAR_P0_PROJECT: 'scratch-p0a',
    GELDAR_IN_NETWORK_HOSTS: '1',
    GELDAR_MC_HOST: 'velocity',
    GELDAR_MC_PORT: '25565',
    GELDAR_NATS_URL: 'nats://nats:4222',
    GELDAR_RCON_HOST: 'paper',
    GELDAR_RCON_PORT: '25575',
    GELDAR_RCON_PASSWORD_FILE: '/run/secrets/rcon',
    ...over,
  };
}

function refusalOf(env: Record<string, string | undefined>): string {
  try {
    checkIsolation(env);
  } catch (error) {
    expect(error).toBeInstanceOf(IsolationRefusal);
    return (error as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('checkIsolation accepts the scratch shape', () => {
  it('passes with the in-network service names and the scratch project', () => {
    const plan = checkIsolation(scratchEnv());
    expect(plan.project).toBe('scratch-p0a');
    expect(plan.config).toEqual({
      mcHost: 'velocity',
      mcPort: 25565,
      rconHost: 'paper',
      rconPort: 25575,
      rconPasswordFile: '/run/secrets/rcon',
      natsUrl: 'nats://nats:4222',
    });
  });

  it('passes on loopback with ports other than the live defaults', () => {
    const plan = checkIsolation(
      scratchEnv({
        GELDAR_MC_HOST: '127.0.0.1',
        GELDAR_MC_PORT: '35565',
        GELDAR_NATS_URL: 'nats://localhost:34222',
        GELDAR_RCON_HOST: '127.0.0.1',
        GELDAR_RCON_PORT: '35575',
      }),
    );
    expect(plan.config.mcHost).toBe('127.0.0.1');
    expect(plan.config.natsUrl).toBe('nats://localhost:34222');
  });

  it('defaults the Minecraft host to velocity', () => {
    const { GELDAR_MC_HOST: _unused, ...env } = scratchEnv();
    expect(checkIsolation(env).config.mcHost).toBe('velocity');
  });
});

describe('checkIsolation refuses', () => {
  it('a project that is not scratch-<suffix>', () => {
    for (const project of [
      'geldar',
      'scratch-',
      'scratch-abcdefghij',
      'Scratch-ab',
      'scratch-ab_c',
      '',
      'scratch-ab/x',
    ]) {
      expect(refusalOf(scratchEnv({ GELDAR_P0_PROJECT: project }))).toContain('GELDAR_P0_PROJECT');
    }
  });

  it('a missing project', () => {
    const { GELDAR_P0_PROJECT: _unused, ...env } = scratchEnv();
    expect(refusalOf(env)).toContain('GELDAR_P0_PROJECT');
  });

  it('a missing or non-exact in-network opt-in', () => {
    for (const value of [undefined, '', '0', 'true', '01']) {
      expect(refusalOf(scratchEnv({ GELDAR_IN_NETWORK_HOSTS: value }))).toContain(
        'GELDAR_IN_NETWORK_HOSTS must be exactly 1',
      );
    }
  });

  it('a dotted host, for each of the three hosts', () => {
    expect(refusalOf(scratchEnv({ GELDAR_MC_HOST: 'velocity.local' }))).toContain('GELDAR_MC_HOST');
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: 'nats://nats.example:4222' }))).toContain(
      'GELDAR_NATS_URL host',
    );
    expect(refusalOf(scratchEnv({ GELDAR_RCON_HOST: 'paper.example' }))).toContain(
      'GELDAR_RCON_HOST',
    );
  });

  it('an IP literal other than 127.0.0.1', () => {
    expect(refusalOf(scratchEnv({ GELDAR_RCON_HOST: '203.0.113.5' }))).toContain(
      'GELDAR_RCON_HOST',
    );
    expect(refusalOf(scratchEnv({ GELDAR_MC_HOST: '198.51.100.2' }))).toContain('GELDAR_MC_HOST');
    expect(refusalOf(scratchEnv({ GELDAR_MC_HOST: '::1' }))).toContain('GELDAR_MC_HOST');
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: 'nats://[::1]:34222' }))).toContain(
      'GELDAR_NATS_URL host',
    );
  });

  it('a host that is neither loopback nor a scratch service name', () => {
    expect(refusalOf(scratchEnv({ GELDAR_MC_HOST: 'postgres' }))).toContain('GELDAR_MC_HOST');
    expect(refusalOf(scratchEnv({ GELDAR_RCON_HOST: 'golem' }))).toContain('GELDAR_RCON_HOST');
  });

  it('a live default port on loopback', () => {
    expect(
      refusalOf(scratchEnv({ GELDAR_MC_HOST: '127.0.0.1', GELDAR_MC_PORT: '25565' })),
    ).toContain('GELDAR_MC_HOST uses a live default port');
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: 'nats://127.0.0.1:4222' }))).toContain(
      'GELDAR_NATS_URL host uses a live default port',
    );
    expect(
      refusalOf(scratchEnv({ GELDAR_RCON_HOST: 'localhost', GELDAR_RCON_PORT: '25575' })),
    ).toContain('GELDAR_RCON_HOST uses a live default port');
  });

  it('a loopback NATS URL with no port (the default 4222)', () => {
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: 'nats://127.0.0.1' }))).toContain(
      'live default port',
    );
  });

  it('a NATS URL that is not nats://, carries credentials, or has a path', () => {
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: 'http://nats:4222' }))).toContain('nats scheme');
    // A dummy credential URL (user "body", password "x"), joined at run time so that no literal in
    // this file looks like a credential.
    const dummyCredentialUrl = ['nats://', 'body', ':', 'x', '@nats:4222'].join('');
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: dummyCredentialUrl }))).toContain(
      'must not carry credentials',
    );
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: 'nats://nats:4222/x' }))).toContain('no path');
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: 'not a url' }))).toContain('not a URL');
  });

  it('a missing NATS URL, RCON host or RCON password file', () => {
    expect(refusalOf(scratchEnv({ GELDAR_NATS_URL: undefined }))).toContain(
      'GELDAR_NATS_URL is required',
    );
    expect(refusalOf(scratchEnv({ GELDAR_RCON_HOST: '' }))).toContain(
      'GELDAR_RCON_HOST is required',
    );
    expect(refusalOf(scratchEnv({ GELDAR_RCON_PASSWORD_FILE: undefined }))).toContain(
      'GELDAR_RCON_PASSWORD_FILE is required',
    );
  });

  it('a port that is not a number in range', () => {
    expect(refusalOf(scratchEnv({ GELDAR_MC_PORT: '0' }))).toContain(
      'GELDAR_MC_PORT is not a port',
    );
    expect(refusalOf(scratchEnv({ GELDAR_RCON_PORT: '65536' }))).toContain(
      'GELDAR_RCON_PORT is not a port',
    );
    expect(refusalOf(scratchEnv({ GELDAR_MC_PORT: '25x' }))).toContain(
      'GELDAR_MC_PORT is not a port',
    );
  });

  it('a colo-like env: the colo project name with the colo service names', () => {
    const colo = scratchEnv({ GELDAR_P0_PROJECT: 'geldar' });
    expect(refusalOf(colo)).toContain('GELDAR_P0_PROJECT');
    const live = scratchEnv({
      GELDAR_P0_PROJECT: 'geldar',
      GELDAR_MC_HOST: '127.0.0.1',
      GELDAR_NATS_URL: 'nats://127.0.0.1:4222',
      GELDAR_RCON_HOST: '127.0.0.1',
    });
    expect(refusalOf(live)).toContain('GELDAR_P0_PROJECT');
  });

  it('never echoes a secret path or a host value in the refusal', () => {
    const message = refusalOf(
      scratchEnv({ GELDAR_RCON_PASSWORD_FILE: undefined, GELDAR_RCON_HOST: 'paper.example' }),
    );
    expect(message).not.toContain('paper.example');
    expect(message.startsWith('p0 probe refused: ')).toBe(true);
  });
});

/** A geldar-nf env that passes every rule: the nf service names, one key changed per test. */
function nfEnv(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return scratchEnv({
    GELDAR_P0_PROJECT: 'geldar-nf',
    GELDAR_MC_HOST: 'velocity',
    GELDAR_RCON_HOST: 'neoforge',
    GELDAR_NATS_URL: 'nats://nats:4222',
    ...over,
  });
}

const NF_HOSTS = ['velocity', 'neoforge', 'nats'];

describe('checkIsolation accepts the geldar-nf project with velocity, neoforge and nats', () => {
  it('passes with the nf service names and the geldar-nf project', () => {
    const plan = checkIsolation(nfEnv());
    expect(plan.project).toBe('geldar-nf');
    expect(plan.config).toEqual({
      mcHost: 'velocity',
      mcPort: 25565,
      rconHost: 'neoforge',
      rconPort: 25575,
      rconPasswordFile: '/run/secrets/rcon',
      natsUrl: 'nats://nats:4222',
    });
  });

  it('accepts each of the three hosts in each of the three host slots', () => {
    for (const host of NF_HOSTS) {
      expect(checkIsolation(nfEnv({ GELDAR_MC_HOST: host })).config.mcHost).toBe(host);
      expect(checkIsolation(nfEnv({ GELDAR_RCON_HOST: host })).config.rconHost).toBe(host);
      expect(checkIsolation(nfEnv({ GELDAR_NATS_URL: `nats://${host}:4222` })).config.natsUrl).toBe(
        `nats://${host}:4222`,
      );
    }
  });

  it('accepts the NATS URL with or without a port, and loopback with non-live ports', () => {
    expect(checkIsolation(nfEnv({ GELDAR_NATS_URL: 'nats://neoforge' })).config.natsUrl).toBe(
      'nats://neoforge:4222',
    );
    expect(checkIsolation(nfEnv({ GELDAR_NATS_URL: 'nats://nats:34222' })).config.natsUrl).toBe(
      'nats://nats:34222',
    );
    const plan = checkIsolation(
      nfEnv({
        GELDAR_MC_HOST: '127.0.0.1',
        GELDAR_MC_PORT: '35565',
        GELDAR_RCON_HOST: 'localhost',
        GELDAR_RCON_PORT: '35575',
      }),
    );
    expect(plan.config.mcHost).toBe('127.0.0.1');
    expect(plan.config.rconHost).toBe('localhost');
  });
});

describe('checkIsolation refuses anything else around the geldar-nf project', () => {
  it('a project that is not exactly geldar-nf', () => {
    for (const project of [
      'geldar-colo',
      'geldar-nf-x',
      'geldar-nfx',
      'GELDAR-NF',
      'geldar-nf ',
      ' geldar-nf',
      'geldar-nf\n',
      'geldar-n',
      'geldar-nf/x',
      '',
    ]) {
      expect(refusalOf(nfEnv({ GELDAR_P0_PROJECT: project }))).toContain('GELDAR_P0_PROJECT');
    }
  });

  it('paper, a scratch-only name, as a host of geldar-nf', () => {
    expect(refusalOf(nfEnv({ GELDAR_MC_HOST: 'paper' }))).toContain(
      'GELDAR_MC_HOST is not a geldar-nf service name',
    );
    expect(refusalOf(nfEnv({ GELDAR_RCON_HOST: 'paper' }))).toContain(
      'GELDAR_RCON_HOST is not a geldar-nf service name',
    );
    expect(refusalOf(nfEnv({ GELDAR_NATS_URL: 'nats://paper:4222' }))).toContain(
      'GELDAR_NATS_URL host is not a geldar-nf service name',
    );
  });

  it('neoforge, a geldar-nf-only name, as a host of a scratch project', () => {
    expect(refusalOf(scratchEnv({ GELDAR_RCON_HOST: 'neoforge' }))).toContain(
      'GELDAR_RCON_HOST is not a scratch service name',
    );
    expect(
      refusalOf(scratchEnv({ GELDAR_P0_PROJECT: 'scratch-nf', GELDAR_RCON_HOST: 'neoforge' })),
    ).toContain('GELDAR_RCON_HOST is not a scratch service name');
    expect(refusalOf(scratchEnv({ GELDAR_MC_HOST: 'neoforge' }))).toContain(
      'GELDAR_MC_HOST is not a scratch service name',
    );
  });

  it('a dotted host or an IP literal on geldar-nf', () => {
    expect(refusalOf(nfEnv({ GELDAR_MC_HOST: 'velocity.evil' }))).toContain(
      'not a dotted or IP host',
    );
    expect(refusalOf(nfEnv({ GELDAR_RCON_HOST: 'neoforge.example' }))).toContain(
      'GELDAR_RCON_HOST must be',
    );
    expect(refusalOf(nfEnv({ GELDAR_NATS_URL: 'nats://203.0.113.5:4222' }))).toContain(
      'GELDAR_NATS_URL host must be',
    );
  });

  it('a service name outside the nf set on geldar-nf', () => {
    expect(refusalOf(nfEnv({ GELDAR_MC_HOST: 'postgres' }))).toContain(
      'GELDAR_MC_HOST is not a geldar-nf service name',
    );
    expect(refusalOf(nfEnv({ GELDAR_RCON_HOST: 'golem' }))).toContain(
      'GELDAR_RCON_HOST is not a geldar-nf service name',
    );
  });

  it('a live default port on loopback, and a missing in-network opt-in, on geldar-nf', () => {
    expect(refusalOf(nfEnv({ GELDAR_MC_HOST: '127.0.0.1', GELDAR_MC_PORT: '25565' }))).toContain(
      'GELDAR_MC_HOST uses a live default port',
    );
    expect(refusalOf(nfEnv({ GELDAR_IN_NETWORK_HOSTS: undefined }))).toContain(
      'GELDAR_IN_NETWORK_HOSTS must be exactly 1',
    );
  });
});

describe('checkIsolation keeps the nf and scratch host sets apart', () => {
  it('refuses geldar-nf with an RCON host that is a typo of neoforge, or an IP literal', () => {
    expect(refusalOf(nfEnv({ GELDAR_RCON_HOST: 'neoforgee' }))).toContain(
      'GELDAR_RCON_HOST is not a geldar-nf service name',
    );
    expect(refusalOf(nfEnv({ GELDAR_RCON_HOST: '203.0.113.5' }))).toContain(
      'GELDAR_RCON_HOST must be',
    );
  });

  it('refuses scratch-x with the RCON host neoforge, the geldar-nf name', () => {
    expect(
      refusalOf(scratchEnv({ GELDAR_P0_PROJECT: 'scratch-x', GELDAR_RCON_HOST: 'neoforge' })),
    ).toContain('GELDAR_RCON_HOST is not a scratch service name');
  });

  it('refuses lookalike and other project names, including the live colo project', () => {
    for (const project of [
      'geldar-nf2',
      'geldar-nf-scratch',
      'scratch-geldar-nf',
      'geldar',
      'geldar-ch',
      'colo',
      'phase0',
    ]) {
      expect(refusalOf(nfEnv({ GELDAR_P0_PROJECT: project }))).toContain('GELDAR_P0_PROJECT');
    }
  });
});
