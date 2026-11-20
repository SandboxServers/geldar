/**
 * The Body's subscription to the provenance messages (AN-28b). The Body listens on its own core NATS
 * connection to `geldar.<shard>.provenance.break` and `.pickup`, and passes each message that is the
 * right size and shape, and in the Body's own world, to the observers (`observeBreak`, `observeGift`).
 * An observation they return leaves as one `observation` WorldEvent on `geldar.<shard>.observation`.
 *
 * Core NATS is at-most-once: nothing replays a message the Body missed while it was away, and this
 * module never asks for one. A dropped message (oversize, malformed, or a fault) is counted and logged
 * once, with no message content and no player name. Inert until the Body is started with
 * `observations` on (`adam-body.ts`); nothing in production sets it yet.
 */
import {
  type ObservationPayload,
  type ObservedActor,
  provenanceBreakSubject,
  provenancePickupSubject,
  validateProvenance,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { bukkitWorldOf, type OwnerTransport } from '../../body/block-owners.ts';
import { eventIdFor } from '../../body/derived-id.ts';
import type { EventPublisher } from '../../body/records-nats.ts';
import { worldAge } from '../../world-clock.ts';
import { canSeeBlock } from '../notable-blocks.ts';
import { TakeKeyLru } from './container-take.ts';
import { observeGift, type PickupProvenance } from './gift.ts';
import { type BreakProvenance, observeBreak } from './property-break.ts';
import { observedActor } from './visible-actor.ts';

/** A provenance message larger than this is dropped unread. */
export const MAX_PROVENANCE_BYTES = 4096;
const TICKS_PER_DAY = 24_000;

export interface ObservationOptions {
  transport: OwnerTransport;
  shard: string;
  /** The Body's life id: the agent the observation is for, and the Body's own name on the server. */
  lifeId: string;
  /** The Body's username, as the owner and the picker the messages name. */
  selfName: string;
  bot: Bot;
  publisher: EventPublisher;
  /** The visible actor for a name, or null (`observedActor`). */
  resolve: (username: string | undefined) => ObservedActor | null;
  /** Whether the Body can see the cell now (`canSeeBlock` on the bot's block). */
  canSee: (x: number, y: number, z: number) => boolean;
  log: (line: string) => void;
}

export interface ObservationSubscription {
  /** Unsubscribes both subjects. Messages that arrive after this are ignored. */
  stop(): void;
  /** How many messages were dropped, by reason. Counts only: no content. */
  dropped(): { oversize: number; malformed: number; failed: number };
}

type DropReason = 'oversize' | 'malformed' | 'failed';

const decoder = new TextDecoder();

/** The `observation` WorldEvent that carries `payload` to the Mind, or null when the contract refuses it. */
function observationEvent(
  payload: ObservationPayload,
  ctx: ObservationOptions,
  worldTick: number,
): WorldEvent | null {
  const event: WorldEvent = {
    source_event_id: eventIdFor(`observation:${ctx.lifeId}:${payload.key}`),
    at: new Date().toISOString(),
    shard: ctx.shard,
    world_day: Math.floor(worldTick / TICKS_PER_DAY),
    world_tick: worldTick,
    type: 'observation',
    payload: payload as unknown as WorldEvent['payload'],
    agent_id: ctx.lifeId,
  };
  return validateWorldEvent(event).ok ? event : null;
}

/**
 * Starts the Body's provenance subscription. Each message is decoded once; the observers are called only
 * for the Body's own world (`bukkitWorldOf`). Returns the stop function and the drop counters.
 */
export function startObservations(opts: ObservationOptions): ObservationSubscription {
  const drops = { oversize: 0, malformed: 0, failed: 0 };
  const breakSeen = new TakeKeyLru();
  const giftSeen = new Set<string>();
  let stopped = false;

  const drop = (reason: DropReason): void => {
    drops[reason] += 1;
    opts.log(`observation: dropped a provenance message (${reason})`);
  };

  const publish = (payload: ObservationPayload): void => {
    const event = observationEvent(payload, opts, worldAge(opts.bot) ?? 0);
    if (event === null) {
      opts.log('observation: dropped an event the contract refuses');
      return;
    }
    opts.publisher
      .publish(`geldar.${opts.shard}.observation`, JSON.stringify(event), event.source_event_id)
      .catch((error: unknown) => opts.log(`observation event not published: ${String(error)}`));
  };

  const handle = (data: Uint8Array, expected: 'break' | 'pickup'): void => {
    if (data.byteLength > MAX_PROVENANCE_BYTES) {
      drop('oversize');
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(decoder.decode(data));
    } catch {
      drop('malformed');
      return;
    }
    if (!validateProvenance(msg)) {
      drop('malformed');
      return;
    }
    if ((msg as { kind?: unknown }).kind !== expected) {
      drop('malformed');
      return;
    }
    const inWorld = (msg as { world?: unknown }).world === bukkitWorldOf(opts.bot);
    if (expected === 'break') {
      if (!inWorld) return;
      const payload = observeBreak(msg as BreakProvenance, {
        selfName: opts.selfName,
        bot: opts.bot,
        seen: breakSeen,
        resolve: opts.resolve,
        canSee: opts.canSee,
      });
      if (payload !== null) publish(payload);
      return;
    }
    if (!inWorld) return;
    const payload = observeGift(msg as PickupProvenance, {
      selfName: opts.selfName,
      bot: opts.bot,
      seen: giftSeen,
      resolve: opts.resolve,
    });
    if (payload !== null) publish(payload);
  };

  const subscribe = (subject: string, expected: 'break' | 'pickup') =>
    opts.transport.subscribe(subject, {
      callback: (err: unknown, msg: { data: Uint8Array }) => {
        if (stopped) return;
        if (err) return drop('failed');
        try {
          handle(msg.data, expected);
        } catch {
          drop('failed');
        }
      },
    });

  const subscriptions: Array<{ unsubscribe(): void }> = [];
  try {
    subscriptions.push(subscribe(provenanceBreakSubject(opts.shard), 'break'));
    subscriptions.push(subscribe(provenancePickupSubject(opts.shard), 'pickup'));
  } catch (error) {
    for (const sub of subscriptions) sub.unsubscribe();
    throw error;
  }

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const sub of subscriptions) {
        try {
          sub.unsubscribe();
        } catch {
          // The connection may already be closed; nothing is left to undo.
        }
      }
    },
    dropped: () => ({ ...drops }),
  };
}

/**
 * The Body's wiring (AN-28b): its life id is its own name, a visible actor is named through
 * `observedActor`, and a cell is seen when its block is in line of sight (`canSeeBlock`).
 */
export function startBodyObservations(
  opts: Pick<ObservationOptions, 'transport' | 'shard' | 'lifeId' | 'bot' | 'publisher' | 'log'>,
): ObservationSubscription {
  return startObservations({
    ...opts,
    selfName: opts.lifeId,
    resolve: (username) => observedActor(opts.bot, username),
    canSee: (x, y, z) => {
      const block = opts.bot.blockAt(new Vec3(x, y, z));
      return block !== null && canSeeBlock(opts.bot, block);
    },
  });
}
