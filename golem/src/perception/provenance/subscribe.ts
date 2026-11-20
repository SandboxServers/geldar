/**
 * The Body's subscription to the provenance messages (AN-28b, AN-50b). The Body listens on its own core NATS
 * connection to `geldar.<shard>.provenance.break`, `.pickup`, `.take` and `.combat`, and passes each message
 * that is the right size and shape, and in the Body's own world, to the observers (`observeBreak`,
 * `observeGift`, `observeTake`, `observeFight`). An observation they return leaves as one `observation`
 * WorldEvent on `geldar.<shard>.observation`.
 *
 * Core NATS is at-most-once: nothing replays a message the Body missed while it was away, and this
 * module never asks for one. A dropped message (oversize, malformed, or a fault) is counted and logged
 * once, with no message content and no player name. Take and combat are dated on the world age: with no
 * age known they are not observed. Inert until the Body is started with `observations` on
 * (`adam-body.ts`); nothing in production sets it yet.
 */
import {
  type ObservationPayload,
  type ObservedActor,
  provenanceBreakSubject,
  provenanceCombatSubject,
  provenancePickupSubject,
  provenanceTakeSubject,
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
import { observeTake, TakeKeyLru, type TakeProvenance } from './container-take.ts';
import { type CombatProvenance, FightWindows, observeFight } from './fight-seen.ts';
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
  /** Unsubscribes all four subjects. Messages that arrive after this are ignored. */
  stop(): void;
  /** How many messages were dropped, by reason. Counts only: no content. */
  dropped(): { oversize: number; malformed: number; failed: number };
}

type DropReason = 'oversize' | 'malformed' | 'failed';
type Channel = 'break' | 'pickup' | 'take' | 'combat';

const decoder = new TextDecoder();

/**
 * Whether a message is the record its subject carries. The take record has no `kind`; a combat record is
 * `engaged` or `killed`; a break and a pickup carry their own kind. Any other pairing is malformed.
 */
function carries(channel: Channel, msg: unknown): boolean {
  const kind = (msg as { kind?: unknown }).kind;
  if (channel === 'take') return kind === undefined;
  if (channel === 'combat') return kind === 'engaged' || kind === 'killed';
  return kind === channel;
}

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
 * for the Body's own world (`bukkitWorldOf`). Returns the stop function and the drop counters. Dedupe
 * state (the take keys, the break and gift keys, the fight windows) lives in this subscription, so a new
 * subscription starts with none.
 */
export function startObservations(opts: ObservationOptions): ObservationSubscription {
  const drops = { oversize: 0, malformed: 0, failed: 0 };
  const breakSeen = new TakeKeyLru();
  const giftSeen = new Set<string>();
  const takeSeen = new TakeKeyLru();
  const fightWindows = new FightWindows();
  let stopped = false;

  const drop = (reason: DropReason): void => {
    drops[reason] += 1;
    opts.log(`observation: dropped a provenance message (${reason})`);
  };

  const publish = (payload: ObservationPayload, worldTick: number): void => {
    const event = observationEvent(payload, opts, worldTick);
    if (event === null) {
      opts.log('observation: dropped an event the contract refuses');
      return;
    }
    opts.publisher
      .publish(`geldar.${opts.shard}.observation`, JSON.stringify(event), event.source_event_id)
      .catch((error: unknown) => opts.log(`observation event not published: ${String(error)}`));
  };

  const handle = (data: Uint8Array, channel: Channel): void => {
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
    if (!validateProvenance(msg) || !carries(channel, msg)) {
      drop('malformed');
      return;
    }
    const here = bukkitWorldOf(opts.bot);
    if ((msg as { world?: unknown }).world !== here) return;
    const now = worldAge(opts.bot);
    if (channel === 'break') {
      const payload = observeBreak(msg as BreakProvenance, {
        selfName: opts.selfName,
        bot: opts.bot,
        seen: breakSeen,
        resolve: opts.resolve,
        canSee: opts.canSee,
      });
      if (payload !== null) publish(payload, now ?? 0);
      return;
    }
    if (channel === 'pickup') {
      const payload = observeGift(msg as PickupProvenance, {
        selfName: opts.selfName,
        bot: opts.bot,
        seen: giftSeen,
        resolve: opts.resolve,
      });
      if (payload !== null) publish(payload, now ?? 0);
      return;
    }
    // A take and a fight are dated on the world age: with no age known, neither is observed.
    if (now === null) return;
    const payload =
      channel === 'take'
        ? observeTake(msg as TakeProvenance, {
            bot: opts.bot,
            tick: now,
            self: opts.selfName,
            seen: takeSeen,
          })
        : observeFight(msg as CombatProvenance, {
            bot: opts.bot,
            tick: now,
            self: opts.selfName,
            ...(here === null ? {} : { world: here }),
            windows: fightWindows,
            resolve: opts.resolve,
          });
    if (payload !== null) publish(payload, now);
  };

  const subscribe = (subject: string, channel: Channel) =>
    opts.transport.subscribe(subject, {
      callback: (err: unknown, msg: { data: Uint8Array }) => {
        if (stopped) return;
        if (err) return drop('failed');
        try {
          handle(msg.data, channel);
        } catch {
          drop('failed');
        }
      },
    });

  const channels: Array<[string, Channel]> = [
    [provenanceBreakSubject(opts.shard), 'break'],
    [provenancePickupSubject(opts.shard), 'pickup'],
    [provenanceTakeSubject(opts.shard), 'take'],
    [provenanceCombatSubject(opts.shard), 'combat'],
  ];
  const subscriptions: Array<{ unsubscribe(): void }> = [];
  try {
    for (const [subject, channel] of channels) subscriptions.push(subscribe(subject, channel));
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
