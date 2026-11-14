import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyWiringFromEnv, createDockerClient, createDockerRuntime } from './docker.ts';
import {
  type EngineCall,
  type FakeEngine,
  type ScriptedReply,
  startFakeEngine,
} from './docker-fake-engine.ts';
import { BODY_MEMORY_BYTES, BODY_NANO_CPUS, bodyContainerConfig } from './limits.ts';
import type { BodySpec, DisplayNamePort } from './ports.ts';

const IMAGE = 'geldar/golem-body:test';
// Placeholder values for the Body wiring. No real host, address or secret: these are test strings.
const WIRING = bodyWiringFromEnv({
  GELDAR_SHARD: 'colo',
  GELDAR_MC_HOST: 'mc-host.test',
  GELDAR_MC_PORT: '25565',
  GELDAR_NATS_URL: 'nats://nats.test:4222',
  GELDAR_NATS_USER: 'body',
  GELDAR_BODY_NATS_SECRET_HOST_PATH: '/test/secrets/nats-body.txt',
  GELDAR_BODY_SHARD_HOST_PATH: '/test/shards/colo-mind.yaml',
});
const spec = (): BodySpec => ({
  ownerId: 'owner-a',
  playerName: 'Ranger',
  config: bodyContainerConfig(),
});

const engines: FakeEngine[] = [];
afterEach(async () => {
  while (engines.length > 0) await engines.pop()?.close();
});

// The login name port: the exact-case name, or null when no single spelling is known.
async function runtimeWith(
  tag: string,
  handler: (call: EngineCall) => ScriptedReply | Promise<ScriptedReply>,
  login: string | null = 'Ranger',
) {
  const engine = await startFakeEngine(tag, handler);
  engines.push(engine);
  const names: DisplayNamePort = { displayName: async () => login };
  const client = createDockerClient(engine.socketPath, IMAGE, WIRING);
  return { engine, runtime: createDockerRuntime(client, names) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A Docker that has no container of the name, creates `new-1` and starts it.
function happy(call: EngineCall): ScriptedReply {
  if (call.method === 'GET') return { status: 404 };
  if (call.path.startsWith('/containers/create')) return { status: 201, json: { Id: 'new-1' } };
  return { status: 204 };
}

function createCall(engine: FakeEngine): { path: string; body: Record<string, unknown> } {
  const call = engine.calls.find((c) => c.path.startsWith('/containers/create'));
  if (!call) throw new Error('no create call');
  return { path: call.path, body: call.body as Record<string, unknown> };
}

function hostConfig(engine: FakeEngine): Record<string, number> {
  return createCall(engine).body.HostConfig as Record<string, number>;
}

describe('Docker runtime: names and start', () => {
  it('creates the container under the lower-cased name and starts it by the returned id', async () => {
    const { engine, runtime } = await runtimeWith('happy', happy);
    await runtime.start(spec(), new AbortController().signal);
    expect(createCall(engine).path).toBe('/containers/create?name=ranger');
    expect(createCall(engine).body.Labels).toMatchObject({
      'geldar.owner': 'owner-a',
      'geldar.player': 'ranger',
    });
    expect(engine.calls.some((c) => c.path === '/containers/new-1/start')).toBe(true);
  });

  it('logs the Body in with the exact-case name and keeps the container name lower-cased', async () => {
    const { engine, runtime } = await runtimeWith('login', happy, 'Ranger');
    await runtime.start(spec(), new AbortController().signal);
    expect(createCall(engine).path).toBe('/containers/create?name=ranger');
    expect(createCall(engine).body.Env).toContain('GELDAR_LOGIN_NAME=Ranger');
  });

  it('refuses a start with no exact-case name before any engine call', async () => {
    const { engine, runtime } = await runtimeWith('noname', happy, null);
    await expect(runtime.start(spec(), new AbortController().signal)).rejects.toThrow(
      'login name unknown',
    );
    expect(engine.calls).toHaveLength(0);
  });

  it('the CPU limit is the limits module value (NanoCpus, 0082)', async () => {
    const { engine, runtime } = await runtimeWith('cpu', happy);
    await runtime.start(spec(), new AbortController().signal);
    expect(hostConfig(engine).NanoCpus).toBe(BODY_NANO_CPUS);
  });

  it('the memory limit is the limits module value, and the swap equals it (Memory, 0082)', async () => {
    const { engine, runtime } = await runtimeWith('mem', happy);
    await runtime.start(spec(), new AbortController().signal);
    expect(hostConfig(engine).Memory).toBe(BODY_MEMORY_BYTES);
    expect(hostConfig(engine).MemorySwap).toBe(hostConfig(engine).Memory);
  });

  it('a stopped container left by the previous roster owner is replaced before the create', async () => {
    const { engine, runtime } = await runtimeWith('replace', (call) => {
      if (call.method === 'GET') {
        return {
          status: 200,
          json: {
            Id: 'old-9',
            State: { Running: false },
            Config: { Labels: { 'geldar.owner': 'owner-b' } },
          },
        };
      }
      return happy(call);
    });
    await runtime.start(spec(), new AbortController().signal);
    const removeAt = engine.calls.findIndex((c) => c.path === '/containers/old-9?force=true');
    const createAt = engine.calls.findIndex((c) => c.path.startsWith('/containers/create'));
    expect(removeAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeLessThan(createAt);
  });

  it('a running container refuses the start, and nothing is created', async () => {
    const { engine, runtime } = await runtimeWith('running', (call) => {
      if (call.method === 'GET') {
        return {
          status: 200,
          json: { Id: 'run-1', State: { Running: true }, Config: { Labels: {} } },
        };
      }
      return happy(call);
    });
    await expect(runtime.start(spec(), new AbortController().signal)).rejects.toThrow();
    expect(engine.calls.some((c) => c.path.startsWith('/containers/create'))).toBe(false);
  });

  it('an error from the start call removes the created container by its id and rejects', async () => {
    const { engine, runtime } = await runtimeWith('start-error', (call) =>
      call.path.endsWith('/start') ? { status: 500 } : happy(call),
    );
    await expect(runtime.start(spec(), new AbortController().signal)).rejects.toThrow();
    expect(
      engine.calls.some((c) => c.method === 'DELETE' && c.path === '/containers/new-1?force=true'),
    ).toBe(true);
  });
});

describe('Docker runtime: abort paths', () => {
  it('an abort during create removes the container by the id the create returned, never by name', async () => {
    const { engine, runtime } = await runtimeWith('abort-create', async (call) => {
      if (call.path.startsWith('/containers/create')) {
        await sleep(60);
        return { status: 201, json: { Id: 'late-1' } };
      }
      return happy(call);
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(runtime.start(spec(), controller.signal)).rejects.toThrow();
    await vi.waitFor(() =>
      expect(
        engine.calls.some(
          (c) => c.method === 'DELETE' && c.path === '/containers/late-1?force=true',
        ),
      ).toBe(true),
    );
    expect(engine.calls.some((c) => c.method === 'DELETE' && c.path.includes('ranger'))).toBe(
      false,
    );
  });

  it('an abort during start removes the container by its id and rejects', async () => {
    const { engine, runtime } = await runtimeWith('abort-start', async (call) => {
      if (call.path.endsWith('/start')) {
        await sleep(300);
        return { status: 204 };
      }
      return happy(call);
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(runtime.start(spec(), controller.signal)).rejects.toThrow();
    await vi.waitFor(() =>
      expect(
        engine.calls.some(
          (c) => c.method === 'DELETE' && c.path === '/containers/new-1?force=true',
        ),
      ).toBe(true),
    );
    expect(engine.calls.some((c) => c.method === 'DELETE' && c.path.includes('ranger'))).toBe(
      false,
    );
  });

  it('an already-aborted signal rejects before any container call is made', async () => {
    const { engine, runtime } = await runtimeWith('pre-abort', happy);
    const controller = new AbortController();
    controller.abort();
    await expect(runtime.start(spec(), controller.signal)).rejects.toThrow();
    await sleep(20);
    expect(engine.calls.some((c) => c.path.startsWith('/containers/create'))).toBe(false);
    expect(engine.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('Docker runtime: stop and inspect', () => {
  it('a stop that the engine refuses rejects, so the supervisor replies with an error', async () => {
    const { runtime } = await runtimeWith('stop-error', () => ({ status: 500 }));
    await expect(runtime.stop('Ranger')).rejects.toThrow();
  });

  it('a stop of a container that is already gone (404) resolves, and uses the lower-cased name', async () => {
    const { engine, runtime } = await runtimeWith('stop-gone', () => ({ status: 404 }));
    await expect(runtime.stop('Ranger')).resolves.toBeUndefined();
    expect(engine.calls[0]?.path).toBe('/containers/ranger/stop');
  });

  it('inspect maps a missing container to null, and a running one to its owner', async () => {
    const missing = await runtimeWith('inspect-missing', () => ({ status: 404 }));
    await expect(missing.runtime.inspect('Ranger')).resolves.toBeNull();
    const running = await runtimeWith('inspect-running', () => ({
      status: 200,
      json: {
        Id: 'r-1',
        State: { Running: true },
        Config: { Labels: { 'geldar.owner': 'owner-a' } },
      },
    }));
    await expect(running.runtime.inspect('Ranger')).resolves.toEqual({
      ownerId: 'owner-a',
      playerName: 'ranger',
      running: true,
    });
  });
});
