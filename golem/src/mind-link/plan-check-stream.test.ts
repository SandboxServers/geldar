import { planCheckSubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { EventPublisher } from '../body/records-nats.ts';
import { SnapshotRevision } from './revision.ts';
import { FakeEars, FakePerception, FakeVoice } from './senses.fakes.ts';
import { GENERATION, LIFE, SHARD, StubExecutor, snapshotFrom } from './server.fakes.ts';
import { MindLinkServer, type MindLinkServerOptions, type RequestServer } from './server.ts';

type Handler = (data: string, reply: (body: string) => void) => Promise<void>;

/** A request server that keeps every reply of a request, in the order the handler sends them. */
class CollectingServer implements RequestServer {
  private readonly handlers = new Map<string, Handler>();

  serve(subject: string, handler: Handler): () => void {
    this.handlers.set(subject, handler);
    return () => {
      this.handlers.delete(subject);
    };
  }

  async ask(subject: string, data: string): Promise<string[]> {
    const sent: string[] = [];
    await this.handlers.get(subject)?.(data, (body) => sent.push(body));
    return sent;
  }
}

const publisher: EventPublisher = { publish: async () => {} };

function serverWith(planCheck: MindLinkServerOptions['planCheck']): CollectingServer {
  const transport = new CollectingServer();
  new MindLinkServer({
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
    tick: () => 900,
    publisher,
    ...(planCheck === undefined ? {} : { planCheck }),
    log: () => undefined,
  }).start();
  return transport;
}

const FINAL = {
  cells: 2,
  material_needs: {},
  unknown_cells: 0,
  estimated_ticks: 2,
  invalid_steps: [],
};
const PLAN = JSON.stringify({ plan: { palette: {}, steps: [] } });

describe('MindLinkServer plan_check streams progress on the reply inbox', () => {
  it('sends each progress chunk, in order, before the final answer, on the same reply', async () => {
    const transport = serverWith((_request, progress) => {
      progress({ layers_done: 1, cells_checked: 1 });
      progress({ layers_done: 2, cells_checked: 2 });
      return FINAL;
    });
    const sent = await transport.ask(planCheckSubject(SHARD, LIFE), PLAN);
    expect(sent.map((text) => JSON.parse(text) as unknown)).toEqual([
      { progress: { layers_done: 1, cells_checked: 1 } },
      { progress: { layers_done: 2, cells_checked: 2 } },
      FINAL,
    ]);
  });

  it('a plan_check with no progress sends its final answer alone', async () => {
    const transport = serverWith(() => FINAL);
    const sent = await transport.ask(planCheckSubject(SHARD, LIFE), PLAN);
    expect(sent).toEqual([JSON.stringify(FINAL)]);
  });

  it('a plan_check with no dry run wired is refused as not_available, with no progress', async () => {
    const transport = serverWith(undefined);
    const sent = await transport.ask(planCheckSubject(SHARD, LIFE), PLAN);
    expect(sent).toEqual(['{"error":"not_available"}']);
  });
});
