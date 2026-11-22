import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerConfig } from './player-config.ts';

// runManagedBody stops right after it opens the restart KV: the fake throws, so the test sees the
// arguments and the connection close without starting a Body.
const state = vi.hoisted(() => ({
  restartArgs: [] as unknown[][],
  closed: 0,
}));

vi.mock('@geldar/contract/nats', () => ({
  connectNats: async () => ({
    close: async () => {
      state.closed += 1;
    },
  }),
}));
vi.mock('../body/restart.ts', () => ({
  openRestartKv: async (...args: unknown[]) => {
    state.restartArgs.push(args);
    throw new Error('restart stop');
  },
}));
vi.mock('../config.ts', () => ({ loadStackConfig: () => ({}) }));
vi.mock('../nats-credentials.ts', () => ({ golemNatsAuth: () => ({}) }));

const { runManagedBody } = await import('./managed-main.ts');

function config(building: boolean): PlayerConfig {
  return { lifeId: 'ag_jason_01', building } as unknown as PlayerConfig;
}

describe('runManagedBody opens the restart buckets as Adam does (A1)', () => {
  beforeEach(() => {
    state.restartArgs.length = 0;
    state.closed = 0;
  });

  it('passes body_actions.building on, so the plan and seen buckets are opened', async () => {
    await expect(runManagedBody(config(true), {})).rejects.toThrow('restart stop');
    expect(state.restartArgs).toEqual([['', true]]);
  });

  it('passes body_actions.building off, so neither building bucket is opened', async () => {
    await expect(runManagedBody(config(false), {})).rejects.toThrow('restart stop');
    expect(state.restartArgs).toEqual([['', false]]);
  });

  it('closes the connection when the restart KV fails to open', async () => {
    await expect(runManagedBody(config(true), {})).rejects.toThrow('restart stop');
    expect(state.closed).toBe(1);
  });
});
