import { describe, expect, it } from 'vitest';
import { globalBodyCapFromEnv } from './config.ts';
import {
  type BodyEngine,
  type ContainerState,
  createBodyHelper,
  type HelperDeps,
  NAME_TAKEN,
  NOT_YOUR_BODY,
  OTHER_OWNER_BODY,
} from './service.ts';

const TEMPLATE = {
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
  managed: {
    enabled: true,
    db: { host: 'db', port: '5432', role: 'body', secretHostPath: '/root/secrets/db.txt' },
    rconSecretHostPath: '/root/secrets/rcon.txt',
  },
};

interface Fake extends BodyEngine {
  containers: Map<string, ContainerState & { name: string }>;
  sovereign: number;
  created: string[];
  removed: string[];
  stopped: string[];
  failCreate: boolean;
  failStart: boolean;
}

// Seeded names are the helper's Bodies unless listed in `foreign`: those carry no Body label. A Body is labelled for
// 'own-a' unless `owners` names another owner for it; `owners[name] = null` is a Body with the Body label and no owner label.
function fakeEngine(
  running: Record<string, boolean> = {},
  sovereign = 0,
  foreign: string[] = [],
  owners: Record<string, string | null> = {},
): Fake {
  const containers = new Map<string, ContainerState & { name: string }>();
  for (const [name, isRunning] of Object.entries(running)) {
    containers.set(name, {
      id: `id-${name}`,
      name,
      running: isRunning,
      helperBody: !foreign.includes(name),
      owner: name in owners ? (owners[name] ?? null) : 'own-a',
    });
  }
  const fake: Fake = {
    containers,
    sovereign,
    created: [],
    removed: [],
    stopped: [],
    failCreate: false,
    failStart: false,
    async inspect(name) {
      return containers.get(name) ?? null;
    },
    async countCounted() {
      let count = fake.sovereign;
      for (const c of containers.values()) if (c.running) count += 1;
      return count;
    },
    async create(name) {
      if (fake.failCreate) throw new Error('engine refused create');
      const id = `new-${name}`;
      fake.created.push(name);
      containers.set(name, { id, name, running: false, helperBody: true, owner: 'own-a' });
      return id;
    },
    async start(id) {
      if (fake.failStart) throw new Error('engine refused start');
      for (const c of containers.values()) if (c.id === id) c.running = true;
    },
    async stop(name) {
      fake.stopped.push(name);
      const c = containers.get(name);
      if (c) c.running = false;
    },
    async remove(id) {
      fake.removed.push(id);
      for (const [key, c] of containers) if (c.id === id) containers.delete(key);
    },
    async runOneShot() {
      return 0;
    },
    async logs() {
      return 'line one';
    },
  };
  return fake;
}

function harness(engine: Fake, cap = 50) {
  const audit: string[] = [];
  const lookups: Array<[string, string]> = [];
  const deps: HelperDeps = {
    roster: {
      async displayName(owner, name) {
        lookups.push([owner, name]);
        if (owner !== 'own-a') return null;
        return { ranger: 'Ranger', miner: 'Miner' }[name.toLowerCase()] ?? null;
      },
      async lifeId(owner, name) {
        return owner === 'own-a' && ['ranger', 'miner'].includes(name.toLowerCase())
          ? 'ag_0123456789ab'
          : null;
      },
    },
    engine,
    cap,
    template: TEMPLATE,
    audit: (line) => audit.push(line),
  };
  return { handle: createBodyHelper(deps), audit, lookups };
}

const req = (verb: string, name = 'ranger', extra: Record<string, unknown> = {}) => ({
  verb,
  name,
  owner: 'own-a',
  ...extra,
});

describe('body helper verbs', () => {
  it('starts a rostered name once, with the exact-case login name, and logs one accepted line', async () => {
    const engine = fakeEngine();
    const { handle, audit } = harness(engine);
    const reply = await handle(req('start'));
    expect(reply).toEqual({ ok: true, state: 'started' });
    expect(engine.created).toEqual(['ranger']);
    expect(audit).toEqual(['body-helper verb=start name=ranger outcome=accepted']);
  });

  it('refuses a name that is not on the roster, after the shape check and before any container call', async () => {
    const engine = fakeEngine();
    const { handle, audit, lookups } = harness(engine);
    const reply = await handle(req('start', 'nobody'));
    expect(reply).toEqual({ ok: false, code: 'refused', error: 'not on roster' });
    expect(engine.created).toEqual([]);
    expect(audit).toEqual([
      'body-helper verb=start name=nobody outcome=refused reason=not_on_roster',
    ]);
    expect(lookups).toEqual([['own-a', 'nobody']]);
  });

  it('stops a Body whose name left the roster, for its label owner (decision 0108)', async () => {
    const engine = fakeEngine({ nobody: true });
    const { handle, audit, lookups } = harness(engine);
    expect(await handle(req('stop', 'nobody'))).toEqual({ ok: true, state: 'stopped' });
    expect(engine.stopped).toEqual(['nobody']);
    expect(lookups).toEqual([]);
    expect(audit).toEqual(['body-helper verb=stop name=nobody outcome=accepted']);
  });

  it('refuses a stop of a Body labelled for another owner, without that owner id, and stops nothing', async () => {
    const engine = fakeEngine({ nobody: true }, 0, [], { nobody: 'own-b' });
    const { handle, audit } = harness(engine);
    const reply = await handle(req('stop', 'nobody'));
    expect(reply).toEqual({ ok: false, code: 'refused', error: NOT_YOUR_BODY });
    expect(JSON.stringify(reply)).not.toContain('own-b');
    expect(engine.stopped).toEqual([]);
    expect(engine.containers.get('nobody')?.running).toBe(true);
    expect(audit).toEqual([
      'body-helper verb=stop name=nobody outcome=refused reason=not_your_body',
    ]);
  });

  it('refuses a status and a logtail of another owner Body, and reads nothing', async () => {
    const engine = fakeEngine({ nobody: true }, 0, [], { nobody: 'own-b' });
    const { handle, audit } = harness(engine);
    expect(await handle(req('status', 'nobody'))).toEqual({
      ok: false,
      code: 'refused',
      error: NOT_YOUR_BODY,
    });
    expect(await handle(req('logtail', 'nobody'))).toEqual({
      ok: false,
      code: 'refused',
      error: NOT_YOUR_BODY,
    });
    expect(audit).toEqual([
      'body-helper verb=status name=nobody outcome=refused reason=not_your_body',
      'body-helper verb=logtail name=nobody outcome=refused reason=not_your_body',
    ]);
  });

  it('reports status for a Body whose name left the roster, with its label owner', async () => {
    const { handle } = harness(fakeEngine({ nobody: true }));
    expect(await handle(req('status', 'nobody'))).toEqual({
      ok: true,
      state: 'running',
      owner: 'own-a',
    });
  });

  it('refuses a start of a name whose Body another owner holds, running or stopped, and touches nothing', async () => {
    for (const running of [true, false]) {
      const engine = fakeEngine({ ranger: running }, 0, [], { ranger: 'own-b' });
      const { handle, audit } = harness(engine);
      expect(await handle(req('start'))).toEqual({
        ok: false,
        code: 'refused',
        error: OTHER_OWNER_BODY,
      });
      expect(engine.created).toEqual([]);
      expect(engine.removed).toEqual([]);
      expect(engine.stopped).toEqual([]);
      expect(engine.containers.get('ranger')).toMatchObject({ id: 'id-ranger', running });
      expect(audit).toEqual([
        'body-helper verb=start name=ranger outcome=refused reason=other_owner',
      ]);
    }
  });

  it('refuses stop, status and logtail of a Body with the Body label and no owner label, for any owner', async () => {
    const engine = fakeEngine({ nobody: true }, 0, [], { nobody: null });
    const { handle, audit } = harness(engine);
    for (const verb of ['stop', 'status', 'logtail']) {
      expect(await handle(req(verb, 'nobody'))).toEqual({
        ok: false,
        code: 'refused',
        error: NOT_YOUR_BODY,
      });
    }
    expect(engine.stopped).toEqual([]);
    expect(engine.containers.get('nobody')?.running).toBe(true);
    expect(audit).toEqual([
      'body-helper verb=stop name=nobody outcome=refused reason=not_your_body',
      'body-helper verb=status name=nobody outcome=refused reason=not_your_body',
      'body-helper verb=logtail name=nobody outcome=refused reason=not_your_body',
    ]);
  });

  it('refuses a start over a stopped Body with the Body label and no owner label, and removes nothing', async () => {
    const engine = fakeEngine({ ranger: false }, 0, [], { ranger: null });
    const { handle, audit } = harness(engine);
    expect(await handle(req('start'))).toEqual({
      ok: false,
      code: 'refused',
      error: OTHER_OWNER_BODY,
    });
    expect(engine.created).toEqual([]);
    expect(engine.removed).toEqual([]);
    expect(engine.stopped).toEqual([]);
    expect(engine.containers.get('ranger')).toMatchObject({ id: 'id-ranger', running: false });
    expect(audit).toEqual([
      'body-helper verb=start name=ranger outcome=refused reason=other_owner',
    ]);
  });

  it('compares owner ids exactly: a Body labelled Own-A is not acted on by own-a', async () => {
    const engine = fakeEngine({ nobody: true, ranger: true }, 0, [], {
      nobody: 'Own-A',
      ranger: 'Own-A',
    });
    const { handle } = harness(engine);
    for (const verb of ['stop', 'status', 'logtail']) {
      expect(await handle(req(verb, 'nobody'))).toEqual({
        ok: false,
        code: 'refused',
        error: NOT_YOUR_BODY,
      });
    }
    expect(await handle(req('start', 'ranger'))).toEqual({
      ok: false,
      code: 'refused',
      error: OTHER_OWNER_BODY,
    });
    expect(engine.stopped).toEqual([]);
    expect(engine.removed).toEqual([]);
    expect(engine.containers.get('nobody')?.running).toBe(true);
    expect(engine.containers.get('ranger')?.running).toBe(true);
  });

  it('creates a mixed-case rostered name under its lower-case container name', async () => {
    const engine = fakeEngine();
    const { handle } = harness(engine);
    expect(await handle(req('start', 'Ranger'))).toEqual({ ok: true, state: 'started' });
    expect(engine.created).toEqual(['ranger']);
  });

  it('refuses a name outside the login shape without a database lookup', async () => {
    const engine = fakeEngine();
    const { handle, lookups } = harness(engine);
    const reply = await handle(req('start', 'a-b'));
    expect(reply.ok).toBe(false);
    expect(lookups).toEqual([]);
  });

  it('refuses a caller field the helper does not take, and creates nothing', async () => {
    const engine = fakeEngine();
    const { handle, audit } = harness(engine);
    const reply = await handle(req('start', 'ranger', { env: 'SECRET-VALUE' }));
    expect(reply).toEqual({ ok: false, code: 'refused', error: 'unexpected field' });
    expect(engine.created).toEqual([]);
    expect(audit.join('\n')).not.toContain('SECRET-VALUE');
    expect(audit).toHaveLength(1);
  });

  it('refuses an unknown verb and logs it once', async () => {
    const engine = fakeEngine();
    const { handle, audit } = harness(engine);
    for (const verb of ['exec', 'rm', 'create', '']) {
      const reply = await handle(req(verb));
      expect(reply.ok).toBe(false);
    }
    expect(audit).toHaveLength(4);
    expect(engine.created).toEqual([]);
  });

  it('refuses a second start for a running name as already running and starts nothing', async () => {
    const engine = fakeEngine({ ranger: true });
    const { handle } = harness(engine);
    expect(await handle(req('start'))).toEqual({
      ok: false,
      code: 'refused',
      error: 'already running',
    });
    expect(engine.created).toEqual([]);
    expect(engine.removed).toEqual([]);
    expect(engine.containers.get('ranger')?.running).toBe(true);
  });

  it('refuses a running container of the name that the helper did not create, and touches nothing', async () => {
    const engine = fakeEngine({ ranger: true }, 0, ['ranger']);
    const { handle } = harness(engine);
    expect(await handle(req('start'))).toEqual({
      ok: false,
      code: 'refused',
      error: 'already running',
    });
    expect(engine.created).toEqual([]);
    expect(engine.removed).toEqual([]);
  });

  it('refuses a stopped container of the name that lacks the Body label, and leaves it in place', async () => {
    const engine = fakeEngine({ ranger: false }, 0, ['ranger']);
    const { handle } = harness(engine);
    expect(await handle(req('start'))).toEqual({
      ok: false,
      code: 'refused',
      error: 'name taken by a container the helper did not create',
    });
    expect(engine.removed).toEqual([]);
    expect(engine.created).toEqual([]);
    expect(engine.containers.get('ranger')).toMatchObject({ id: 'id-ranger', running: false });
  });

  it('replaces a stopped container of the name with a new one', async () => {
    const engine = fakeEngine({ ranger: false });
    const { handle } = harness(engine);
    expect(await handle(req('start'))).toEqual({ ok: true, state: 'started' });
    expect(engine.removed).toEqual(['id-ranger']);
    expect(engine.created).toEqual(['ranger']);
  });

  it('reports status as absent, stopped or running', async () => {
    const engine = fakeEngine({ miner: false, ranger: true });
    const { handle } = harness(engine);
    expect(await handle(req('status', 'miner'))).toEqual({
      ok: true,
      state: 'stopped',
      owner: 'own-a',
    });
    expect(await handle(req('status', 'ranger'))).toEqual({
      ok: true,
      state: 'running',
      owner: 'own-a',
    });
    expect(await handle(req('status', 'nobody'))).toEqual({ ok: true, state: 'absent' });
  });

  it('stops a running body and refuses a stop with no body as not running', async () => {
    const engine = fakeEngine({ ranger: true });
    const { handle, audit } = harness(engine);
    expect(await handle(req('stop'))).toEqual({ ok: true, state: 'stopped' });
    expect(engine.stopped).toEqual(['ranger']);
    expect(await handle(req('stop', 'miner'))).toMatchObject({ ok: false, code: 'not_running' });
    expect(audit.at(-1)).toBe('body-helper verb=stop name=miner outcome=not_running');
  });

  it('returns the log lines for logtail', async () => {
    const { handle } = harness(fakeEngine({ ranger: true }));
    expect(await handle(req('logtail'))).toEqual({ ok: true, state: 'logs', text: 'line one' });
  });
});

describe('global body cap', () => {
  it('allows the start at 49 running and refuses the start at 50', async () => {
    const engine = fakeEngine(
      Object.fromEntries(Array.from({ length: 49 }, (_, i) => [`p${i}`, true])),
    );
    const { handle, audit } = harness(engine);
    expect(await handle(req('start'))).toEqual({ ok: true, state: 'started' });
    expect(engine.created).toEqual(['ranger']);
    const refused = await handle(req('start', 'miner'));
    expect(refused).toEqual({ ok: false, code: 'capacity', error: 'global body cap reached' });
    expect(engine.created).toEqual(['ranger']);
    expect(audit.at(-1)).toBe('body-helper verb=start name=miner outcome=capacity');
  });

  it('counts the sovereign host containers with the Bodies', async () => {
    const running = Object.fromEntries(Array.from({ length: 34 }, (_, i) => [`p${i}`, true]));
    const engine = fakeEngine(running, 15);
    const { handle } = harness(engine);
    expect(await handle(req('start'))).toEqual({ ok: true, state: 'started' });
    expect((await handle(req('start', 'miner'))).ok).toBe(false);
  });

  it('writes one alert line when the count first reaches 40 and none on the next starts', async () => {
    const engine = fakeEngine(
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, true])),
    );
    const { handle, audit } = harness(engine);
    await handle(req('start'));
    await handle(req('start', 'miner'));
    const alerts = audit.filter((line) => line.includes('alert'));
    expect(alerts).toEqual(['body-helper alert running=40 threshold=40']);
  });

  it('a failed create leaves no container, releases nothing and writes the alert and one failed line', async () => {
    const engine = fakeEngine(
      Object.fromEntries(Array.from({ length: 49 }, (_, i) => [`p${i}`, true])),
    );
    engine.failCreate = true;
    const { handle, audit } = harness(engine);
    expect(await handle(req('start'))).toEqual({
      ok: false,
      code: 'failed',
      error: 'docker call failed',
    });
    expect(engine.created).toEqual([]);
    expect(await engine.countCounted()).toBe(49);
    expect(audit).toEqual([
      'body-helper alert running=49 threshold=40',
      'body-helper verb=start name=ranger outcome=failed',
    ]);
  });

  it('a failed start removes the half-made container and writes one failed line', async () => {
    const engine = fakeEngine();
    engine.failStart = true;
    const { handle, audit } = harness(engine);
    expect((await handle(req('start'))).ok).toBe(false);
    expect(engine.removed).toEqual(['new-ranger']);
    expect(engine.containers.has('ranger')).toBe(false);
    expect(audit).toEqual(['body-helper verb=start name=ranger outcome=failed']);
  });
});

describe('a container of the name the helper did not create (A2)', () => {
  it('stop, status and logtail refuse it, leave it running, and never call stop or logs', async () => {
    const engine = fakeEngine({ ranger: true }, 0, ['ranger']);
    let logsCalled = false;
    engine.logs = async () => {
      logsCalled = true;
      return 'secret log';
    };
    const { handle, audit } = harness(engine);
    for (const verb of ['stop', 'status', 'logtail']) {
      expect(await handle(req(verb))).toEqual({ ok: false, code: 'refused', error: NAME_TAKEN });
    }
    expect(engine.stopped).toEqual([]);
    expect(logsCalled).toBe(false);
    expect(engine.containers.get('ranger')?.running).toBe(true);
    expect(audit.filter((line) => line.endsWith('reason=name_taken'))).toHaveLength(3);
  });

  it('a start still refuses it and removes nothing', async () => {
    const engine = fakeEngine({ ranger: false }, 0, ['ranger']);
    const { handle } = harness(engine);
    expect(await handle(req('start'))).toEqual({ ok: false, code: 'refused', error: NAME_TAKEN });
    expect(engine.removed).toEqual([]);
  });
});

describe('global cap config', () => {
  it('defaults to 50 when unset and accepts a positive whole number', () => {
    expect(globalBodyCapFromEnv({})).toBe(50);
    expect(globalBodyCapFromEnv({ GELDAR_GLOBAL_BODY_CAP: '12' })).toBe(12);
  });

  it('throws on zero, a negative number, text, a fraction and an empty value', () => {
    for (const raw of ['0', '-1', 'x', '1.5', '']) {
      expect(() => globalBodyCapFromEnv({ GELDAR_GLOBAL_BODY_CAP: raw })).toThrow(
        'GELDAR_GLOBAL_BODY_CAP must be a positive whole number',
      );
    }
  });
});
