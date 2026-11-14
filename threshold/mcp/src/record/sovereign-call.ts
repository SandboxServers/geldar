/**
 * The `sovereign_call` event: one per MCP tool call (spec 5.7, 5.15.3). The payload is checked
 * against the contract schema before it leaves, and carries only the player's own words and
 * reasoning, never world text. The event is a WorldEvent envelope (contract event.schema.json): the
 * eventsink refuses a bare payload. The NATS message id is derived from the thought id, and the
 * envelope's source_event_id is derived from that message id, so a redelivered event dedups in the
 * stream and in Postgres.
 */

import { createHash } from 'node:crypto';
import {
  type SovereignCallPayload,
  validateSovereignCallPayload,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import { newId } from '@geldar/player-core/src/ids.ts';
import type { CallRecorder } from '../ports.ts';
import type { WorldStamp } from './world-clock.ts';

/** Publishes one validated WorldEvent envelope under its message id. */
export interface SovereignCallSink {
  publish(msgId: string, event: WorldEvent): Promise<void>;
}

/** What the recorder needs: the sink, the shard, the world clock and a drop report. */
export interface SovereignCallRecorderOptions {
  sink: SovereignCallSink;
  shard: string;
  clock: { latest(): WorldStamp | undefined };
  /** Told why an audit was not published. The tool call still succeeds. */
  drop: (reason: string) => void;
  /** Milliseconds since the epoch for `at`; the clock by default. */
  now?: () => number;
}

/**
 * The `Nats-Msg-Id` for a call: `sovereign_call:<thought_id>` when the call sent a plan, else a
 * fresh id (a call with no plan has nothing to dedup against).
 */
export function sovereignCallMsgId(call: SovereignCallPayload): string {
  return call.thought_id === undefined ? newId('ev') : `sovereign_call:${call.thought_id}`;
}

/** Crockford base32, the alphabet of the contract's ids. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The envelope's `source_event_id` (`ev_` plus 26 Crockford characters): the first 130 bits of the
 * SHA-256 of the message id. The same message id always gives the same id.
 */
export function envelopeIdFor(msgId: string): string {
  const digest = createHash('sha256').update(msgId).digest();
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const byte of digest) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      bits -= 5;
      out += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return `ev_${out}`;
}

/**
 * Records each call through the sink as a WorldEvent envelope. A call whose audit cannot be built
 * (the payload or the envelope fails the contract, or no world clock has been seen yet) is dropped
 * and reported; it never throws, so the audit never fails the agent's call.
 */
export class SovereignCallRecorder implements CallRecorder {
  private readonly options: SovereignCallRecorderOptions;

  constructor(options: SovereignCallRecorderOptions) {
    this.options = options;
  }

  async record(call: SovereignCallPayload): Promise<void> {
    const checked = validateSovereignCallPayload(call);
    if (!checked.ok) {
      this.options.drop('sovereign_call payload failed the contract schema');
      return;
    }
    const world = this.options.clock.latest();
    if (world === undefined) {
      this.options.drop('sovereign_call has no world clock yet');
      return;
    }
    const msgId = sovereignCallMsgId(call);
    const now = this.options.now ?? Date.now;
    const envelope = {
      source_event_id: envelopeIdFor(msgId),
      at: new Date(now()).toISOString(),
      shard: this.options.shard,
      world_day: world.world_day,
      world_tick: world.world_tick,
      type: 'sovereign_call',
      payload: call,
    };
    const valid = validateWorldEvent(envelope);
    if (!valid.ok) {
      this.options.drop(`sovereign_call envelope failed the contract: ${valid.errors.join('; ')}`);
      return;
    }
    await this.options.sink.publish(msgId, valid.value);
  }
}
