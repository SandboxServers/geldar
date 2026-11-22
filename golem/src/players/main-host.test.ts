import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdamBodyEnv } from '../adam/adam-body.ts';
import { playerBodyEnv, runPlayer } from './main.ts';

// runPlayer runs with the connections, the restart KV, the proficiency cache and the session faked. The
// config's start is 'never', so the presence watch ends at once and runPlayer reaches its shutdown steps.
const state = vi.hoisted(() => ({
  log: [] as string[],
  failKv: false,
  failPresence: false,
  failProficiency: false,
  building: false,
  restartArgs: [] as unknown[][],
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: async () => '',
}));
vi.mock('./player-config.ts', () => ({
  parsePlayerConfig: () => ({
    lifeId: 'ag_jason_01',
    shard: 'phase0',
    start: 'never',
    character: undefined,
    building: state.building,
  }),
}));
vi.mock('@geldar/contract/nats', () => ({
  connectNats: async () => ({
    close: async () => {
      state.log.push('nc.close');
    },
  }),
}));
vi.mock('@nats-io/jetstream', () => ({ jetstream: () => ({}) }));
vi.mock('@nats-io/kv', () => ({
  Kvm: class {
    async open() {
      if (state.failPresence) throw new Error('presence open failed');
      return {};
    }
  },
}));
vi.mock('./presence.ts', () => ({ watchPresence: async () => undefined }));
vi.mock('./session.ts', () => ({
  PlayerSession: class {
    async up(): Promise<void> {
      return;
    }
    async down(): Promise<void> {
      state.log.push('session.down');
    }
  },
}));
vi.mock('../body/restart.ts', () => ({
  assertLoopbackNatsUrl: () => undefined,
  openRestartKv: async (...args: unknown[]) => {
    state.restartArgs.push(args);
    if (state.failKv) throw new Error('kv open failed');
    return {
      kv: {},
      close: async () => {
        state.log.push('kv.close');
      },
    };
  },
}));
vi.mock('../character/proficiency-host.ts', () => ({
  startProficiency: () => {
    if (state.failProficiency) throw new Error('proficiency failed');
    return {
      stop: () => {
        state.log.push('proficiency.stop');
      },
    };
  },
}));
vi.mock('../body/records-nats.ts', () => ({ jetStreamPublisher: () => ({}) }));
vi.mock('../config.ts', () => ({
  loadStackConfig: () => ({}),
  readRconPassword: async () => '',
  repoRoot: () => '',
}));
vi.mock('../mind-link/server.ts', () => ({ natsRequestServer: () => ({}) }));
vi.mock('../nats-credentials.ts', () => ({ golemNatsAuth: () => ({}) }));
vi.mock('../adam/adam-body.ts', () => ({
  startAdamBody: async () => {
    throw new Error('the Body is not started in this test');
  },
}));

const ENV = { GELDAR_SHARD: 'phase0' };

describe('runPlayer shutdown and the connections (AN-12a)', () => {
  beforeEach(() => {
    state.log.length = 0;
    state.failKv = false;
    state.failPresence = false;
    state.failProficiency = false;
    state.building = false;
    state.restartArgs.length = 0;
  });

  it('opens the plan and seen buckets when the player config has body_actions.building on (A1)', async () => {
    state.building = true;
    await runPlayer('ag-jason-01', undefined, ENV);
    expect(state.restartArgs).toEqual([['', true]]);
  });

  it('does not open the plan and seen buckets when body_actions.building is off (A1)', async () => {
    await runPlayer('ag-jason-01', undefined, ENV);
    expect(state.restartArgs).toEqual([['', false]]);
  });

  it('stops the proficiency cache after the session, before the KV and the connection close', async () => {
    await runPlayer('ag-jason-01', undefined, ENV);
    expect(state.log).toEqual(['session.down', 'proficiency.stop', 'kv.close', 'nc.close']);
  });

  it('closes the connection when the restart KV fails to open', async () => {
    state.failKv = true;
    await expect(runPlayer('ag-jason-01', undefined, ENV)).rejects.toThrow('kv open failed');
    expect(state.log).toEqual(['nc.close']);
  });

  it('closes the KV and the connection when the presence bucket fails to open', async () => {
    state.failPresence = true;
    await expect(runPlayer('ag-jason-01', undefined, ENV)).rejects.toThrow('presence open failed');
    expect(state.log).toEqual(['kv.close', 'nc.close']);
  });

  it('closes the KV and the connection when the proficiency cache fails to start', async () => {
    state.failProficiency = true;
    await expect(runPlayer('ag-jason-01', undefined, ENV)).rejects.toThrow('proficiency failed');
    expect(state.log).toEqual(['kv.close', 'nc.close']);
  });
});

// runPlayer starts the host's Body telemetry from the env: a fake global fetch records each push.
describe('runPlayer starts the host telemetry (decision 0088)', () => {
  beforeEach(() => {
    state.log.length = 0;
    state.failKv = false;
    state.failPresence = false;
    state.failProficiency = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('with GELDAR_TELEMETRY_URL set, pushes once to /v1/metrics', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 200 });
    });
    await runPlayer('ag-jason-01', undefined, {
      ...ENV,
      GELDAR_TELEMETRY_URL: 'http://127.0.0.1:4318',
    });
    expect(urls).toEqual(['http://127.0.0.1:4318/v1/metrics']);
  });

  it('with GELDAR_TELEMETRY_URL unset, makes no request', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 200 });
    });
    await runPlayer('ag-jason-01', undefined, ENV);
    expect(urls).toEqual([]);
  });
});

describe('playerBodyEnv carries the proficiency cache (AN-12a)', () => {
  it('passes the host cache to the Body env as is', () => {
    const cache = { level: () => 3 } as unknown as AdamBodyEnv['proficiency'];
    const env = playerBodyEnv({
      proficiency: cache,
      config: {} as AdamBodyEnv['config'],
      kv: {} as AdamBodyEnv['kv'],
      publisher: { publish: async () => undefined },
      nc: {} as Parameters<typeof playerBodyEnv>[0]['nc'],
      server: { serve: () => () => undefined },
      log: () => undefined,
    });
    expect(env.proficiency).toBe(cache);
  });
});
