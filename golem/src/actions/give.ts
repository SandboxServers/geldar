import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { canTossTo } from '../perception/body-sight.ts';
import { findVisibleAgent, isUsernameVisible } from '../perception/visible-agent.ts';
import { logNotInSight } from './give-not-in-sight.ts';
import {
  allPicked,
  awaitUntil,
  type PickupWatch,
  pickedItems,
  tossedItems,
  watchPickup,
} from './give-pickup.ts';
import { STEP_BACK_BELOW, STEP_BACK_DISTANCES, stepBackCells, TOSS_MIN_GAP } from './give-spot.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

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
/** How close (blocks) the Body walks to a tossed item to take it back. */
const TAKE_BACK_RANGE = 1;
/** The walks the Body tries to reach a tossed item to take it back: the first, and one more. */
const TAKE_BACK_WALKS = 2;
/** How close (blocks) the Body walks to the spot it steps back to. */
const STEP_RANGE = 0.5;
/** The most wall time (ms at timeScale 1) the step back takes over all its tries. */
const STEP_BACK_MS = 3_000;

/** The one text for a recipient the agent cannot see. It never says whether the name exists. */
export const NOT_IN_SIGHT = 'no such agent in sight';

/** The refusal for a recipient not in sight, with its operator-only diag line (never shown to the agent). */
function notInSight(bot: Bot, to: string): ActionOutcome {
  logNotInSight(bot, to);
  return failed('not_found', NOT_IN_SIGHT);
}

/** The distance (blocks) between two points, counting only the x and z axes. */
function horizontalGap(a: Entity['position'], b: Entity['position']): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Steps the Body back from a recipient closer than `STEP_BACK_BELOW`, so the toss flies past them.
 * It walks, with digging off, to the standable blocks `stepBackCells` lists in order (the
 * straight-back one first), and a try counts only when the gap to the recipient then holds at
 * `STEP_BACK_BELOW`. It stops after `STEP_BACK_MS` (scaled by `timeScale`) or on an abort. Returns
 * null when a try held or the run was aborted; otherwise the fact of what blocked it (no standable
 * cell in reach, or no walk reached one), which the give's refusal states. The caller checks the gap
 * it ends at.
 */
async function stepBackFrom(
  ctx: ActionContext,
  bot: Bot,
  recipient: Entity['position'],
): Promise<string | null> {
  const cells = stepBackCells(
    bot.entity.position,
    recipient,
    (cell) => bot.blockAt(cell),
    GIVE_REACH,
  );
  if (cells.length === 0) {
    return `no standable cell within ${Math.max(...STEP_BACK_DISTANCES)} blocks to step back to`;
  }
  // One signal for every try: the run's abort, or the whole-step cap, stops the walk in progress.
  const tries = new AbortController();
  const stop = (): void => tries.abort();
  ctx.signal.addEventListener('abort', stop, { once: true });
  const cap = setTimeout(stop, STEP_BACK_MS * ctx.timeScale);
  let tried = 0;
  try {
    for (const cell of cells) {
      if (tries.signal.aborted) break;
      tried += 1;
      // A short level walk never digs. A walk that reports ok may still leave the Body where it was,
      // so the gap to the recipient decides whether the try counted, not the walk's result.
      await moveNear(bot, cell, STEP_RANGE, {
        signal: tries.signal,
        timeScale: ctx.timeScale,
        digTier: false,
      });
      if (horizontalGap(bot.entity.position, recipient) >= STEP_BACK_BELOW) return null;
    }
    if (ctx.signal.aborted) return null;
    const gap = Math.round(horizontalGap(bot.entity.position, recipient) * 100) / 100;
    DEFAULT_DIAG_SINK.log(JSON.stringify({ event: 'give_stepback_failed', tried, gap }));
    return `the Body could not walk to any of ${tried} standable cells to step back to`;
  } finally {
    clearTimeout(cap);
    ctx.signal.removeEventListener('abort', stop);
  }
}

/**
 * Walks to one tossed item and reaches it, with one more walk when the first fails. Null when the
 * Body reached it; otherwise the fact that stopped it. An item no longer in view gets no walk.
 */
async function walkToItem(ctx: ActionContext, bot: Bot, id: number): Promise<string | null> {
  for (let attempt = 0; attempt < TAKE_BACK_WALKS; attempt++) {
    const item = bot.entities[id];
    if (!item) return 'the item is no longer in view';
    const move = await moveNear(bot, item.position, TAKE_BACK_RANGE, {
      signal: ctx.signal,
      timeScale: ctx.timeScale,
    });
    if (move.ok) return null;
  }
  return 'the Body could not walk to the item';
}

/**
 * Walks to each tossed item the recipient did not pick up and waits for the Body to collect it.
 * An item the Body already collected counts as taken back, with no walk. Null when the Body took
 * every one back; otherwise the fact that stopped it. An abort leaves them on the ground.
 */
async function takeBack(ctx: ActionContext, bot: Bot, watch: PickupWatch): Promise<string | null> {
  // Only the entities that still exist: a merged-away or vanished one has no position to walk to.
  const missing = [...watch.dropped].filter(
    (id) => !watch.collected.has(id) && !watch.others.has(id) && !watch.gone.has(id),
  );
  if (missing.length === 0) return 'no tossed item was left to take back';
  const everyTaken = () => missing.every((id) => watch.taken.has(id));
  for (const id of missing) {
    if (watch.taken.has(id)) continue;
    const why = await walkToItem(ctx, bot, id);
    if (why !== null) return why;
  }
  await awaitUntil(everyTaken, ctx.signal, PICKUP_WAIT_MS * ctx.timeScale);
  if (ctx.signal.aborted) return 'the run was cancelled';
  return everyTaken() ? null : 'the Body did not collect them within the wait';
}

/**
 * Who else picked items up, as the agent can see them now: the names in sight, and whether anyone
 * out of sight did. A name is said only when the agent can see that exact username (decision 0145);
 * a loose name (a handle or display name) never counts, so an unseen player is not named because a
 * visible agent shares their handle.
 */
function bystanders(bot: Bot, watch: PickupWatch): { names: string; unseen: boolean } {
  const all = [...new Set(watch.others.values())];
  const seen = all.filter((name) => isUsernameVisible(bot, name));
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
  if (total === 0) return failed('not_possible', 'the tossed items left the ground with no pickup');
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
  const why = await takeBack(ctx, bot, watch);
  if (ctx.signal.aborted) return cancelled();
  watch.takeBackWhy = why ?? 'taken back';
  if (why === null) {
    if (picked === 0) {
      return failed('not_possible', `${action.to} did not pick the items up; you took them back`);
    }
    return failed('not_possible', `${partial}; you took the rest back`);
  }
  if (picked === 0) return failed('not_possible', `the items are on the ground near ${action.to}`);
  return failed('not_possible', `${partial}; the rest are on the ground`);
}

/** The diag line for a failed give: the reason, and how many items were claimed and rejected. */
function logFailure(outcome: Extract<ActionOutcome, { status: 'failed' }>, watch?: PickupWatch) {
  try {
    DEFAULT_DIAG_SINK.log(
      JSON.stringify({
        event: 'give_failed',
        reason: outcome.reason,
        message: outcome.message,
        claimed: watch?.dropped.size ?? 0,
        unclaimed: watch?.rejected.size ?? 0,
        take_back: watch?.takeBackWhy ?? null,
      }),
    );
  } catch {
    // A diag line that cannot be written never changes the give's outcome.
  }
}

/**
 * Hands items to a nearby agent by tossing them toward it, so it can pick them up (there is no
 * trade window: spec 5.x item transfer). The recipient is resolved only among the players the
 * agent sees now (`findVisibleAgent`), never by a lookup of the name in the server's player list,
 * so the verb cannot probe whether a player exists or where they are (decisions 0058 and 0068).
 * A name that is not in sight fails `not_found` with one fixed text. The Body walks up to
 * `WALK_RANGE` blocks from the recipient, checks again that it is in sight and within
 * `GIVE_REACH`, and when it is closer than `STEP_BACK_BELOW` steps back to a standable block 2 to 3
 * blocks from the recipient. It fails when it is still closer than `TOSS_MIN_GAP` after that, faces
 * the recipient at about 0.9 of its height, looks at the `tossPitch` for the height difference and
 * distance, waits two ticks for the look to reach the server, and tosses.
 * The give completes only when the recipient picks up every tossed item within `PICKUP_WAIT_MS`. When
 * the recipient picks up none, the Body takes the items back and says so; if it cannot, it says where
 * the items are, with no advice. A failed give logs one diag line with its reason and claim counts.
 * Receipts for economic operations are a later packet.
 */
export const giveAction: ActionHandler<'give'> = {
  kind: 'give',
  timeoutMs: 30_000,
  async run(ctx: ActionContext, action: GiveAction): Promise<ActionOutcome> {
    const probe: { watch?: PickupWatch } = {};
    const outcome = await tossTo(ctx, action, probe);
    if (outcome.status === 'failed') logFailure(outcome, probe.watch);
    return outcome;
  },
};

/** The give itself: the checks, the walk, the toss and the wait. `probe.watch` is set once the watch starts. */
async function tossTo(
  ctx: ActionContext,
  action: GiveAction,
  probe: { watch?: PickupWatch },
): Promise<ActionOutcome> {
  const { bot } = ctx;
  const first = findVisibleAgent(bot, action.to);
  if (!first) return notInSight(bot, action.to);
  // Resolved once: the walk and the checks after it follow this username, so a second agent that
  // later matches the same loose name cannot change who the give is for.
  const pinned = first.username;

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

  // The agent may have moved or turned out of sight while walking: resolve the pinned username again.
  let target = findVisibleAgent(bot, pinned);
  if (!target) return notInSight(bot, action.to);
  if (target.distance > GIVE_REACH) return failed('out_of_reach', 'too far from the agent');

  if (target.distance < STEP_BACK_BELOW) {
    const stuck = await stepBackFrom(ctx, bot, target.position);
    if (ctx.signal.aborted) return cancelled();
    target = findVisibleAgent(bot, pinned);
    if (!target) return notInSight(bot, action.to);
    if (target.distance > GIVE_REACH) return failed('out_of_reach', 'too far from the agent');
    // A toss closer than TOSS_MIN_GAP lands in the Body's own pickup box, so it is not thrown.
    if (horizontalGap(bot.entity.position, target.position) < TOSS_MIN_GAP)
      return failed(
        'not_possible',
        `too close to toss, and ${stuck ?? 'the Body is still too close to step back'}`,
      );
  }
  // Too high to throw to from beyond the step's reach: a toss from there lands short (simulated).
  const rise = target.position.y - bot.entity.position.y;
  if (rise >= TALL_RISE && horizontalGap(bot.entity.position, target.position) > TALL_MAX_GAP) {
    return failed('not_possible', 'too far up to toss to');
  }
  // Glass lets the recipient be seen, but a toss stops at it: any block shape in the line blocks.
  if (!canTossTo(bot, target.position, target.height)) {
    return failed('blocked', 'something is in the way of the toss');
  }

  // The pickup watch counts the recipient by the username resolved, which a loose name differs from.
  const watch = watchPickup(bot, target.username, action.item);
  probe.watch = watch;
  try {
    // Aim at about the recipient's middle, not its feet, so the toss carries past the Body.
    await bot.lookAt(target.position.offset(0, target.height * 0.9, 0), true);
    const pitch = tossPitch(rise, horizontalGap(bot.entity.position, target.position));
    await bot.look(bot.entity.yaw, pitch, true);
    // The look reaches the server on the next tick; tossing before then throws the old look.
    await bot.waitForTicks(2);
    if (ctx.signal.aborted) return cancelled();
    watch.arm(bot.entity.position);
    await bot.toss(info.id, null, action.count);
    await awaitUntil(() => allPicked(watch), ctx.signal, PICKUP_WAIT_MS * ctx.timeScale);
    if (ctx.signal.aborted) return cancelled();
    return await settle(ctx, bot, action, watch);
  } catch (error) {
    return failed('interrupted', errorText(error));
  } finally {
    watch.stop();
  }
}
