import {
  type SpeechPayload,
  validateSpeechPayload,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import { eventIdFor } from '../body/derived-id.ts';

/** Ticks in one world day (the `world_day` of an event is the tick divided by this). */
const TICKS_PER_DAY = 24_000;

/** Where a speech event goes: the Body's event publisher. Must not throw. */
export type SpeechPublisher = (event: WorldEvent) => void;

/** What building a `speech` event needs besides the payload. */
export interface SpeechEventContext {
  publish: SpeechPublisher;
  shard: string;
  lifeId?: string;
  /** The world age now; 0 when unknown. */
  worldTick?: () => number;
  now?: () => Date;
  log?: (line: string) => void;
}

/**
 * Builds a `speech` WorldEvent from `payload`, checks both it and the event against the contract, and
 * hands it to the publisher. A payload or event the contract refuses is logged and dropped: this
 * never throws, because a chat line must not stop the Body.
 */
export class SpeechEvents {
  private sequence = 0;

  private readonly ctx: SpeechEventContext;

  constructor(ctx: SpeechEventContext) {
    this.ctx = ctx;
  }

  /** Publishes one speech event. Returns whether it was published. */
  publish(payload: SpeechPayload): boolean {
    const log = this.ctx.log ?? ((line: string) => console.error(line));
    try {
      const tick = this.ctx.worldTick?.() ?? 0;
      const at = (this.ctx.now?.() ?? new Date()).toISOString();
      this.sequence += 1;
      const event: WorldEvent = {
        source_event_id: eventIdFor(
          `speech:${this.ctx.lifeId ?? '-'}:${at}:${this.sequence}:${payload.from}:${payload.text}`,
        ),
        at,
        shard: this.ctx.shard,
        world_day: Math.floor(tick / TICKS_PER_DAY),
        world_tick: tick,
        type: 'speech',
        payload: payload as unknown as WorldEvent['payload'],
      };
      if (this.ctx.lifeId) event.agent_id = this.ctx.lifeId;
      const checked = validateSpeechPayload(payload);
      const whole = validateWorldEvent(event);
      if (!checked.ok || !whole.ok) {
        const errors = [...(checked.ok ? [] : checked.errors), ...(whole.ok ? [] : whole.errors)];
        log(`voice: dropped a speech event: ${errors.join('; ')}`);
        return false;
      }
      this.ctx.publish(event);
      return true;
    } catch (error) {
      log(`voice: dropped a speech event: ${String(error)}`);
      return false;
    }
  }
}
