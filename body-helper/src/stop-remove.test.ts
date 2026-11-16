import { describe, expect, it } from 'vitest';
import {
  bodyFixture,
  createFakeEngine,
  type FakeContainer,
  type FakeEngine,
} from './fake-engine.ts';
import { LIFE_LABEL } from './managed-template.ts';
import {
  createBodyHelper,
  type HelperDeps,
  LIFE_REMOVAL_FAILED,
  type ManagedSettings,
  type Reply,
} from './service.ts';
import { BODY_LABEL } from './template.ts';

// The stop of a managed Body runs the remove one-shot (BH-5b) after the container stops. A house or Adam Body carries no
// geldar.life label, so its stop never runs a one-shot. A failed remove is reported as `failed`, never as a success.
const SENTINEL = 'SENTINEL-rcon-host-path';
const RCON_PATH = `/root/secrets/rcon-${SENTINEL}.txt`;
const LIFE = 'ag_0123456789ab';
const REMOVE_NAME = `geldar-unadmit-${LIFE}`;

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

/** A managed Body as BH-5a creates it: the Body label, the owner and the validated life id label. */
function managedFixture(name: string, running: boolean, owner = 'own-a'): FakeContainer {
  return {
    name,
    id: `id-${name}`,
    running,
    labels: { [BODY_LABEL]: name, 'geldar.owner': owner, [LIFE_LABEL]: LIFE },
  };
}

interface SetupOptions {
  engine?: FakeEngine;
  managed?: ManagedSettings;
}

/** A helper over the shared fake. The roster answers LIFE for own-a's ranger and null for everyone else. */
function setup(options: SetupOptions = {}) {
  const engine = options.engine ?? createFakeEngine();
  const audit: string[] = [];
  const rosterCalls: string[] = [];
  const deps: HelperDeps = {
    roster: {
      async displayName(owner, name) {
        return owner === 'own-a' && name.toLowerCase() === 'ranger' ? 'Ranger' : null;
      },
      async lifeId(owner, name) {
        rosterCalls.push(`lifeId:${owner}:${name}`);
        return owner === 'own-a' && name.toLowerCase() === 'ranger' ? LIFE : null;
      },
    },
    engine,
    cap: 40,
    template: { ...TEMPLATE, managed: options.managed ?? MANAGED },
    audit: (line) => audit.push(line),
  };
  return { handle: createBodyHelper(deps), engine, audit, rosterCalls };
}

const stop = (name = 'ranger', owner = 'own-a') => ({ verb: 'stop', name, owner });

/** Records each Engine stop in the call log, so a test can check that the stop lands before the one-shot. */
function recordStops(engine: FakeEngine): void {
  const stopOne = engine.stop;
  engine.stop = async (name) => {
    engine.calls.push(`stop:${name}`);
    return stopOne(name);
  };
}

describe('stop of a managed Body runs the remove one-shot after the stop', () => {
  it('stops the container, then removes the life id under the fixed unadmit name', async () => {
    const { handle, engine } = setup({
      engine: createFakeEngine([managedFixture('ranger', true)]),
    });
    recordStops(engine);
    expect(await handle(stop())).toMatchObject({ ok: true, state: 'stopped' });
    expect(engine.oneShots.map((s) => s.name)).toEqual([REMOVE_NAME]);
    expect(engine.calls.indexOf('stop:ranger')).toBe(0);
    expect(engine.calls.indexOf(`oneshot:${REMOVE_NAME}`)).toBe(1);
  });

  it('creates the one-shot in remove mode with the life id, the mode label and the same template as add', async () => {
    const { handle, engine } = setup({
      engine: createFakeEngine([managedFixture('ranger', true)]),
    });
    await handle(stop());
    const config = engine.oneShots[0]?.config as {
      Env: string[];
      Labels: Record<string, string>;
      HostConfig: { Binds: string[]; NetworkMode: string; ReadonlyRootfs: boolean };
    };
    expect(config.Env).toContain('GELDAR_ADMIT_MODE=remove');
    expect(config.Env).toContain(`GELDAR_ADMIT_LIFE_ID=${LIFE}`);
    expect(config.Labels['geldar.admit']).toBe('remove');
    expect(config.HostConfig.Binds).toEqual([`${RCON_PATH}:/run/secrets/rcon:ro`]);
    expect(config.HostConfig.ReadonlyRootfs).toBe(true);
  });

  it('removes a stopped managed Body too (a retry after a failed remove runs it again)', async () => {
    const { handle, engine } = setup({
      engine: createFakeEngine([managedFixture('ranger', false)]),
    });
    expect(await handle(stop())).toMatchObject({ ok: true, state: 'stopped' });
    expect(engine.oneShots.map((s) => s.name)).toEqual([REMOVE_NAME]);
  });
});

describe('house and Adam Bodies are not managed and are never touched by the remove', () => {
  it('a house Body (no geldar.life label) stops with no one-shot at all, even when the remove would fail', async () => {
    const engine = createFakeEngine([bodyFixture('house', true, 'own-a')]);
    engine.oneShotExit = 1;
    const { handle } = setup({ engine });
    recordStops(engine);
    expect(await handle(stop('house', 'own-a'))).toMatchObject({ ok: true, state: 'stopped' });
    expect(engine.oneShots).toHaveLength(0);
    expect(engine.calls).toEqual(['stop:house']);
  });

  it('an Adam Body (no geldar.life label, another owner) stops with no one-shot and no roster read', async () => {
    const engine = createFakeEngine([bodyFixture('adam', true, 'adam-owner')]);
    const { handle, rosterCalls } = setup({ engine });
    expect(await handle(stop('adam', 'adam-owner'))).toMatchObject({ ok: true, state: 'stopped' });
    expect(engine.oneShots).toHaveLength(0);
    expect(rosterCalls).toHaveLength(0);
  });

  it('a stopped house Body with no managed label runs no one-shot', async () => {
    const engine = createFakeEngine([bodyFixture('house', false, 'own-a')]);
    const { handle } = setup({ engine });
    expect(await handle(stop('house', 'own-a'))).toMatchObject({ ok: true, state: 'stopped' });
    expect(engine.oneShots).toHaveLength(0);
  });
});

describe('a missing container resolves the life id from the roster and removes it', () => {
  it('removes the roster life id, then answers not_running', async () => {
    const { handle, engine, rosterCalls } = setup();
    expect(await handle(stop())).toMatchObject({ ok: false, code: 'not_running' });
    expect(rosterCalls).toEqual(['lifeId:own-a:ranger']);
    expect(engine.oneShots.map((s) => s.name)).toEqual([REMOVE_NAME]);
  });

  it('answers not_running with no one-shot when the roster has no life id', async () => {
    const { handle, engine } = setup();
    expect(await handle(stop('nobody', 'own-a'))).toMatchObject({ ok: false, code: 'not_running' });
    expect(engine.oneShots).toHaveLength(0);
  });

  it('reports a failed remove as failed, not not_running, when the container is already gone', async () => {
    const engine = createFakeEngine();
    engine.oneShotExit = 1;
    const { handle } = setup({ engine });
    expect(await handle(stop())).toEqual({ ok: false, code: 'failed', error: LIFE_REMOVAL_FAILED });
  });
});

describe('a failed remove is reported, never swallowed', () => {
  it('replies failed with the fixed text when the one-shot exits non-zero, and audits it', async () => {
    const engine = createFakeEngine([managedFixture('ranger', true)]);
    engine.oneShotExit = 1;
    const { handle, audit } = setup({ engine });
    const reply: Reply = await handle(stop());
    expect(reply).toEqual({ ok: false, code: 'failed', error: 'life removal failed' });
    expect(audit).toContain('body-helper verb=stop name=ranger outcome=failed reason=life_removal');
    expect(audit.some((line) => line.includes('outcome=accepted'))).toBe(false);
  });

  it('replies failed when the one-shot throws (the Engine could not run it)', async () => {
    const engine = createFakeEngine([managedFixture('ranger', true)]);
    engine.oneShotThrows = true;
    const { handle, audit } = setup({ engine });
    expect(await handle(stop())).toEqual({ ok: false, code: 'failed', error: LIFE_REMOVAL_FAILED });
    expect(audit).toContain('body-helper verb=stop name=ranger outcome=failed reason=life_removal');
  });

  it('replies failed, and runs no one-shot, when the rcon file is not configured (fail closed)', async () => {
    const engine = createFakeEngine([managedFixture('ranger', true)]);
    const { handle } = setup({ engine, managed: { ...MANAGED, rconSecretHostPath: undefined } });
    expect(await handle(stop())).toEqual({ ok: false, code: 'failed', error: LIFE_REMOVAL_FAILED });
    expect(engine.oneShots).toHaveLength(0);
  });

  it('a retry after a failed remove succeeds once the one-shot works again (idempotent)', async () => {
    const engine = createFakeEngine([managedFixture('ranger', true)]);
    engine.oneShotExit = 1;
    const { handle } = setup({ engine });
    expect(await handle(stop())).toMatchObject({ ok: false, code: 'failed' });
    engine.oneShotExit = 0;
    expect(await handle(stop())).toMatchObject({ ok: true, state: 'stopped' });
    expect(engine.oneShots).toHaveLength(2);
  });
});
