import { viewSubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { EventPublisher } from '../body/records-nats.ts';
import { SnapshotRevision } from './revision.ts';
import { FakeEars, FakePerception, FakeVoice } from './senses.fakes.ts';
import {
  FakeRequestServer,
  GENERATION,
  LIFE,
  SHARD,
  StubExecutor,
  snapshotFrom,
} from './server.fakes.ts';
import { MindLinkServer, type MindLinkServerOptions } from './server.ts';

const publisher: EventPublisher = { publish: async () => {} };

function rig(view?: MindLinkServerOptions['view']) {
  const transport = new FakeRequestServer();
  const logs: string[] = [];
  const server = new MindLinkServer({
    shard: SHARD,
    lifeId: LIFE,
    bodyGeneration: GENERATION,
    revision: new SnapshotRevision(),
    server: transport,
    executor: new StubExecutor(),
    perception: new FakePerception(),
    ears: new FakeEars(),
    voice: new FakeVoice(),
    buildSnapshot: snapshotFrom,
    tick: () => 10,
    publisher,
    ...(view === undefined ? {} : { view }),
    log: (line) => logs.push(line),
  });
  server.start();
  return { transport, server, logs };
}

const ask = (transport: FakeRequestServer, data: string): Promise<string | null> =>
  transport.request(viewSubject(SHARD, LIFE), data);

describe('MindLinkServer view', () => {
  it('serves the view subject of its life', () => {
    const { transport } = rig(async () => 'x');
    expect(transport.subjects).toContain(viewSubject(SHARD, LIFE));
  });

  it('passes the size asked to the view and replies with the text', async () => {
    const sizes: unknown[] = [];
    const { transport } = rig(async (size) => {
      sizes.push(size);
      return 'Facing north.';
    });
    const reply = await ask(transport, JSON.stringify({ cols: 21, rows: 9 }));
    expect(JSON.parse(reply as string)).toEqual({ text: 'Facing north.' });
    expect(sizes).toEqual([{ cols: 21, rows: 9 }]);
  });

  it('passes an empty size when none is named', async () => {
    const sizes: unknown[] = [];
    const { transport } = rig(async (size) => {
      sizes.push(size);
      return 'x';
    });
    await ask(transport, '{}');
    expect(sizes).toEqual([{}]);
  });

  it('refuses a request outside the contract without reading the bot', async () => {
    const sizes: unknown[] = [];
    const { transport } = rig(async (size) => {
      sizes.push(size);
      return 'x';
    });
    for (const data of ['not json', '{"cols":42}', '{"reach":1}', '[]']) {
      expect(JSON.parse((await ask(transport, data)) as string)).toEqual({ error: 'unavailable' });
    }
    expect(sizes).toEqual([]);
  });

  it('answers unavailable, and logs the cause, when the view throws', async () => {
    const { transport, logs } = rig(async () => {
      throw new Error('bot has no world');
    });
    expect(JSON.parse((await ask(transport, '{}')) as string)).toEqual({ error: 'unavailable' });
    expect(logs.join('\n')).toContain('bot has no world');
  });

  it('answers unavailable when the text is over the contract limit', async () => {
    const { transport } = rig(async () => 'x'.repeat(4001));
    expect(JSON.parse((await ask(transport, '{}')) as string)).toEqual({ error: 'unavailable' });
  });

  it('answers unavailable when no view is wired', async () => {
    const { transport } = rig();
    expect(JSON.parse((await ask(transport, '{}')) as string)).toEqual({ error: 'unavailable' });
  });

  it('stops answering once serving is stopped', async () => {
    const { transport, server } = rig(async () => 'x');
    server.stopServing();
    await expect(ask(transport, '{}')).rejects.toThrow('nobody serves');
  });
});
