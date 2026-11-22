import type { RequestTransport } from '@geldar/player-core/src/link/nats-body-link.ts';
import { describe, expect, it } from 'vitest';
import { NatsBodyGateway } from './body-gateway.ts';
import { FakeBody } from './fakes/world.fakes.ts';
import { BodyUnavailable } from './ports.ts';
import type { ToolCall } from './tools/look.ts';
import { createSurveyLimiter, surveyTool } from './tools/survey.ts';

const LIFE = 'ag_jason_01';
const CALL = { lifeId: LIFE } as ToolCall;
const INPUT = { box: { from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 65, z: 1 } } };
const REPLY = { text: 'legend a=stone\ny=64\n  z=0 a?', truncated: false };

/** The survey tool wired to a gateway, as the world wires it. */
function toolOn(body: { survey: FakeBody['survey'] }, now = 0) {
  return (input: unknown) =>
    surveyTool(
      {
        survey: (lifeId, request) => body.survey(lifeId, request),
        isOpen: () => true,
        limiter: createSurveyLimiter(() => now),
      },
      CALL,
      input,
    );
}

describe('survey: tool -> gateway round trip (fakes)', () => {
  it('returns the Body reply as the tool result and sends the input to the gateway', async () => {
    const body = new FakeBody();
    body.setSurvey(LIFE, REPLY);
    const outcome = await toolOn(body)(INPUT);
    expect(outcome).toEqual({ survey: REPLY });
    expect(body.surveyRequests).toEqual([{ lifeId: LIFE, request: INPUT }]);
  });

  it('a Body that does not answer is body_unavailable, and the tool returns no survey', async () => {
    const body = new FakeBody();
    body.setOffline(LIFE, true);
    expect(await toolOn(body)(INPUT)).toEqual({ error: 'body_unavailable' });
  });

  it('a reply the contract does not accept is body_unavailable, not data', async () => {
    const body = new FakeBody();
    body.setSurvey(LIFE, { text: 'x', truncated: false, owner: 'ag_jason_01' });
    expect(await toolOn(body)(INPUT)).toEqual({ error: 'body_unavailable' });
  });
});

/** A transport that answers each request with the next scripted text, and records what it was asked. */
function surveyTransport(...replies: (string | Error)[]) {
  const sent: { subject: string; body: string; timeoutMs: number }[] = [];
  const transport = {
    request: async (subject: string, body: string, timeoutMs: number) => {
      sent.push({ subject, body, timeoutMs });
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return next ?? '{"text":"","truncated":false}';
    },
  } as unknown as RequestTransport;
  return { transport, sent };
}

describe('NatsBodyGateway.survey (the Body side over NATS)', () => {
  it('requests the survey subject of the life with the input and a 5 s window, and returns the reply', async () => {
    const { transport, sent } = surveyTransport(JSON.stringify(REPLY));
    const gateway = new NatsBodyGateway({ transport, shard: 'phase0' });
    expect(await gateway.survey(LIFE, INPUT)).toEqual(REPLY);
    expect(sent).toEqual([
      {
        subject: 'geldar.phase0.body.ag_jason_01.survey',
        body: JSON.stringify(INPUT),
        timeoutMs: 5_000,
      },
    ]);
  });

  it('refuses a flag-off reply (not_available) as BodyUnavailable, never as data', async () => {
    const { transport } = surveyTransport('{"error":"not_available"}');
    const gateway = new NatsBodyGateway({ transport, shard: 'phase0' });
    await expect(gateway.survey(LIFE, INPUT)).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('refuses a reply with an owner field as BodyUnavailable', async () => {
    const { transport } = surveyTransport(
      JSON.stringify({ text: 'x', truncated: false, owner: 'ag_jason_01' }),
    );
    const gateway = new NatsBodyGateway({ transport, shard: 'phase0' });
    await expect(gateway.survey(LIFE, INPUT)).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('refuses a reply that is not JSON, and a request that times out, as BodyUnavailable', async () => {
    const notJson = new NatsBodyGateway({
      transport: surveyTransport('not json').transport,
      shard: 'phase0',
    });
    await expect(notJson.survey(LIFE, INPUT)).rejects.toBeInstanceOf(BodyUnavailable);
    const timedOut = new NatsBodyGateway({
      transport: surveyTransport(new Error('timeout')).transport,
      shard: 'phase0',
    });
    await expect(timedOut.survey(LIFE, INPUT)).rejects.toBeInstanceOf(BodyUnavailable);
  });
});
