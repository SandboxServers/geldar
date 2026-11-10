import { planOf, snapshotOf } from '@geldar/animus/src/link/link.fixtures.ts';
import type { RequestTransport } from '@geldar/animus/src/link/nats-body-link.ts';
import { BodyLinkError } from '@geldar/animus/src/ports/index.ts';
import { describe, expect, it } from 'vitest';
import { BOOK_TIMEOUT_MS, NatsBodyGateway } from './body-gateway.ts';
import { BodyUnavailable } from './ports.ts';

const SHARD = 'phase0';
const LIFE = 'ag_jason_01';
const SUBJECT = (kind: string) => `geldar.${SHARD}.body.${LIFE}.${kind}`;

/** A transport that records each request and answers with a script. */
class ScriptedTransport implements RequestTransport {
  readonly calls: { subject: string; body: string; timeoutMs: number }[] = [];
  reply: (subject: string) => string = () => '';
  fail: Error | null = null;

  async request(subject: string, body: string, timeoutMs: number): Promise<string> {
    this.calls.push({ subject, body, timeoutMs });
    if (this.fail !== null) throw this.fail;
    return this.reply(subject);
  }
}

const BOOK_OK = JSON.stringify({ status: 'ok', title: 'Log', author: 'Ann', text: 'dear diary' });

function gateway(transport: ScriptedTransport): NatsBodyGateway {
  return new NatsBodyGateway({ transport, shard: SHARD });
}

describe('NatsBodyGateway', () => {
  it('asks the snapshot subject and returns a valid snapshot for the life', async () => {
    const transport = new ScriptedTransport();
    transport.reply = () => JSON.stringify(snapshotOf(1, LIFE));
    const snap = await gateway(transport).snapshot(LIFE);
    expect(snap.agent_id).toBe(LIFE);
    expect(transport.calls[0]?.subject).toBe(SUBJECT('snapshot'));
  });

  it('refuses a snapshot that is for another life', async () => {
    const transport = new ScriptedTransport();
    transport.reply = () => JSON.stringify(snapshotOf(1, 'ag_billy_01'));
    await expect(gateway(transport).snapshot(LIFE)).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('sends the plan to the plan subject and returns the acknowledgement', async () => {
    const transport = new ScriptedTransport();
    const plan = planOf(1);
    transport.reply = () =>
      JSON.stringify({ thought_id: plan.thought_id, accepted: true, rejection: null });
    const ack = await gateway(transport).submitPlan(LIFE, plan);
    expect(ack.accepted).toBe(true);
    expect(transport.calls[0]?.subject).toBe(SUBJECT('plan'));
  });

  it('asks the book subject with the life id and the 5 s window', async () => {
    const transport = new ScriptedTransport();
    transport.reply = () => BOOK_OK;
    const book = await gateway(transport).book(LIFE);
    expect(book).toEqual({ status: 'ok', title: 'Log', author: 'Ann', text: 'dear diary' });
    expect(transport.calls[0]).toEqual({
      subject: SUBJECT('book'),
      body: JSON.stringify({ life_id: LIFE }),
      timeoutMs: BOOK_TIMEOUT_MS,
    });
    expect(BOOK_TIMEOUT_MS).toBe(5_000);
  });

  it('refuses a book reply with an extra field or a text over the contract limit', async () => {
    const extra = new ScriptedTransport();
    extra.reply = () => JSON.stringify({ status: 'ok', title: '', author: '', text: '', x: 1 });
    await expect(gateway(extra).book(LIFE)).rejects.toBeInstanceOf(BodyUnavailable);

    const long = new ScriptedTransport();
    long.reply = () =>
      JSON.stringify({ status: 'ok', title: '', author: '', text: 'x'.repeat(8193) });
    await expect(gateway(long).book(LIFE)).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('refuses a reply that is not JSON or not the contract shape', async () => {
    const transport = new ScriptedTransport();
    transport.reply = () => '{not json';
    await expect(gateway(transport).book(LIFE)).rejects.toBeInstanceOf(BodyUnavailable);
    transport.reply = () => '{}';
    await expect(gateway(transport).snapshot(LIFE)).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('maps a timeout or a missing responder to BodyUnavailable', async () => {
    const transport = new ScriptedTransport();
    transport.fail = new BodyLinkError('timeout', 'no reply');
    await expect(gateway(transport).snapshot(LIFE)).rejects.toBeInstanceOf(BodyUnavailable);
    transport.fail = new BodyLinkError('unavailable', 'nobody serves');
    await expect(gateway(transport).book(LIFE)).rejects.toBeInstanceOf(BodyUnavailable);
  });

  it('refuses a life id that the subject builder rejects, before any request', async () => {
    const transport = new ScriptedTransport();
    await expect(gateway(transport).book('ag_x.*')).rejects.toBeInstanceOf(BodyUnavailable);
    expect(transport.calls).toHaveLength(0);
  });

  it('asks only the snapshot, plan and book subjects of the contract', async () => {
    const transport = new ScriptedTransport();
    const plan = planOf(1);
    transport.reply = (subject) =>
      subject.endsWith('.book')
        ? BOOK_OK
        : subject.endsWith('.plan')
          ? JSON.stringify({ thought_id: plan.thought_id, accepted: true, rejection: null })
          : JSON.stringify(snapshotOf(1, LIFE));
    const g = gateway(transport);
    await g.snapshot(LIFE);
    await g.submitPlan(LIFE, plan);
    await g.book(LIFE);
    expect(new Set(transport.calls.map((c) => c.subject))).toEqual(
      new Set([SUBJECT('snapshot'), SUBJECT('plan'), SUBJECT('book')]),
    );
  });
});
