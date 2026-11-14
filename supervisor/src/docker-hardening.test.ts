import { afterEach, describe, expect, it } from 'vitest';
import {
  containerBody,
  createDockerClient,
  createDockerRuntime,
  ENGINE_TIMEOUT_MS,
} from './docker.ts';
import {
  type EngineCall,
  type FakeEngine,
  type ScriptedReply,
  startFakeEngine,
} from './docker-fake-engine.ts';
import {
  BODY_MEMORY_BYTES,
  BODY_NANO_CPUS,
  BODY_PIDS_LIMIT,
  bodyContainerConfig,
} from './limits.ts';
import { type BodySpec, type DisplayNamePort, LoginNameError } from './ports.ts';

// Container hardening (orchestrator ruling on F5), the login name check (F8) and the Engine deadlines (F7).

const IMAGE = 'geldar/golem-body:test';
const spec = (): BodySpec => ({
  ownerId: 'owner-a',
  playerName: 'Ranger',
  config: bodyContainerConfig(),
});
const signal = () => new AbortController().signal;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const names = (login: string | null): DisplayNamePort => ({ displayName: async () => login });

const engines: FakeEngine[] = [];
afterEach(async () => {
  while (engines.length > 0) await engines.pop()?.close();
});

async function engineWith(
  tag: string,
  handler: (call: EngineCall) => ScriptedReply | Promise<ScriptedReply>,
): Promise<FakeEngine> {
  const engine = await startFakeEngine(tag, handler);
  engines.push(engine);
  return engine;
}

// A Docker that has no container of the name, creates `new-1` and starts it.
function happy(call: EngineCall): ScriptedReply {
  if (call.method === 'GET') return { status: 404 };
  if (call.path.startsWith('/containers/create')) return { status: 201, json: { Id: 'new-1' } };
  return { status: 204 };
}

function hostConfig(): Record<string, unknown> {
  return (containerBody(spec(), IMAGE, 'Ranger') as { HostConfig: Record<string, unknown> })
    .HostConfig;
}

describe('Body container config: golem-body hardening, pinned by literal', () => {
  it('sets the pids limit to 256, as compose does for golem-body', () => {
    expect(hostConfig().PidsLimit).toBe(256);
    expect(BODY_PIDS_LIMIT).toBe(256);
    expect(bodyContainerConfig().PidsLimit).toBe(256);
  });

  it('puts the container on the geldar-colo network', () => {
    expect(hostConfig().NetworkMode).toBe('geldar-colo');
  });

  it('runs as uid and gid 1000, the compose default', () => {
    expect((containerBody(spec(), IMAGE, 'Ranger') as { User: unknown }).User).toBe('1000:1000');
  });

  it('logs as json-file with 10m files, three kept', () => {
    expect(hostConfig().LogConfig).toEqual({
      Type: 'json-file',
      Config: { 'max-size': '10m', 'max-file': '3' },
    });
  });

  it('drops every capability and sets no-new-privileges', () => {
    expect(hostConfig().CapDrop).toEqual(['ALL']);
    expect(hostConfig().SecurityOpt).toEqual(['no-new-privileges:true']);
  });

  it('keeps the CPU, memory and swap limits (0082): 1 CPU, 2048m, swap equal to memory', () => {
    expect(hostConfig().NanoCpus).toBe(1_000_000_000);
    expect(hostConfig().NanoCpus).toBe(BODY_NANO_CPUS);
    expect(hostConfig().Memory).toBe(2048 * 1024 * 1024);
    expect(hostConfig().Memory).toBe(BODY_MEMORY_BYTES);
    expect(hostConfig().MemorySwap).toBe(BODY_MEMORY_BYTES);
  });
});

describe('Docker runtime: login name check', () => {
  it('refuses a display name outside the Minecraft login shape as login name unknown, with no engine call', async () => {
    const logins = ['My Agent', 'ab', 'a'.repeat(17), 'bad-name'];
    for (const [i, login] of logins.entries()) {
      const engine = await engineWith(`login-bad-${i}`, happy);
      const runtime = createDockerRuntime(
        createDockerClient(engine.socketPath, IMAGE),
        names(login),
      );
      const refused = runtime.start(spec(), signal());
      await expect(refused).rejects.toThrow('login name unknown');
      await expect(refused).rejects.toBeInstanceOf(LoginNameError);
      expect(engine.calls).toEqual([]);
    }
  });

  it('accepts the 3 and 16 character edges and an underscore', async () => {
    const logins = ['abc', 'a'.repeat(16), 'Ranger_1'];
    for (const [i, login] of logins.entries()) {
      const engine = await engineWith(`login-ok-${i}`, happy);
      const runtime = createDockerRuntime(
        createDockerClient(engine.socketPath, IMAGE),
        names(login),
      );
      await expect(runtime.start(spec(), signal())).resolves.toBeUndefined();
    }
  });
});

describe('Docker engine: deadlines', () => {
  it('uses a 30 second default for every Engine call', () => {
    expect(ENGINE_TIMEOUT_MS).toBe(30_000);
  });

  it('abandons an Engine call that gets no answer at the deadline and rejects', async () => {
    const engine = await engineWith('hung-inspect', async () => {
      await sleep(1500);
      return { status: 404 };
    });
    const client = createDockerClient(engine.socketPath, IMAGE, 100);
    const started = Date.now();
    await expect(client.inspect('ranger')).rejects.toThrow('docker engine timeout');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('bounds the remove after a failed start, so start rejects at the cleanup deadline', async () => {
    const engine = await engineWith('hung-remove', async (call) => {
      if (call.method === 'GET') return { status: 404 };
      if (call.path.startsWith('/containers/create')) return { status: 201, json: { Id: 'new-1' } };
      if (call.method === 'DELETE') {
        await sleep(1500);
        return { status: 204 };
      }
      return { status: 500 };
    });
    const runtime = createDockerRuntime(
      createDockerClient(engine.socketPath, IMAGE),
      names('Ranger'),
      100,
    );
    const started = Date.now();
    await expect(runtime.start(spec(), signal())).rejects.toThrow('docker start refused');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('aborts the cleanup remove at cleanupMs when a create lands after the caller gave up', async () => {
    let deleteAt = 0;
    const engine = await engineWith('late-create', async (call) => {
      if (call.method === 'GET') return { status: 404 };
      if (call.path.startsWith('/containers/create')) {
        await sleep(400);
        return { status: 201, json: { Id: 'late-1' } };
      }
      if (call.method === 'DELETE') {
        deleteAt = Date.now();
        await sleep(1500);
        return { status: 204 };
      }
      return { status: 500 };
    });
    const runtime = createDockerRuntime(
      createDockerClient(engine.socketPath, IMAGE),
      names('Ranger'),
      100,
    );
    const gaveUp = new AbortController();
    setTimeout(() => gaveUp.abort(), 100);
    await expect(runtime.start(spec(), gaveUp.signal)).rejects.toThrow();
    await sleep(1000);
    const cut = engine.abandoned.find((call) => call.method === 'DELETE');
    expect(cut).toBeDefined();
    // The remove is cut at cleanupMs (100 ms after the DELETE arrives), not at the 30 s Engine deadline.
    expect((cut?.at ?? 0) - deleteAt).toBeGreaterThanOrEqual(90);
    expect((cut?.at ?? 0) - deleteAt).toBeLessThan(1000);
  });
});
