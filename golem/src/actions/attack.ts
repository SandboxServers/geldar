import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { ItemStack } from './mine.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import { pickUpDrops, pickupNote } from './pickup.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

/** The entity type Mineflayer hands out in `bot.entities`. */
type Entity = Bot['entities'][string];

/** Weapons the Body wields, best first. The fight-or-flee reflex arms itself from the same list. */
export const WEAPONS = [
  'netherite_sword',
  'diamond_sword',
  'iron_sword',
  'stone_sword',
  'golden_sword',
  'wooden_sword',
  'netherite_axe',
  'diamond_axe',
  'iron_axe',
  'stone_axe',
  'golden_axe',
  'wooden_axe',
];

/** Closer than this (blocks) the bot swings; farther it walks up first. Survival reach is 3. */
const REACH = 2.8;
/** The walk stops this close to the target (blocks). */
const APPROACH_RANGE = 2;
/** World ticks between swings: a sword's attack cooldown is 12.5 ticks. */
const SWING_TICKS = 13;
/** Most swings one action makes before giving up. */
const MAX_SWINGS = 80;
/** Most loop passes (approaches and swings together), so a walk that never closes in ends too. */
const MAX_STEPS = 200;
/** Stall limit for each approach, in world ticks: a target that moves is re-aimed often. */
const APPROACH_STALL_TICKS = 60;
/** Mobs that fly: the attack never paths to them (a walk to an airborne point fails), it waits for them. */
const FLYING_MOBS = new Set(['phantom', 'bat']);
/** Longest wait, in world ticks (10 s), for a flying target to come within reach before the attack gives up. */
const FLYER_WAIT_TICKS = 200;
/** One wait between two looks at a flying target, in world ticks. */
const FLYER_POLL_TICKS = 2;
/** At most one attack_diag line per bot in this many wall ms (2 s), whatever the call rate (decision 0335). */
export const ATTACK_DIAG_INTERVAL_MS = 2_000;
/** The last attack_diag line time per bot object (one bot per Body connection). */
const lastAttackDiagAt = new WeakMap<Bot, number>();

/** True for a flying mob (phantom, bat): an attack on it stands still and waits, it does not walk. */
export function isFlyingMob(name: string): boolean {
  return FLYING_MOBS.has(name);
}

/** The nearest entity of that mob name or player name, other than the bot. Null when none is loaded. */
export function findTarget(bot: Bot, name: string): Entity | null {
  const here = bot.entity.position;
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || entity.isValid === false) continue;
    if (entity.name !== name && entity.username !== name) continue;
    const distance = entity.position.distanceTo(here);
    if (distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best;
}

/** The best weapon the bot carries, or null. */
export function bestWeapon(bot: Bot): ReturnType<Bot['inventory']['items']>[number] | null {
  const items = bot.inventory.items();
  for (const name of WEAPONS) {
    const found = items.find((stack) => stack.name === name);
    if (found) return found;
  }
  return null;
}

/**
 * Fights the nearest entity with that mob or player name: equips the best weapon it carries (bare
 * hands otherwise), walks up to the target and swings until the target is gone. It uses Mineflayer's
 * own `bot.attack`, one swing per attack cooldown. A target that is not loaded is `not_found`.
 */
export const attackAction: ActionHandler<'attack'> = {
  kind: 'attack',
  timeoutMs: 30_000,
  async run(ctx: ActionContext, action): Promise<ActionOutcome> {
    const { bot, signal } = ctx;
    const name = action.target;
    const first = findTarget(bot, name);
    if (!first) return failed('not_found', `no ${name} in view`);
    const start = bot.inventory.items();
    let lastAt = first.position.clone();

    const weapon = bestWeapon(bot);
    if (weapon && bot.heldItem?.name !== weapon.name) {
      try {
        await bot.equip(weapon, 'hand');
      } catch (error) {
        return failed('interrupted', `could not equip ${weapon.name}: ${errorText(error)}`);
      }
    }
    const armed = weapon?.name ?? null;
    const targetKind = targetKindOf(first);
    attackDiag(bot, name, first, targetKind);

    let swings = 0;
    // World ticks spent out of reach of a flying target since it was last in reach.
    let idle = 0;
    for (let step = 0; step < MAX_STEPS && swings < MAX_SWINGS; step++) {
      if (signal.aborted) return cancelled({ target: name, swings });
      const entity = bot.entities[first.id];
      if (!entity || entity.isValid === false) {
        return afterKill(ctx, {
          target: name,
          swings,
          weapon: armed,
          at: lastAt,
          start,
          targetKind,
        });
      }
      lastAt = entity.position.clone();
      if (entity.position.distanceTo(bot.entity.position) > REACH) {
        if (isFlyingMob(name)) {
          if (idle >= FLYER_WAIT_TICKS) {
            return failed('out_of_reach', `the ${name} was not within reach`, {
              target: name,
              swings,
            });
          }
          idle += FLYER_POLL_TICKS;
          await bot.waitForTicks(FLYER_POLL_TICKS);
          continue;
        }
        const move = await moveNear(bot, entity.position, APPROACH_RANGE, {
          digTier: false,
          signal,
          timeScale: ctx.timeScale,
          stallTicks: APPROACH_STALL_TICKS,
        });
        if (!move.ok) return outcomeOfMove(move, { target: name, swings });
        continue;
      }
      idle = 0;
      await bot.lookAt(entity.position.offset(0, (entity.height ?? 1) * 0.9, 0), true);
      bot.attack(entity);
      swings += 1;
      await bot.waitForTicks(SWING_TICKS);
    }
    return failed('timeout', `${name} still alive after ${swings} swings`, {
      target: name,
      swings,
    });
  },
};

/**
 * Operator diagnostic (decision 0335): the entity the swings are aimed at and how far it stands now.
 * One line per bot per ATTACK_DIAG_INTERVAL_MS; a call inside that window writes nothing.
 */
function attackDiag(bot: Bot, name: string, first: Entity, targetKind: TargetKind): void {
  const now = DEFAULT_DIAG_SINK.now();
  const last = lastAttackDiagAt.get(bot);
  if (last !== undefined && now - last < ATTACK_DIAG_INTERVAL_MS) return;
  lastAttackDiagAt.set(bot, now);
  DEFAULT_DIAG_SINK.log(
    JSON.stringify({
      event: 'attack_diag',
      target: name,
      entity: first.name ?? null,
      distance: Math.round(first.position.distanceTo(bot.entity.position) * 10) / 10,
      target_kind: targetKind,
    }),
  );
}

/** Whether the target is a player or any other mob. Mineflayer marks players with type `player`. */
export type TargetKind = 'player' | 'mob';

/** A player entity is `player`; every other entity the attack can reach is a `mob`. */
export function targetKindOf(entity: Entity): TargetKind {
  return entity.type === 'player' ? 'player' : 'mob';
}

/** What a kill leaves for the pickup: where the target was last seen, and the inventory before. */
interface KillRecord {
  target: string;
  swings: number;
  weapon: string | null;
  at: Vec3;
  start: ItemStack[];
  targetKind: TargetKind;
}

/**
 * After a kill, takes the drops near where the target died. The outcome says in plain words what
 * was picked up, or that drops were left. An abort during the pickup cancels the action.
 */
async function afterKill(ctx: ActionContext, kill: KillRecord): Promise<ActionOutcome> {
  const { target, swings, weapon, at, start, targetKind } = kill;
  const pickup = await pickUpDrops(ctx, at, start);
  if (pickup.aborted) return cancelled({ target, swings, killed: true, picked: pickup.picked });
  const note = pickupNote(pickup);
  return completed({
    target,
    target_kind: targetKind,
    swings,
    killed: true,
    weapon,
    picked: pickup.picked,
    ...(note ? { note } : {}),
  });
}
