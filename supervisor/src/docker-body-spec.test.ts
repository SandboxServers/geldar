import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyWiringFromEnv,
  containerBody,
  createDockerClient,
  createDockerRuntime,
} from './docker.ts';
import { type EngineCall, type FakeEngine, startFakeEngine } from './docker-fake-engine.ts';
import { bodyContainerConfig } from './limits.ts';
import type { BodySpec, DisplayNamePort } from './ports.ts';

// The Body container mirrors compose's golem-body service (C7-03b4). Each flag is pinned by literal.
// Every host, address and secret path here is a placeholder string, not a real one.

const IMAGE = 'geldar/golem-body:test';
const BASE_ENV: Record<string, string> = {
  GELDAR_SHARD: 'colo',
  GELDAR_MC_HOST: 'mc-host.test',
  GELDAR_MC_PORT: '25565',
  GELDAR_NATS_URL: 'nats://nats.test:4222',
  GELDAR_NATS_USER: 'body',
  GELDAR_BODY_NATS_SECRET_HOST_PATH: '/test/secrets/nats-body.txt',
  GELDAR_BODY_SHARD_HOST_PATH: '/test/shards/colo-mind.yaml',
};
const WIRING = bodyWiringFromEnv(BASE_ENV);
const spec = (): BodySpec => ({
  ownerId: 'owner-a',
  playerName: 'Ranger',
  config: bodyContainerConfig(),
});
const body = (wiring = WIRING): Record<string, unknown> =>
  containerBody(spec(), IMAGE, 'Ranger', wiring) as Record<string, unknown>;
const hostConfig = (wiring = WIRING) => body(wiring).HostConfig as Record<string, unknown>;

describe('Body wiring from env', () => {
  it('names the missing variable and never its value, and refuses to build', () => {
    const { GELDAR_NATS_URL: _drop, ...rest } = BASE_ENV;
    expect(() => bodyWiringFromEnv(rest)).toThrow('missing GELDAR_NATS_URL');
  });

  it('refuses an empty required value', () => {
    expect(() => bodyWiringFromEnv({ ...BASE_ENV, GELDAR_MC_HOST: '' })).toThrow(
      'missing GELDAR_MC_HOST',
    );
  });

  it('refuses a service uid that is not digits', () => {
    expect(() => bodyWiringFromEnv({ ...BASE_ENV, GELDAR_SERVICE_UID: '1000:1000' })).toThrow(
      'GELDAR_SERVICE_UID must be digits',
    );
  });
});

describe('Body container: user', () => {
  it('defaults the uid to 1000, the compose default, so the user is 1000:1000', () => {
    expect(WIRING.uid).toBe('1000');
    expect(body().User).toBe('1000:1000');
  });

  it('takes the uid from GELDAR_SERVICE_UID, for both user and group', () => {
    const wiring = bodyWiringFromEnv({ ...BASE_ENV, GELDAR_SERVICE_UID: '1500' });
    expect(body(wiring).User).toBe('1500:1500');
  });

  it('the default in code equals the default compose gives golem-body (drift test)', () => {
    const compose = readFileSync(new URL('../../compose/colo.yml', import.meta.url), 'utf8');
    const match = /GELDAR_SERVICE_UID:-(\d+)/.exec(compose);
    expect(match?.[1]).toBe(WIRING.uid);
  });
});

describe('Body container: entrypoint and env', () => {
  it('runs the Body command, not the image default: node src/adam/main.ts', () => {
    expect(body().Entrypoint).toEqual(['node', 'src/adam/main.ts']);
  });

  it('sets GELDAR_SHARD from the wiring', () => {
    expect(body().Env).toContain('GELDAR_SHARD=colo');
  });

  it('sets GELDAR_IN_NETWORK_HOSTS=1, the Velocity opt-in (decision 0131)', () => {
    expect(body().Env).toContain('GELDAR_IN_NETWORK_HOSTS=1');
  });

  it('sets GELDAR_MC_HOST and GELDAR_MC_PORT from the wiring', () => {
    expect(body().Env).toContain('GELDAR_MC_HOST=mc-host.test');
    expect(body().Env).toContain('GELDAR_MC_PORT=25565');
  });

  it('sets GELDAR_RCON_PORT=25575, as compose does, though the Body uses no RCON', () => {
    expect(body().Env).toContain('GELDAR_RCON_PORT=25575');
  });

  it('sets GELDAR_NATS_URL and GELDAR_NATS_USER from the wiring', () => {
    expect(body().Env).toContain('GELDAR_NATS_URL=nats://nats.test:4222');
    expect(body().Env).toContain('GELDAR_NATS_USER=body');
  });

  it('points GELDAR_NATS_PASSWORD_FILE at the mounted secret, /run/secrets/nats-body.txt', () => {
    expect(body().Env).toContain('GELDAR_NATS_PASSWORD_FILE=/run/secrets/nats-body.txt');
  });

  it('keeps the exact-case login name in GELDAR_LOGIN_NAME (0033)', () => {
    expect(body().Env).toContain('GELDAR_LOGIN_NAME=Ranger');
  });
});

describe('Body container: binds', () => {
  it('binds the nats-body secret read-only at /run/secrets/nats-body.txt (source and target)', () => {
    expect(hostConfig().Binds).toContain(
      '/test/secrets/nats-body.txt:/run/secrets/nats-body.txt:ro',
    );
  });

  it('binds the Mind shard file read-only at /opt/geldar/shards/colo.yaml (source and target)', () => {
    expect(hostConfig().Binds).toContain(
      '/test/shards/colo-mind.yaml:/opt/geldar/shards/colo.yaml:ro',
    );
  });

  it('binds exactly the two files, and no other host path', () => {
    expect(hostConfig().Binds).toHaveLength(2);
  });
});

describe('Body container: labels, restart and limits', () => {
  it('carries the colo labels: the Watchtower opt-out and the stack name', () => {
    expect(body().Labels).toMatchObject({
      'com.centurylinklabs.watchtower.enable': 'false',
      'com.geldar.stack': 'colo',
    });
  });

  it('keeps the owner and player labels', () => {
    expect(body().Labels).toMatchObject({ 'geldar.owner': 'owner-a', 'geldar.player': 'ranger' });
  });

  it('restarts unless stopped, as compose does for golem-body', () => {
    expect(hostConfig().RestartPolicy).toEqual({ Name: 'unless-stopped' });
  });

  it('sets no read-only root and no tmpfs, since golem-body sets neither', () => {
    expect(hostConfig().ReadonlyRootfs).toBeUndefined();
    expect(hostConfig().Tmpfs).toBeUndefined();
  });
});

describe('Body container: sent to the Engine', () => {
  const engines: FakeEngine[] = [];
  afterEach(async () => {
    while (engines.length > 0) await engines.pop()?.close();
  });

  it('the create call carries the entrypoint, the binds and the uid', async () => {
    const engine = await startFakeEngine('body-spec-create', (call: EngineCall) => {
      if (call.method === 'GET') return { status: 404 };
      if (call.path.startsWith('/containers/create')) return { status: 201, json: { Id: 'new-1' } };
      return { status: 204 };
    });
    engines.push(engine);
    const names: DisplayNamePort = { displayName: async () => 'Ranger' };
    const runtime = createDockerRuntime(
      createDockerClient(engine.socketPath, IMAGE, WIRING),
      names,
    );
    await runtime.start(spec(), new AbortController().signal);
    const create = engine.calls.find((c) => c.path.startsWith('/containers/create'));
    const sent = create?.body as Record<string, unknown>;
    expect(sent.User).toBe('1000:1000');
    expect(sent.Entrypoint).toEqual(['node', 'src/adam/main.ts']);
    expect((sent.HostConfig as Record<string, unknown>).Binds).toHaveLength(2);
  });
});
