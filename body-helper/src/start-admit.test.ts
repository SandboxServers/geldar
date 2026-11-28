import { describe, expect, it } from 'vitest';
import { bodyFixture, createFakeEngine, type FakeEngine } from './fake-engine.ts';
import {
  ADMIT_REFUSAL,
  CAP_REFUSAL,
  createBodyHelper,
  type HelperDeps,
  MANAGED_REFUSAL,
  type ManagedSettings,
} from './service.ts';

// The RCON host path carries a sentinel: the helper must never print it, in an audit line or a reply.
const SENTINEL = 'SENTINEL-rcon-host-path';
const RCON_PATH = `/root/secrets/rcon-${SENTINEL}.txt`;
const LIFE = 'ag_0123456789ab';
const ADMIT_NAME = `geldar-admit-${LIFE}`;

const MANAGED: ManagedSettings = {
  enabled: true,
  db: {
    host: 'postgres',
    port: '5432',
    role: 'geldar_body_host',
    secretHostPath: '/root/secrets/db.txt',
  },
  rconSecretHostPath: RCON_PATH,
};

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
};

interface SetupOptions {
  engine?: FakeEngine;
  cap?: number;
  managed?: ManagedSettings;
  lifeId?: string | null;
}

/** A helper over the shared fake. The roster lookups are recorded, so a test can prove none happened. */
function setup(options: SetupOptions = {}) {
  const engine = options.engine ?? createFakeEngine();
  const audit: string[] = [];
  const rosterCalls: string[] = [];
  const deps: HelperDeps = {
    roster: {
      async displayName(owner, name) {
        rosterCalls.push(`displayName:${owner}:${name}`);
        return owner === 'own-a' && name.toLowerCase() === 'ranger' ? 'Ranger' : null;
      },
      async lifeId(owner, name) {
        rosterCalls.push(`lifeId:${owner}:${name}`);
        const id = options.lifeId === undefined ? LIFE : options.lifeId;
        return owner === 'own-a' && name.toLowerCase() === 'ranger' ? id : null;
      },
    },
    engine,
    cap: options.cap ?? 40,
    template: { ...TEMPLATE, managed: options.managed ?? MANAGED },
    audit: (line) => audit.push(line),
  };
  return { handle: createBodyHelper(deps), engine, audit, rosterCalls };
}

const start = (name = 'ranger', owner = 'own-a') => ({ verb: 'start', name, owner });

/** Records the config of every create, so a test can read the Body's real config. */
function captureCreates(engine: FakeEngine): Record<string, unknown>[] {
  const configs: Record<string, unknown>[] = [];
  const create = engine.create;
  engine.create = async (name, config) => {
    configs.push(config);
    return create(name, config);
  };
  return configs;
}

describe('start runs the admit one-shot first', () => {
  it('runs the admit under its fixed name before the Body is created', async () => {
    const { handle, engine } = setup();
    expect(await handle(start())).toMatchObject({ ok: true, state: 'started' });
    const admit = engine.calls.indexOf(`oneshot:${ADMIT_NAME}`);
    const create = engine.calls.findIndex((call) => call.startsWith('create:'));
    expect(admit).toBe(0);
    expect(create).toBeGreaterThan(admit);
  });

  it('creates the admit in add mode under its exact name, with the mode in Env and the label', async () => {
    const { handle, engine } = setup();
    await handle(start());
    const admit = engine.oneShots[0];
    expect(admit?.name).toBe(ADMIT_NAME);
    const config = admit?.config as { Env: string[]; Labels: Record<string, string> };
    expect(config.Env).toContain('GELDAR_ADMIT_MODE=add');
    expect(config.Labels['geldar.admit']).toBe('add');
  });

  it('binds exactly the RCON password file into the admit, read-only', async () => {
    const { handle, engine } = setup();
    await handle(start());
    const config = engine.oneShots[0]?.config as { HostConfig: { Binds: string[] } };
    expect(config.HostConfig.Binds).toEqual([`${RCON_PATH}:/run/secrets/rcon:ro`]);
  });

  it('gives the Body config no RCON env, no RCON bind and no Docker socket', async () => {
    const { handle, engine } = setup();
    const configs = captureCreates(engine);
    await handle(start());
    expect(configs).toHaveLength(1);
    const text = JSON.stringify(configs[0]).toLowerCase();
    expect(text).not.toContain('rcon');
    expect(text).not.toContain('docker.sock');
    expect(text).not.toContain(SENTINEL.toLowerCase());
  });

  it('forwards managed.observations to the Body Env, and adds no GELDAR_OBSERVATIONS key when unset (AN-50d)', async () => {
    const on = setup({ managed: { ...MANAGED, observations: '1' } });
    const onConfigs = captureCreates(on.engine);
    await on.handle(start());
    expect((onConfigs[0] as { Env: string[] }).Env).toContain('GELDAR_OBSERVATIONS=1');

    const off = setup();
    const offConfigs = captureCreates(off.engine);
    await off.handle(start());
    expect(JSON.stringify(offConfigs[0])).not.toContain('GELDAR_OBSERVATIONS');
  });
});

describe('a failed admit leaves no Body and restores the counters', () => {
  it('refuses with the fixed reason when the admit exits non-zero, and removes the admit', async () => {
    const { handle, engine } = setup({ cap: 1 });
    engine.oneShotExit = 1;
    expect(await handle(start())).toMatchObject({
      ok: false,
      code: 'refused',
      error: ADMIT_REFUSAL,
    });
    expect(engine.calls.some((call) => call.startsWith('create:'))).toBe(false);
    expect(await engine.inspect(ADMIT_NAME)).toBeNull();
    expect(await engine.inspect('ranger')).toBeNull();
  });

  it('refuses with the fixed reason when the admit throws, and removes the admit', async () => {
    const { handle, engine } = setup({ cap: 1 });
    engine.oneShotThrows = true;
    expect(await handle(start())).toMatchObject({
      ok: false,
      code: 'refused',
      error: ADMIT_REFUSAL,
    });
    expect(engine.calls.some((call) => call.startsWith('create:'))).toBe(false);
    expect(await engine.inspect(ADMIT_NAME)).toBeNull();
  });

  it('lets a following start succeed at cap 1, so the failed start released its slot', async () => {
    const { handle, engine } = setup({ cap: 1 });
    engine.oneShotExit = 1;
    await handle(start());
    engine.oneShotExit = 0;
    expect(await handle(start())).toMatchObject({ ok: true, state: 'started' });
  });

  it('keeps the admit out of the cap: 39 Bodies with the admit in flight accept a 40th', async () => {
    const seed = Array.from({ length: 39 }, (_, i) => bodyFixture(`body-${i}`, true));
    const engine = createFakeEngine(seed);
    let countDuringAdmit = -1;
    engine.oneShotHook = async () => {
      countDuringAdmit = await engine.countCounted();
    };
    const { handle } = setup({ engine });
    expect(await handle(start())).toMatchObject({ ok: true, state: 'started' });
    expect(countDuringAdmit).toBe(39);
  });

  it('refuses a 41st start with the capacity reason, before any admit runs', async () => {
    const seed = Array.from({ length: 40 }, (_, i) => bodyFixture(`body-${i}`, true));
    const engine = createFakeEngine(seed);
    const { handle } = setup({ engine });
    expect(await handle(start())).toMatchObject({
      ok: false,
      code: 'capacity',
      error: CAP_REFUSAL,
    });
    expect(engine.oneShots).toHaveLength(0);
  });
});

describe('refusals before any Engine call', () => {
  it('refuses a managed start with the flag off, before any roster or Engine call', async () => {
    const { handle, engine, rosterCalls } = setup({ managed: { ...MANAGED, enabled: false } });
    expect(await handle(start())).toMatchObject({ ok: false, error: MANAGED_REFUSAL });
    expect(rosterCalls).toEqual([]);
    expect(engine.calls).toEqual([]);
  });

  it('refuses when the RCON path is missing, before the admit', async () => {
    const { handle, engine } = setup({
      managed: { enabled: true, db: MANAGED.db },
    });
    expect(await handle(start())).toMatchObject({ ok: false, error: MANAGED_REFUSAL });
    expect(engine.calls).toEqual([]);
  });

  it('refuses when the managed DB config is missing, before the admit', async () => {
    const { handle, engine } = setup({
      managed: { enabled: true, rconSecretHostPath: RCON_PATH },
    });
    expect(await handle(start())).toMatchObject({ ok: false, error: MANAGED_REFUSAL });
    expect(engine.calls).toEqual([]);
  });

  it.each([
    ['a null life id', null],
    ['a life id outside the managed shape', 'ag_BAD!'],
    ['an upper-case life id', 'ag_0123456789AB'],
  ])('refuses %s as not on the roster, before any Engine call', async (_label, lifeId) => {
    const { handle, engine } = setup({ lifeId });
    expect(await handle(start())).toMatchObject({ ok: false, error: 'not on roster' });
    expect(engine.calls).toEqual([]);
  });

  it.each([
    ['a name with shell characters', 'ranger;rm -rf /'],
    ['a traversal name', '../../etc/passwd'],
  ])('keeps %s away from every Engine call', async (_label, name) => {
    const { handle, engine } = setup();
    const reply = await handle(start(name));
    expect(reply).toMatchObject({ ok: false });
    expect(engine.calls).toEqual([]);
    expect(engine.oneShots).toEqual([]);
  });

  it('keeps a hostile owner away from every Engine call', async () => {
    const { handle, engine } = setup();
    expect(await handle(start('ranger', 'own-a/../../x'))).toMatchObject({ ok: false });
    expect(engine.calls).toEqual([]);
  });
});

describe('the RCON path never reaches a log or a reply', () => {
  it('keeps the sentinel out of the audit lines and replies on success and on admit failure', async () => {
    const ok = setup();
    const okReply = await ok.handle(start());
    const exits = setup();
    exits.engine.oneShotExit = 1;
    const exitReply = await exits.handle(start());
    const throws = setup();
    throws.engine.oneShotThrows = true;
    const throwReply = await throws.handle(start());
    const lines = [...ok.audit, ...exits.audit, ...throws.audit].join('\n');
    expect(lines).not.toContain(SENTINEL);
    expect(JSON.stringify([okReply, exitReply, throwReply])).not.toContain(SENTINEL);
  });
});
