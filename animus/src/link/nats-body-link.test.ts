import { planSubject, snapshotSubject } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { BodyLinkError } from '../ports/index.ts';
import { idOf, LIFE, planOf, SHARD, snapshotOf } from './link.fixtures.ts';
import { NatsBodyLink, type RequestTransport } from './nats-body-link.ts';

interface Sent {
  subject: string;
  body: string;
  timeoutMs: number;
}

function rig(answer: (sent: Sent) => string | Error) {
  const sent: Sent[] = [];
  const transport: RequestTransport = {
    async request(subject, body, timeoutMs) {
      const call = { subject, body, timeoutMs };
      sent.push(call);
      const out = answer(call);
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return { sent, link: new NatsBodyLink({ transport, shard: SHARD, lifeId: LIFE }) };
}

async function failure(promise: Promise<unknown>): Promise<BodyLinkError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BodyLinkError) return error;
    throw error;
  }
  throw new Error('expected a BodyLinkError');
}

describe('NatsBodyLink.requestSnapshot', () => {
  it('asks on the snapshot subject with a 5 s timeout and returns the validated snapshot', async () => {
    const { link, sent } = rig(() => JSON.stringify(snapshotOf(3)));
    const snapshot = await link.requestSnapshot('wake');
    expect(snapshot.revision).toBe(3);
    expect(sent[0]?.subject).toBe(snapshotSubject(SHARD, LIFE));
    expect(sent[0]?.timeoutMs).toBe(5000);
    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual({ life_id: LIFE, reason: 'wake' });
  });

  it('cuts the reason to 64 characters', async () => {
    const { link, sent } = rig(() => JSON.stringify(snapshotOf()));
    await link.requestSnapshot('x'.repeat(100));
    expect(JSON.parse(sent[0]?.body ?? '{}').reason).toHaveLength(64);
  });

  it('turns a reply that fails the contract into invalid_reply', async () => {
    const bad = { ...snapshotOf(), revision: 'one' };
    const error = await failure(rig(() => JSON.stringify(bad)).link.requestSnapshot('wake'));
    expect(error.code).toBe('invalid_reply');
  });

  it('turns text that is not JSON into invalid_reply', async () => {
    const error = await failure(rig(() => '<html>').link.requestSnapshot('wake'));
    expect(error.code).toBe('invalid_reply');
  });

  it('refuses a snapshot of another life', async () => {
    const other = JSON.stringify(snapshotOf(1, 'ag_eve_01'));
    const error = await failure(rig(() => other).link.requestSnapshot('wake'));
    expect(error.code).toBe('invalid_reply');
  });

  it('passes a timeout and an unavailable Body through as typed errors', async () => {
    const timeout = new BodyLinkError('timeout', 'slow');
    expect((await failure(rig(() => timeout).link.requestSnapshot('wake'))).code).toBe('timeout');
    const gone = rig(() => new Error('connection closed'));
    expect((await failure(gone.link.requestSnapshot('wake'))).code).toBe('unavailable');
  });
});

describe('NatsBodyLink.submitPlan', () => {
  const ack = (id: string, accepted = true) =>
    JSON.stringify({
      thought_id: id,
      accepted,
      rejection: accepted ? null : { reason: 'expired', detail: 'late' },
    });

  it('sends the plan on the plan subject and returns the ack, a refusal included', async () => {
    const plan = planOf(1);
    const { link, sent } = rig(() => ack(plan.thought_id, false));
    const result = await link.submitPlan(plan);
    expect(result.accepted).toBe(false);
    expect(result.rejection?.reason).toBe('expired');
    expect(sent[0]?.subject).toBe(planSubject(SHARD, LIFE));
    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual(plan);
  });

  it('turns an invalid ack and an ack for another thought into invalid_reply', async () => {
    const plan = planOf(1);
    const broken = JSON.stringify({ thought_id: plan.thought_id, accepted: 'yes' });
    expect((await failure(rig(() => broken).link.submitPlan(plan))).code).toBe('invalid_reply');
    const wrong = ack(idOf('th', 9));
    expect((await failure(rig(() => wrong).link.submitPlan(plan))).code).toBe('invalid_reply');
  });

  it('rejects with a typed error when the transport fails', async () => {
    const down = rig(() => new Error('no responders'));
    expect((await failure(down.link.submitPlan(planOf(1)))).code).toBe('unavailable');
  });
});
