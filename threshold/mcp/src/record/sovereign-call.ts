/**
 * The `sovereign_call` event: one per MCP tool call (spec 5.7, 5.15.3). The payload is checked
 * against the contract schema before it leaves, and carries only the player's own words and
 * reasoning, never world text. The NATS message id is derived from the thought id, so a
 * redelivered event dedups in the stream.
 */

import { newId } from '@geldar/animus/src/ids.ts';
import { type SovereignCallPayload, validateSovereignCallPayload } from '@geldar/contract';
import type { CallRecorder } from '../ports.ts';

/** Publishes one validated payload under its message id. WM-11 wires this to NATS. */
export interface SovereignCallSink {
  publish(msgId: string, payload: SovereignCallPayload): Promise<void>;
}

/**
 * The `Nats-Msg-Id` for a call: `sovereign_call:<thought_id>` when the call sent a plan, else a
 * fresh id (a call with no plan has nothing to dedup against).
 */
export function sovereignCallMsgId(call: SovereignCallPayload): string {
  return call.thought_id === undefined ? newId('ev') : `sovereign_call:${call.thought_id}`;
}

/** Records each call through the sink. A payload the schema refuses is never published. */
export class SovereignCallRecorder implements CallRecorder {
  private readonly sink: SovereignCallSink;

  constructor(sink: SovereignCallSink) {
    this.sink = sink;
  }

  async record(call: SovereignCallPayload): Promise<void> {
    const checked = validateSovereignCallPayload(call);
    if (!checked.ok) throw new Error('sovereign_call payload failed the contract schema');
    await this.sink.publish(sovereignCallMsgId(call), call);
  }
}
