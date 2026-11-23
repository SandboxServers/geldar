import type { RequestTransport } from '@geldar/player-core/src/link/nats-body-link.ts';
import { describe, expect, it } from 'vitest';
import { NatsBodyGateway } from './body-gateway.ts';
import { BodyUnavailable } from './ports.ts';

const PLAN = { plan: { palette: { stone: { block: 'stone' } }, steps: [] } };
const CHECK = {
  cells: 0,
  material_needs: {},
  unknown_cells: 0,
  estimated_ticks: 0,
  invalid_steps: [],
};

/** A transport that answers with `reply` (or throws it) and records each request. */
function transportAnswering(reply: string | Error) {
  const sent: { subject: string; body: string; timeoutMs: number }[] = [];
  const transport = {
    request: async (subject: string, body: string, timeoutMs: number) => {
      sent.push({ subject, body, timeoutMs });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  } as unknown as RequestTransport;
  return { transport, sent };
}

describe('NatsBodyGateway.planCheck', () => {
  it('sends the plan on the plan_check subject of the life and returns the Body check', async () => {
    const { transport, sent } = transportAnswering(JSON.stringify(CHECK));
    const gateway = new NatsBodyGateway({ transport, shard: 'phase0' });
    expect(await gateway.planCheck('ag_ada_01', PLAN)).toEqual(CHECK);
    expect(sent).toEqual([
      {
        subject: 'geldar.phase0.body.ag_ada_01.plan_check',
        body: JSON.stringify(PLAN),
        timeoutMs: 5_000,
      },
    ]);
  });

  it('returns the Body plan_too_large refusal as data', async () => {
    const { transport } = transportAnswering(JSON.stringify({ error: 'plan_too_large' }));
    const gateway = new NatsBodyGateway({ transport, shard: 'phase0' });
    expect(await gateway.planCheck('ag_ada_01', PLAN)).toEqual({ error: 'plan_too_large' });
  });

  it('fails closed with BodyUnavailable on the flag-off not_available reply', async () => {
    const { transport } = transportAnswering(JSON.stringify({ error: 'not_available' }));
    const gateway = new NatsBodyGateway({ transport, shard: 'phase0' });
    await expect(gateway.planCheck('ag_ada_01', PLAN)).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('fails closed with BodyUnavailable on a reply that is not JSON', async () => {
    const { transport } = transportAnswering('not json');
    const gateway = new NatsBodyGateway({ transport, shard: 'phase0' });
    await expect(gateway.planCheck('ag_ada_01', PLAN)).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('fails closed with BodyUnavailable when the request times out', async () => {
    const { transport } = transportAnswering(new Error('timeout'));
    const gateway = new NatsBodyGateway({ transport, shard: 'phase0' });
    await expect(gateway.planCheck('ag_ada_01', PLAN)).rejects.toBeInstanceOf(BodyUnavailable);
  });
});
