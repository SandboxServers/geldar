import { viewImageSubject } from '@geldar/contract';
import type { RequestTransport } from '@geldar/player-core/src/link/nats-body-link.ts';
import { describe, expect, it } from 'vitest';
import { NatsBodyGateway } from './body-gateway.ts';
import { BodyUnavailable } from './ports.ts';

const LIFE = 'ag_jason_01';
const PNG = 'iVBORw0KGgo=';
const SEE_TIMEOUT = 5_000;

/** A transport that records each request (with its timeout) and answers with `reply`, or fails with it. */
function gateway(reply: string | Error) {
  const sent: Array<{ subject: string; body: string; timeout: number | undefined }> = [];
  const transport = {
    async request(subject: string, body: string, timeout?: number): Promise<string> {
      sent.push({ subject, body, timeout });
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

describe('NatsBodyGateway.see', () => {
  it('sends the size to the life image subject with the 5 s timeout and returns the picture', async () => {
    const { gw, sent } = gateway(JSON.stringify({ png: PNG, caption: 'x' }));
    expect(await gw.see(LIFE, { width: 320, height: 180 })).toEqual({ png: PNG });
    expect(sent).toEqual([
      {
        subject: viewImageSubject('phase0', LIFE),
        body: '{"width":320,"height":180}',
        timeout: SEE_TIMEOUT,
      },
    ]);
  });

  it('sends an empty size when none is named', async () => {
    const { gw, sent } = gateway(JSON.stringify({ png: PNG, caption: 'x' }));
    await gw.see(LIFE, {});
    expect(sent[0]?.body).toBe('{}');
  });

  it('returns a typed refusal as data, with its detail, not as a failure', async () => {
    const { gw } = gateway('{"error":"view_unavailable","detail":"rate_limited"}');
    expect(await gw.see(LIFE, {})).toEqual({ error: 'view_unavailable', detail: 'rate_limited' });
  });

  it('rejects with BodyUnavailable on an invalid reply, an extra key or a bad JSON', async () => {
    const replies = [
      '{"png":"iVBORw0KGgo="}',
      '{"png":"","caption":"x"}',
      '{"png":"iVBORw0KGgo=","caption":"x","grid":[]}',
      '{"png":7,"caption":"x"}',
      'not json',
    ];
    for (const reply of replies) {
      const { gw } = gateway(reply);
      await expect(gw.see(LIFE, {})).rejects.toBeInstanceOf(BodyUnavailable);
    }
  });

  it('rejects with BodyUnavailable when the request times out', async () => {
    const { gw } = gateway(new Error('timeout'));
    await expect(gw.see(LIFE, {})).rejects.toBeInstanceOf(BodyUnavailable);
  });
});
