/**
 * The recipient's view of a gift (AN-26b): a pickup the Body made of items another player threw. When
 * the Body is the picker, the thrower is named only if the Body can see that player now and the toss
 * landed within reach; a hidden thrower leaves the gift unattributed, and its key says `none`. A
 * pickup by anyone else, the Body's own toss, a stale drop, or a far visible thrower teaches nothing.
 * Nothing here names a player who is out of sight. Paper-only in behaviour; do not enable on NeoForge
 * until the human-handling question is decided.
 */
import {
  type ObservationPayload,
  type ObservedActor,
  type Provenance,
  validateObservationPayload,
} from '@geldar/contract';
import type { Bot } from 'mineflayer';

/** The pickup member of the Provenance union (AN-24). */
export type PickupProvenance = Extract<Provenance, { kind: 'pickup' }>;

/** The reach a give has (`GIVE_REACH` in actions/give.ts), plus the slack the card allows. */
const GIVE_REACH = 3;
const MAX_TOSS_DISTANCE = GIVE_REACH + 3;
/** 5 s at 20 TPS (`PICKUP_WAIT_MS` in actions/give.ts): an older drop is not a gift. */
const MAX_AGE_TICKS = 100;
/** The contract's bounds, checked before any lookup. */
const MAX_COUNT = 2304;
const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const ITEM = /^[a-z0-9_]{1,64}$/;
const SEEN_LIMIT = 256;

export interface GiftContext {
  selfName: string;
  bot: Bot;
  /** Keys already observed, insertion-ordered; the oldest is dropped past 256. */
  seen: Set<string>;
  /** The visible thrower for a name, or null when the name is not visible. */
  resolve: (u: string | undefined) => ObservedActor | null;
}

/** Whether every field is the kind a server sends, inside the contract's bounds. */
function wellFormed(msg: PickupProvenance): boolean {
  const distanceOk =
    msg.distance === null ||
    (typeof msg.distance === 'number' && Number.isFinite(msg.distance) && msg.distance >= 0);
  const thrower =
    msg.thrower === null || (typeof msg.thrower === 'string' && USERNAME.test(msg.thrower));
  return (
    typeof msg.world === 'string' &&
    msg.world.length > 0 &&
    typeof msg.picker === 'string' &&
    USERNAME.test(msg.picker) &&
    thrower &&
    typeof msg.item === 'string' &&
    ITEM.test(msg.item) &&
    Number.isInteger(msg.count) &&
    msg.count >= 1 &&
    msg.count <= MAX_COUNT &&
    Number.isInteger(msg.age_ticks) &&
    msg.age_ticks >= 0 &&
    msg.age_ticks <= MAX_AGE_TICKS &&
    distanceOk &&
    Number.isInteger(msg.tick) &&
    msg.tick >= 0
  );
}

/** The thrower as the Body may name them: null when there is none or the resolver cannot be trusted. */
function visibleThrower(
  msg: PickupProvenance,
  ctx: GiftContext,
): { actor: ObservedActor | null } | null {
  try {
    return { actor: ctx.resolve(msg.thrower ?? undefined) };
  } catch {
    return null;
  }
}

/**
 * The `gift_received` observation for a pickup the Body made, or null. Null when the Body is not the
 * picker, when the message is malformed or hostile (a Body's own toss, a name that is not a username),
 * when the drop is older than 100 ticks, when a visible thrower's toss landed out of reach or has no
 * distance, when the resolver throws, or when the key was already observed.
 */
export function observeGift(msg: PickupProvenance, ctx: GiftContext): ObservationPayload | null {
  if (msg.picker !== ctx.selfName) return null;
  if (!wellFormed(msg)) return null;
  if (msg.thrower !== null && msg.thrower.toLowerCase() === msg.picker.toLowerCase()) return null;
  const resolved = visibleThrower(msg, ctx);
  if (resolved === null) return null;
  const { actor } = resolved;
  if (actor !== null && (msg.distance === null || msg.distance > MAX_TOSS_DISTANCE)) return null;

  const who = actor?.name ?? 'none';
  const prefix = `gift:${msg.tick}:${who}:${msg.item}:`.toLowerCase();
  let ordinal = 0;
  for (const key of ctx.seen) if (key.startsWith(prefix)) ordinal++;
  const key = `${prefix}${msg.count}:${ordinal}`.toLowerCase();

  const payload: ObservationPayload = {
    kind: 'gift_received',
    ...(actor ? { actor } : {}),
    item: msg.item,
    count: msg.count,
    key,
  };
  // The contract has the last word (key shape and length, count, item); a refused gift takes no slot.
  if (!validateObservationPayload(payload)) return null;
  if (ctx.seen.has(key)) return null;
  ctx.seen.add(key);
  while (ctx.seen.size > SEEN_LIMIT) {
    const oldest = ctx.seen.values().next().value;
    if (oldest === undefined) break;
    ctx.seen.delete(oldest);
  }
  return payload;
}
