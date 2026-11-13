import { bookSubject } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { AdamBodyEnv } from '../adam/adam-body.ts';
import { FakeRequestServer, LIFE, SHARD } from '../mind-link/server.fakes.ts';
import { bookServe, playerBodyEnv, playerIdFromArgs, startPlayerBody } from './main.ts';

// The Body itself is not under test here: the stub stands in for `startAdamBody`, so the
// `extraServe` path of `startPlayerBody` runs for real.
vi.mock('../adam/adam-body.ts', () => ({
  startAdamBody: async () => ({ stop: async () => {} }),
}));

const WRITTEN = {
  name: 'written_book',
  count: 1,
  components: [
    {
      name: 'minecraft:written_book_content',
      data: { title: 'Field notes', author: 'Jason', pages: ['Walk north.'] },
    },
  ],
};
const OTHER_LIFE = 'ag_jason_01';

function bot(): Bot {
  return { heldItem: WRITTEN, inventory: { items: () => [] } } as unknown as Bot;
}

describe('the player host body env (decision 0165)', () => {
  it('carries the host connection as the ownership transport, so the ranger Body wires it', () => {
    const nc = {} as Parameters<typeof playerBodyEnv>[0]['nc'];
    const env = playerBodyEnv({
      config: {} as AdamBodyEnv['config'],
      kv: {} as AdamBodyEnv['kv'],
      publisher: { publish: async () => undefined },
      nc,
      server: new FakeRequestServer(),
      log: () => {},
    });
    expect(env.owners).toBe(nc);
  });
});

describe('playerIdFromArgs', () => {
  it('reads the id after --player', () => {
    expect(playerIdFromArgs(['--player', 'ag-jason-01'])).toBe('ag-jason-01');
    expect(playerIdFromArgs(['x', '--player', 'ag-jason-01'])).toBe('ag-jason-01');
  });

  it('refuses a missing id, and a flag where the id belongs', () => {
    expect(() => playerIdFromArgs([])).toThrow(/usage: main.ts --player/);
    expect(() => playerIdFromArgs(['--player'])).toThrow(/usage/);
    expect(() => playerIdFromArgs(['--player', '--other'])).toThrow(/usage/);
  });
});

describe('startPlayerBody with the book server beside the Body', () => {
  const env = {} as AdamBodyEnv;

  it('answers the book request for the bound life, and stops serving it with the Body', async () => {
    const server = new FakeRequestServer();
    const running = await startPlayerBody(
      env,
      bot(),
      bookServe({ shard: SHARD, lifeId: LIFE, server, log: () => {} }),
    );
    const reply = await server.request(bookSubject(SHARD, LIFE), JSON.stringify({ life_id: LIFE }));
    expect(JSON.parse(reply ?? '{}').status).toBe('ok');
    await running.stop();
    expect(server.subjects).toEqual([]);
  });

  it('does not answer a book request that names another life', async () => {
    const server = new FakeRequestServer();
    const running = await startPlayerBody(
      env,
      bot(),
      bookServe({ shard: SHARD, lifeId: LIFE, server, log: () => {} }),
    );
    const reply = await server.request(
      bookSubject(SHARD, LIFE),
      JSON.stringify({ life_id: OTHER_LIFE }),
    );
    expect(reply).toBeNull();
    await expect(
      server.request(bookSubject(SHARD, OTHER_LIFE), JSON.stringify({ life_id: OTHER_LIFE })),
    ).rejects.toThrow(/nobody serves/);
    await running.stop();
  });
});
