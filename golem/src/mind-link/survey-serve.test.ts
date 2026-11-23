import { surveySubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { EventPublisher } from '../body/records-nats.ts';
import { SeenMap } from '../building/seen/section.ts';
import { surveyBox } from '../building/seen/survey.ts';
import { answerSurvey } from '../building/survey-reply.ts';
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

function rig(survey?: MindLinkServerOptions['survey']) {
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
    ...(survey === undefined ? {} : { survey }),
    log: () => undefined,
  });
  server.start();
  return { transport };
}

const ask = (transport: FakeRequestServer, data: string): Promise<string | null> =>
  transport.request(surveySubject(SHARD, LIFE), data);

const INPUT = { box: { from: { x: 1, y: 64, z: 1 }, to: { x: 2, y: 64, z: 1 } } };

describe('MindLinkServer survey (round trip with the seen map)', () => {
  it('serves the survey subject of its life', () => {
    const { transport } = rig(() => ({ error: 'not_available' }));
    expect(transport.subjects).toContain(surveySubject(SHARD, LIFE));
  });

  it('answers the request from the seen map, with text and truncated only', async () => {
    const map = new SeenMap();
    map.record(1, 64, 1, 'stone', 10);
    const { transport } = rig((request) =>
      answerSurvey({ survey: (box, tick) => surveyBox(map, box, tick) }, request, 900, true),
    );
    const reply = JSON.parse((await ask(transport, JSON.stringify(INPUT))) as string) as Record<
      string,
      unknown
    >;
    expect(Object.keys(reply).sort()).toEqual(['text', 'truncated']);
    expect(reply.text).toContain('stone');
    expect(reply.text).toContain('unknown');
  });

  it('answers not_available when no survey is wired (the building flag is off)', async () => {
    const { transport } = rig();
    expect(JSON.parse((await ask(transport, JSON.stringify(INPUT))) as string)).toEqual({
      error: 'not_available',
    });
  });

  it('answers not_available when the building flag is off, and never asks the map', async () => {
    const map = new SeenMap();
    map.record(1, 64, 1, 'stone', 10);
    const { transport } = rig((request) =>
      answerSurvey({ survey: (box, tick) => surveyBox(map, box, tick) }, request, 900, false),
    );
    expect(JSON.parse((await ask(transport, JSON.stringify(INPUT))) as string)).toEqual({
      error: 'not_available',
    });
  });

  it('answers not_available for a request that is not JSON, without calling the survey', async () => {
    let asked = 0;
    const { transport } = rig(() => {
      asked += 1;
      return { text: '', truncated: false };
    });
    expect(JSON.parse((await ask(transport, 'not json')) as string)).toEqual({
      error: 'not_available',
    });
    expect(asked).toBe(0);
  });
});
