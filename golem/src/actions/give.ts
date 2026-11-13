import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { canSeePoint } from '../perception/notable-blocks.ts';
import { findVisibleAgent } from '../perception/visible-agent.ts';
import { STEP_BACK_BELOW, STEP_BACK_TO, stepBackSpots } from './give-spot.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The `give` action as the contract types it. */
type GiveAction = Extract<Action, { do: 'give' }>;
type Entity = Bot['entities'][string];

/** The recipient must be this close (blocks) when the items are tossed. */
export const GIVE_REACH = 3;
/** The pitch (radians) the Body looks down at when it tosses: 30 degrees down. Positive is up. */
export const TOSS_PITCH = -Math.PI / 6;
/** The steeper pitch (radians): 40 degrees down, for a recipient level or lower and under STEEP_GAP out. */
const STEEP_TOSS_PITCH = (-40 * Math.PI) / 180;
/** Level or lower, a recipient closer than this (blocks, horizontal) gets STEEP_TOSS_PITCH. */
const STEEP_GAP = 1.75;
/** A recipient this far up (blocks, feet) is too high to toss to from beyond TALL_MAX_GAP. */
const TALL_RISE = 1.5;
/** The horizontal gap (blocks) beyond which a recipient TALL_RISE or more up cannot be tossed to. */
const TALL_MAX_GAP = 2;

/**
 * The pitch (radians, positive is up) the Body tosses at, given how far the recipient's feet are
 * above the Body's (`dy`, blocks) and how far out it stands (`d`, blocks). Level or lower it is
 * `TOSS_PITCH`, or 40 degrees down under 1.75 blocks out (sweep: P 1.00 against 0.82 at -30). One
 * block up, a 30-degree throw hits the step's face, so it goes up: 65 degrees at
 * 1.5 blocks, 45 at 3 (a straight line in between, clamped). Two or more blocks up it is 60 degrees
 * out to 2 blocks and 50 beyond. Any rise from 0 to 1.5 uses the one-block pitch, which only whole
 * blocks were simulated for. Simulated with vanilla constants (see the report): at dy 1 these
 * pitches reach the recipient's pickup box with P 0.87 to 1.00 and clear the step; at dy 2 the
 * chance falls to 0.24 at 3 blocks.
 */
export function tossPitch(dy: number, d: number): number {
  if (dy <= 0) return d < STEEP_GAP ? STEEP_TOSS_PITCH : TOSS_PITCH;
  if (dy < 1.5) {
    const reach = Math.min(Math.max(d, 1.5), 3);
    return ((65 - ((reach - 1.5) * 40) / 3) * Math.PI) / 180;
  }
  return ((d <= 2 ? 60 : 50) * Math.PI) / 180;
}
/** The Body walks up to this close (blocks) to the recipient first. */
const WALK_RANGE = 2;
/**
 * Wall-clock wait for the recipient to pick the tossed items up, scaled by `timeScale`. A player's
 * toss waits 40 ticks (2 s) before anyone may collect it, then the items must travel to the
 * recipient, so the wait is 5 s, not the 3 s a collection after the toss could take.
 */
export const PICKUP_WAIT_MS = 5_000;
/** How often the wait checks for pickups and for an abort. */
const POLL_MS = 25;
/** Item entities further than this (blocks) from the Body are not the ones it tossed. */
const DROP_RANGE = 8;
/** How close (blocks) the Body walks to a tossed item to take it back. */
const TAKE_BACK_RANGE = 1;
/** How close (blocks) the Body walks to the spot it steps back to. */
const STEP_RANGE = 0.5;
/** The most wall time (ms at timeScale 1) the step back takes over all its tries. */
const STEP_BACK_MS = 3_000;

/** The one text for a recipient the agent cannot see. It never says whether the name exists. */
export const NOT_IN_SIGHT = 'no such agent in sight';

/**
 * The item entities one toss created, and the items picked up since: by the recipient, by the Body,
 * or by another player (`others`, item id to that player's name). `stacks` is the item count each
 * entity held when it spawned, and `collected` the items the recipient took from each one. Vanilla
 * merges nearby stacks on the ground: a merged-away entity vanishes with no pickup (`gone`), and its
 * items are in the stack that survives, so the items are counted, not the entities.
 */
interface PickupWatch {
  dropped: Set<number>;
  stacks: Map<number, number>;
  gone: Set<number>;
  collected: Map<number, number>;
  taken: Set<number>;
  others: Map<number, string>;
  stop(): void;
}

/** The items an item entity holds (its stack), or one when its metadata gives no stack. */
function itemsIn(entity: Entity): number {
  return entity.getDroppedItem?.()?.count ?? 1;
}

/**
 * Listens for the item entities a toss creates near the Body, and for pickups of them by the
 * recipient and by the Body itself. It must be started before the toss, so no spawn is missed.
 * A pickup by the recipient counts the collect packet's `pickupItemCount` when the client reports
 * one, else the items the entity holds when it is collected.
 */
function watchPickup(bot: Bot, to: string): PickupWatch {
  const dropped = new Set<number>();
  const stacks = new Map<number, number>();
  const gone = new Set<number>();
  const collected = new Map<number, number>();
  const taken = new Set<number>();
  const others = new Map<number, string>();
  const packetCounts = new Map<number, number>();
  const onDrop = (entity: Entity): void => {
    if (entity.name !== 'item') return;
    if (entity.position.distanceTo(bot.entity.position) > DROP_RANGE) return;
    dropped.add(entity.id);
    stacks.set(entity.id, itemsIn(entity));
  };
  const onGone = (entity: Entity): void => {
    if (dropped.has(entity.id)) gone.add(entity.id);
  };
  const onCollect = (collector: Entity, item: Entity): void => {
    if (!dropped.has(item.id)) return;
    if (collector.username === to) {
      collected.set(item.id, packetCounts.get(item.id) ?? itemsIn(item));
    } else if (collector === bot.entity) taken.add(item.id);
    else if (collector.username) others.set(item.id, collector.username);
  };
  // The collect packet reaches this listener before mineflayer emits playerCollect for it.
  const onPacket = (packet: { collectedEntityId: number; pickupItemCount?: number }): void => {
    if (packet.pickupItemCount !== undefined) {
      packetCounts.set(packet.collectedEntityId, packet.pickupItemCount);
    }
  };
  const client: Bot['_client'] | undefined = bot._client;
  bot.on('entitySpawn', onDrop);
  bot.on('itemDrop', onDrop);
  bot.on('entityGone', onGone);
  bot.on('playerCollect', onCollect);
  client?.prependListener('collect', onPacket);
  return {
    dropped,
    stacks,
    gone,
    collected,
    taken,
    others,
    stop: () => {
      bot.removeListener('entitySpawn', onDrop);
      bot.removeListener('itemDrop', onDrop);
      bot.removeListener('entityGone', onGone);
      bot.removeListener('playerCollect', onCollect);
      client?.removeListener('collect', onPacket);
    },
  };
}

/** The items the recipient collected. */
function pickedItems(watch: PickupWatch): number {
  return [...watch.collected.values()].reduce((sum, count) => sum + count, 0);
}

/** The items the toss created: the stacks that spawned. */
function tossedItems(watch: PickupWatch): number {
  return [...watch.dropped].reduce((sum, id) => sum + (watch.stacks.get(id) ?? 1), 0);
}

/** Every tossed item has been picked up by the recipient. */
function allPicked(watch: PickupWatch): boolean {
  return watch.dropped.size > 0 && pickedItems(watch) >= tossedItems(watch);
}

/** Waits until `done()` holds, the wait runs out, or the run aborts. */
async function awaitUntil(done: () => boolean, signal: AbortSignal, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (!signal.aborted && Date.now() < deadline && !done()) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** The distance (blocks) between two points, counting only the x and z axes. */
function horizontalGap(a: Entity['position'], b: Entity['position']): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Steps the Body back to `STEP_BACK_TO` blocks from a recipient closer than `STEP_BACK_BELOW`, so
 * the toss flies past them. It walks to the straight-back spot first, then to the first of the
 * turned spots (`stepBackSpots`) that it reaches, and stops trying after `STEP_BACK_MS` (scaled by
 * `timeScale`) or on an abort. When none is reached the Body is where it was; the caller checks
 * the distance it ends at.
 */
async function stepBackFrom(
  ctx: ActionContext,
  bot: Bot,
  recipient: Entity['position'],
): Promise<void> {
  const spots = stepBackSpots(bot.entity.position, recipient, STEP_BACK_TO);
  // One signal for every try: the run's abort, or the whole-step cap, stops the walk in progress.
  const tries = new AbortController();
  const stop = (): void => tries.abort();
  ctx.signal.addEventListener('abort', stop, { once: true });
  const cap = setTimeout(stop, STEP_BACK_MS * ctx.timeScale);
  try {
    for (const spot of spots) {
      if (tries.signal.aborted) return;
      const move = await moveNear(bot, spot, STEP_RANGE, {
        signal: tries.signal,
        timeScale: ctx.timeScale,
      });
      if (move.ok) return;
    }
  } finally {
    clearTimeout(cap);
    ctx.signal.removeEventListener('abort', stop);
  }
}

/**
 * Walks to each tossed item the recipient did not pick up and waits for the Body to collect it.
 * An item the Body already collected counts as taken back, with no walk. True when the Body took
 * every one back. An abort or a walk that fails leaves them on the ground.
 */
async function takeBack(ctx: ActionContext, bot: Bot, watch: PickupWatch): Promise<boolean> {
  // Only the entities that still exist: a merged-away or vanished one has no position to walk to.
  const missing = [...watch.dropped].filter(
    (id) => !watch.collected.has(id) && !watch.others.has(id) && !watch.gone.has(id),
  );
  if (missing.length === 0) return false;
  const everyTaken = () => missing.every((id) => watch.taken.has(id));
  for (const id of missing) {
    if (watch.taken.has(id)) continue;
    const item = bot.entities[id];
    if (!item) return false;
    const move = await moveNear(bot, item.position, TAKE_BACK_RANGE, {
      signal: ctx.signal,
      timeScale: ctx.timeScale,
    });
    if (!move.ok) return false;
  }
  await awaitUntil(everyTaken, ctx.signal, PICKUP_WAIT_MS * ctx.timeScale);
  return !ctx.signal.aborted && everyTaken();
}

/**
 * Who else picked items up, as the agent can see them now: the names in sight, and whether anyone
 * out of sight did. A name is said only when the agent can see that player (decision 0145).
 */
function bystanders(bot: Bot, watch: PickupWatch): { names: string; unseen: boolean } {
  const all = [...new Set(watch.others.values())];
  const seen = all.filter((name) => findVisibleAgent(bot, name) !== null);
  return { names: seen.join(', '), unseen: seen.length < all.length };
}

/** The text when no item stayed on the ground and none was the recipient's or the Body's. */
function wentToOthers(bot: Bot, watch: PickupWatch): string {
  const { names, unseen } = bystanders(bot, watch);
  if (names === '') return 'someone else picked the items up';
  const went = `the items went to ${names}`;
  return unseen ? `${went}; someone else picked the items up` : went;
}

/** The part after "N of M were picked up" when other players took the rest. */
function restWentToOthers(bot: Bot, watch: PickupWatch): string {
  const { names, unseen } = bystanders(bot, watch);
  if (names === '') return 'someone else picked up the rest';
  const went = `the rest went to ${names}`;
  return unseen ? `${went}; someone else picked up the rest` : went;
}

/** The outcome once the toss has run and the wait is over. */
async function settle(
  ctx: ActionContext,
  bot: Bot,
  action: GiveAction,
  watch: PickupWatch,
): Promise<ActionOutcome> {
  if (watch.dropped.size === 0) {
    return failed('interrupted', 'the tossed items were not seen on the ground');
  }
  const total = tossedItems(watch);
  const picked = pickedItems(watch);
  if (picked >= total) return completed({ to: action.to, item: action.item, count: action.count });
  // Only the entities that still exist: not the recipient's, the Body's, another's or merged away.
  const onGround = [...watch.dropped].filter(
    (id) =>
      !watch.collected.has(id) &&
      !watch.others.has(id) &&
      !watch.taken.has(id) &&
      !watch.gone.has(id),
  );
  const partial = `${picked} of ${total} were picked up`;
  if (watch.others.size > 0 && onGround.length === 0) {
    if (picked === 0) return failed('not_possible', wentToOthers(bot, watch));
    return failed('not_possible', `${partial}; ${restWentToOthers(bot, watch)}`);
  }
  const took = await takeBack(ctx, bot, watch);
  if (ctx.signal.aborted) return cancelled();
  if (took) {
    if (picked === 0) {
      return failed('not_possible', `${action.to} did not pick the items up; you took them back`);
    }
    return failed('not_possible', `${partial}; you took the rest back`);
  }
  if (picked === 0) return failed('not_possible', `the items are on the ground near ${action.to}`);
  return failed('not_possible', `${partial}; the rest are on the ground`);
}

/**
 * Hands items to a nearby agent by tossing them toward it, so it can pick them up (there is no
 * trade window: spec 5.x item transfer). The recipient is resolved only among the players the
 * agent sees now (`findVisibleAgent`), never by a lookup of the name in the server's player list,
 * so the verb cannot probe whether a player exists or where they are (decisions 0058 and 0068).
 * A name that is not in sight fails `not_found` with one fixed text. The Body walks up to
 * `WALK_RANGE` blocks from the recipient, checks again that it is in sight and within
 * `GIVE_REACH`, steps back to `STEP_BACK_TO` blocks if the recipient is closer than
 * `STEP_BACK_BELOW` (and fails if it is still that close), faces the recipient at about 0.9 of
 * its height, looks at the `tossPitch` for the height difference and distance, waits two ticks for
 * the look to reach the server, and tosses.
 * The give completes only when the
 * recipient picks up every tossed item within `PICKUP_WAIT_MS`. When the recipient picks up none,
 * the Body takes the items back and says so; if it cannot, it says where the items are, with no
 * advice. Receipts for economic operations are a later packet.
 */
export const giveAction: ActionHandler<'give'> = {
  kind: 'give',
  timeoutMs: 30_000,
  async run(ctx: ActionContext, action: GiveAction): Promise<ActionOutcome> {
    const { bot } = ctx;
    const first = findVisibleAgent(bot, action.to);
    if (!first) return failed('not_found', NOT_IN_SIGHT);

    const info = bot.registry.itemsByName?.[action.item];
    const held = bot.inventory
      .items()
      .filter((stack) => stack.name === action.item)
      .reduce((sum, stack) => sum + stack.count, 0);
    if (!info || held < action.count) {
      return failed('not_possible', `not holding ${action.count} ${action.item}`);
    }

    if (first.distance > GIVE_REACH) {
      const move = await moveNear(bot, first.position, WALK_RANGE, {
        signal: ctx.signal,
        timeScale: ctx.timeScale,
      });
      if (!move.ok) return outcomeOfMove(move);
    }
    if (ctx.signal.aborted) return cancelled();

    // The agent may have moved or turned out of sight while walking: resolve again, from scratch.
    let target = findVisibleAgent(bot, action.to);
    if (!target) return failed('not_found', NOT_IN_SIGHT);
    if (target.distance > GIVE_REACH) return failed('out_of_reach', 'too far from the agent');

    if (target.distance < STEP_BACK_BELOW) {
      await stepBackFrom(ctx, bot, target.position);
      if (ctx.signal.aborted) return cancelled();
      target = findVisibleAgent(bot, action.to);
      if (!target) return failed('not_found', NOT_IN_SIGHT);
      if (target.distance > GIVE_REACH) return failed('out_of_reach', 'too far from the agent');
      // A toss from this close lands in the Body's own pickup box, so it is not thrown.
      if (horizontalGap(bot.entity.position, target.position) < STEP_BACK_BELOW)
        return failed('not_possible', 'too close to toss, and no room to step back');
    }
    // Too high to throw to from beyond the step's reach: a toss from there lands short (simulated).
    const rise = target.position.y - bot.entity.position.y;
    if (rise >= TALL_RISE && horizontalGap(bot.entity.position, target.position) > TALL_MAX_GAP) {
      return failed('not_possible', 'too far up to toss to');
    }
    // Glass lets the recipient be seen, but a toss stops at it: any block shape in the line blocks.
    const middle = target.position.offset(0, target.height / 2, 0);
    if (!canSeePoint(bot, middle, { solidOnly: true })) {
      return failed('blocked', 'something is in the way of the toss');
    }

    const watch = watchPickup(bot, action.to);
    try {
      // Aim at about the recipient's middle, not its feet, so the toss carries past the Body.
      await bot.lookAt(target.position.offset(0, target.height * 0.9, 0), true);
      const pitch = tossPitch(rise, horizontalGap(bot.entity.position, target.position));
      await bot.look(bot.entity.yaw, pitch, true);
      // The look reaches the server on the next tick; tossing before then throws the old look.
      await bot.waitForTicks(2);
      if (ctx.signal.aborted) return cancelled();
      await bot.toss(info.id, null, action.count);
      await awaitUntil(() => allPicked(watch), ctx.signal, PICKUP_WAIT_MS * ctx.timeScale);
      if (ctx.signal.aborted) return cancelled();
      return await settle(ctx, bot, action, watch);
    } catch (error) {
      return failed('interrupted', errorText(error));
    } finally {
      watch.stop();
    }
  },
};
