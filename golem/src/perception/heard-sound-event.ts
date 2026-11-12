/**
 * The `heard_sound` WorldEvent the Body publishes for a heard sound (PX-4, decision 0154 ruling 3). The
 * payload is the HeardSound the sounds watcher built: a kind, a compass point and a band. The envelope
 * carries no coordinates either. A WorldEvent that fails the contract is not built (null).
 */
import { validateWorldEvent, type WorldEvent } from '@geldar/contract';
import { eventIdFor } from '../body/derived-id.ts';
import type { HeardSound } from './sounds.ts';

const TICKS_PER_DAY = 24_000;

export interface HeardSoundContext {
  shard: string;
  lifeId: string;
  /** The world tick the sound was heard at. */
  tick: number;
  at: Date;
  /** The count of sounds this Body has heard, so each source_event_id is distinct. */
  seq: number;
}

/** The `heard_sound` WorldEvent for one heard sound, or null when the envelope fails the contract. */
export function heardSoundEvent(sound: HeardSound, ctx: HeardSoundContext): WorldEvent | null {
  const event: WorldEvent = {
    source_event_id: eventIdFor(`heard_sound:${ctx.lifeId}:${ctx.tick}:${ctx.seq}`),
    at: ctx.at.toISOString(),
    shard: ctx.shard,
    world_day: Math.floor(ctx.tick / TICKS_PER_DAY),
    world_tick: ctx.tick,
    type: 'heard_sound',
    agent_id: ctx.lifeId,
    payload: { ...sound } as WorldEvent['payload'],
  };
  return validateWorldEvent(event).ok ? event : null;
}
