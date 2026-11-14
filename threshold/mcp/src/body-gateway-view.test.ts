import type { RequestTransport } from '@geldar/player-core/src/link/nats-body-link.ts';
import { viewSubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { NatsBodyGateway } from './body-gateway.ts';
import { BodyUnavailable } from './ports.ts';

const LIFE = 'ag_jason_01';

/** A transport that records each request and answers with `reply`, or fails with it when it is an Error. */
function gateway(reply: string | Error) {
  const sent: Array<{ subject: string; body: string }> = [];
  const transport = {
    async request(subject: string, body: string): Promise<string> {
      sent.push({ subject, body });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  const gw = new NatsBodyGateway({
    transport: transport as unknown as RequestTransport,
    shard: 'phase0',
  });
  return { gw, sent };
}

describe('NatsBodyGateway.view', () => {
  it('sends the size to the life view subject and returns the Body text', async () => {
    const { gw, sent } = gateway('{"text":"Facing north."}');
    expect(await gw.view(LIFE, { cols: 21, rows: 9 })).toEqual({ text: 'Facing north.' });
    expect(sent).toEqual([{ subject: viewSubject('phase0', LIFE), body: '{"cols":21,"rows":9}' }]);
  });

  it('sends an empty size when none is named', async () => {
    const { gw, sent } = gateway('{"text":"x"}');
    await gw.view(LIFE, {});
    expect(sent[0]?.body).toBe('{}');
  });

  it('returns the Body refusal as data, not as a failure', async () => {
    const { gw } = gateway('{"error":"unavailable"}');
    expect(await gw.view(LIFE, {})).toEqual({ error: 'unavailable' });
  });

  it('rejects with BodyUnavailable on an invalid reply, an extra key or a bad JSON', async () => {
    for (const reply of ['{"text":"x","grid":[]}', '{"text":7}', 'not json']) {
      const { gw } = gateway(reply);
      await expect(gw.view(LIFE, {})).rejects.toBeInstanceOf(BodyUnavailable);
    }
  });

  it('rejects with BodyUnavailable when the request times out', async () => {
    const { gw } = gateway(new Error('timeout'));
    await expect(gw.view(LIFE, {})).rejects.toBeInstanceOf(BodyUnavailable);
  });
});
