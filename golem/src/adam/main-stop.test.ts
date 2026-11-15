import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './main.ts';

// main() runs with the NATS connection, the restart KV and the Body faked. The connection manager's first
// start fails fatally, so the supervisor ends at once and main() reaches its shutdown steps.
const calls = vi.hoisted(() => ({ log: [] as string[] }));

vi.mock('@geldar/contract/nats', () => ({
  connectNats: async () => ({
    close: async () => {
      calls.log.push('nc.close');
    },
  }),
}));
vi.mock('@nats-io/jetstream', () => ({ jetstream: () => ({}) }));
vi.mock('../body/records-nats.ts', () => ({ jetStreamPublisher: () => ({}) }));
vi.mock('../body/restart.ts', () => ({
  assertLoopbackNatsUrl: () => undefined,
  openRestartKv: async () => ({
    kv: {},
    close: async () => {
      calls.log.push('kv.close');
    },
  }),
}));
vi.mock('../character/proficiency-host.ts', () => ({
  startProficiency: () => ({
    stop: () => {
      calls.log.push('proficiency.stop');
    },
  }),
}));
vi.mock('../config.ts', () => ({
  loadStackConfig: () => ({ natsUrl: 'nats://127.0.0.1:4222', mcHost: 'localhost', mcPort: 25565 }),
}));
vi.mock('../connection.ts', () => ({
  ConnectionManager: class {
    async start(): Promise<never> {
      throw Object.assign(new Error('kicked for test'), { fatal: true });
    }
    async stop(): Promise<void> {
      calls.log.push('manager.stop');
    }
  },
}));
vi.mock('../metrics.ts', () => ({
  startGolemTelemetry: () => ({ metrics: undefined, stop: async () => undefined }),
}));
vi.mock('../mind-link/server.ts', () => ({ natsRequestServer: () => ({}) }));
vi.mock('../nats-credentials.ts', () => ({ golemNatsAuth: () => ({}) }));
vi.mock('../registry.ts', () => ({ registryFromConfig: () => ({}) }));
vi.mock('./adam-body.ts', () => ({
  startAdamBody: async () => {
    throw new Error('the Body is not started in this test');
  },
}));
vi.mock('./adam-config.ts', () => ({
  loadAdamConfig: async () => ({ lifeId: 'ag_adam_01', shard: 'phase0', character: undefined }),
}));

describe('main() shutdown (AN-12a)', () => {
  const exitCode = process.exitCode;

  beforeEach(() => {
    calls.log.length = 0;
  });

  afterEach(() => {
    // The fatal start sets a non-zero exit code; the test restores the runner's.
    process.exitCode = exitCode;
  });

  it('stops the proficiency cache after the connection manager and before the connections close', async () => {
    await main();
    expect(calls.log).toEqual(['manager.stop', 'proficiency.stop', 'kv.close', 'nc.close']);
  });
});
