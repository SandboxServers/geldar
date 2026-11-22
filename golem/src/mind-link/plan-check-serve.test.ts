import { planCheckSubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { EventPublisher } from '../body/records-nats.ts';
import { answerPlanCheck, planCheckFrom } from '../building/plan-check-reply.ts';
import { SeenMap } from '../building/seen/section.ts';
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

function rig(planCheck?: MindLinkServerOptions['planCheck']) {
  const transport = new FakeRequestServer();
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
    tick: () => 900,
    publisher,
    ...(planCheck === undefined ? {} : { planCheck }),
    log: () => undefined,
  });
  server.start();
  return { transport };
}

const ask = (transport: FakeRequestServer, data: string): Promise<string | null> =>
  transport.request(planCheckSubject(SHARD, LIFE), data);

const PLAN = {
  plan: {
    palette: { stone: { block: 'stone' } },
    steps: [{ op: 'box', pal: 'stone', from: { x: 1, y: 64, z: 1 }, to: { x: 2, y: 64, z: 1 } }],
  },
};

describe('MindLinkServer plan_check (round trip with the seen map)', () => {
  it('serves the plan_check subject of its life', () => {
    const { transport } = rig();
    expect(transport.subjects).toContain(planCheckSubject(SHARD, LIFE));
  });

  it('answers the dry run from the Body seen map and pack, with the contract shape', async () => {
    const map = new SeenMap();
    map.record(1, 64, 1, 'stone', 10);
    const bot = {
      inventory: { items: () => [{ name: 'stone', count: 3 }] },
      entity: { position: { x: 1.5, y: 64, z: 1.5 } },
    };
    const { transport } = rig(planCheckFrom(map, bot));
    const reply = JSON.parse((await ask(transport, JSON.stringify(PLAN))) as string) as Record<
      string,
      unknown
    >;
    expect(Object.keys(reply).sort()).toEqual([
      'cells',
      'estimated_ticks',
      'invalid_steps',
      'material_needs',
      'unknown_cells',
    ]);
    expect(reply).toMatchObject({
      cells: 2,
      unknown_cells: 1,
      material_needs: { stone: { need: 2, have: 3 } },
    });
  });

  it('answers not_available when no plan_check is wired (the building flag is off)', async () => {
    const { transport } = rig();
    expect(JSON.parse((await ask(transport, JSON.stringify(PLAN))) as string)).toEqual({
      error: 'not_available',
    });
  });

  it('answers not_available for a request that is not JSON, without calling the dry run', async () => {
    let asked = 0;
    const { transport } = rig(() => {
      asked += 1;
      return {};
    });
    expect(JSON.parse((await ask(transport, 'not json')) as string)).toEqual({
      error: 'not_available',
    });
    expect(asked).toBe(0);
  });

  it('answers not_available when the bot has no position, so the gateway fails closed', () => {
    const map = new SeenMap();
    const bot = { inventory: { items: () => [] } };
    expect(
      answerPlanCheck(
        {
          seen: map,
          pack: () => ({}),
          feet: () => {
            throw new Error('no body');
          },
        },
        PLAN,
        true,
      ),
    ).toEqual({
      error: 'not_available',
    });
    expect(planCheckFrom(map, bot)(PLAN)).toEqual({ error: 'not_available' });
  });
});
