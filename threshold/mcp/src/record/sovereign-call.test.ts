import type { SovereignCallPayload } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  SovereignCallRecorder,
  type SovereignCallSink,
  sovereignCallMsgId,
} from './sovereign-call.ts';

const BASE: SovereignCallPayload = {
  player_id: 'ag-jason-01',
  tool: 'act',
  outcome: 'ok',
  accepted: [0],
  rejected: [],
  credits_charged: 1,
  budget_remaining: 9,
  latency_ms: 12,
  thought_id: 'th_01HZX00000000000000000000A',
  say: 'Hello',
} as SovereignCallPayload;

class CollectingSink implements SovereignCallSink {
  readonly published: { msgId: string; payload: SovereignCallPayload }[] = [];

  async publish(msgId: string, payload: SovereignCallPayload): Promise<void> {
    this.published.push({ msgId, payload });
  }
}

describe('sovereign_call record', () => {
  it('derives the Nats-Msg-Id from the thought id', () => {
    expect(sovereignCallMsgId(BASE)).toBe('sovereign_call:th_01HZX00000000000000000000A');
  });

  it('publishes a call that validates, under the derived id', async () => {
    const sink = new CollectingSink();
    await new SovereignCallRecorder(sink).record(BASE);
    expect(sink.published).toEqual([
      { msgId: 'sovereign_call:th_01HZX00000000000000000000A', payload: BASE },
    ]);
  });

  it('gives a call with no plan a fresh id each time', () => {
    const noPlan = { ...BASE, thought_id: undefined } as unknown as SovereignCallPayload;
    expect(sovereignCallMsgId(noPlan)).not.toBe(sovereignCallMsgId(noPlan));
  });

  it('refuses a payload the schema rejects and publishes nothing', async () => {
    const sink = new CollectingSink();
    const bad = { ...BASE, tool: 'teleport' } as unknown as SovereignCallPayload;
    await expect(new SovereignCallRecorder(sink).record(bad)).rejects.toThrow(/schema/);
    expect(sink.published).toHaveLength(0);
  });
});
