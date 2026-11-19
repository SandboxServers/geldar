/**
 * The live trigger for the `hurt` event (PX-1). It watches the Body's own `entityHurt` and `health`
 * events, takes the attacker from the damage cause (never from proximity), and passes each loss to a
 * `HurtReporter`. A hurt leaves the Body as a `damage` WorldEvent that carries `source`, `bearing`
 * and `amount` (`hurtWorldEvent`).
 */
import { type ObservedActor, validateWorldEvent, type WorldEvent } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { eventIdFor } from '../body/derived-id.ts';
import type { HurtEvent, HurtReporter } from './hurt.ts';

const TICKS_PER_DAY = 24_000;

interface Point {
  x: number;
  z: number;
}

/** The fields of a mineflayer entity the attacker check reads. */
interface CauseEntity {
  id: number;
  position: { x: number; z: number };
}

/**
 * The attacker behind a hurt, from the server's damage cause: the entity the damage packet names
 * (mineflayer passes it as the second argument of `entityHurt`; for a projectile it is the shooter,
 * for a spit it is the llama). Any type counts, since the server says it caused the damage (an iron
 * golem or a provoked wolf attacks too). Nothing is attributed by proximity: with no cause entity
 * (a fall, fire, drowning, starvation) there is no attacker, whoever stands nearby.
 */
function attackerOf(cause: unknown, selfId: number | undefined): Point | null {
  const entity = cause as CauseEntity | null | undefined;
  if (!entity || entity.id === selfId) return null;
  return { x: entity.position.x, z: entity.position.z };
}

/**
 * The name the hurt log gives the cause: `player` for a player (never its name), else the entity's own
 * name (zombie, skeleton, iron_golem). Undefined when the damage names no entity, or only the Body.
 */
export function attackerNameOf(cause: unknown, selfId: number | undefined): string | undefined {
  const entity = cause as { id?: number; type?: unknown; name?: unknown } | null | undefined;
  if (!entity || entity.id === selfId) return undefined;
  if (entity.type === 'player') return 'player';
  return typeof entity.name === 'string' && entity.name !== '' ? entity.name : undefined;
}

/**
 * Passes each loss of the Body's health to `reporter`, with `tick` as the world age. An `entityHurt` on
 * the Body sets the attacker for the next health drop only; a drop with no such event, or with a cause
 * that names no entity other than the Body, is a hurt with no known cause (`other`, no bearing). Returns
 * the detach function.
 */
/**
 * The username of the player behind a hurt, when the cause is a player other than the Body. A mob or
 * no cause has none, so a nearby player is never named for it (AN-25).
 */
function actorUsernameOf(cause: unknown, selfId: number | undefined): string | undefined {
  const entity = cause as { id?: number; type?: unknown; username?: unknown } | null | undefined;
  if (!entity || entity.id === selfId || entity.type !== 'player') return undefined;
  return typeof entity.username === 'string' ? entity.username : undefined;
}

/**
 * `resolve` (AN-25, optional) turns a cause's username into a visible actor, or null. It is called
 * once per `entityHurt` on the Body; nobody passes it yet, so a hurt carries no actor.
 */
export function watchHurts(
  bot: Bot,
  reporter: HurtReporter,
  tick: () => number,
  resolve?: (username: string | undefined) => ObservedActor | null,
): () => void {
  let health: number | undefined = bot.health;
  let pending: {
    attacker: Point | null;
    name: string | undefined;
    actor: ObservedActor | undefined;
  } | null = null;
  const onEntityHurt = (entity: unknown, cause?: unknown): void => {
    if (entity !== bot.entity) return;
    pending = {
      attacker: attackerOf(cause, bot.entity?.id),
      name: attackerNameOf(cause, bot.entity?.id),
      actor: resolve?.(actorUsernameOf(cause, bot.entity?.id)) ?? undefined,
    };
  };
  const onHealth = (): void => {
    const before = health;
    const now = bot.health;
    health = now;
    const attack = pending;
    pending = null;
    const self = bot.entity;
    if (before === undefined || now === undefined || now >= before || self === undefined) return;
    reporter.report(
      {
        cause: attack?.attacker ? 'ENTITY_ATTACK' : undefined,
        attacker: attack?.attacker ?? null,
        attackerName: attack?.name,
        actor: attack?.actor,
        self: { x: self.position.x, z: self.position.z, yaw: self.yaw },
        healthBefore: before,
        rawDamage: before - now,
      },
      tick(),
    );
  };
  bot.on('entityHurt', onEntityHurt);
  bot.on('health', onHealth);
  return () => {
    bot.off('entityHurt', onEntityHurt);
    bot.off('health', onHealth);
  };
}

/** What a hurt needs besides the event itself. */
export interface HurtEventContext {
  shard: string;
  lifeId: string;
  /** World age in ticks. */
  worldTick: number;
  /** Wall-clock time, ISO 8601. */
  at: string;
  /** A counter the caller keeps, so two hurts in one tick get different ids. */
  sequence: number;
}

/** The `damage` WorldEvent that carries `hurt` to the Mind, or null when the contract refuses it. */
export function hurtWorldEvent(hurt: HurtEvent, ctx: HurtEventContext): WorldEvent | null {
  const payload: Record<string, unknown> = { source: hurt.source, amount: hurt.amount };
  if (hurt.bearing !== undefined) payload.bearing = hurt.bearing;
  if (hurt.actor !== undefined) payload.actor = hurt.actor;
  const event: WorldEvent = {
    source_event_id: eventIdFor(`hurt:${ctx.lifeId}:${ctx.at}:${ctx.sequence}`),
    at: ctx.at,
    shard: ctx.shard,
    world_day: Math.floor(ctx.worldTick / TICKS_PER_DAY),
    world_tick: ctx.worldTick,
    type: 'damage',
    payload: payload as WorldEvent['payload'],
    agent_id: ctx.lifeId,
  };
  return validateWorldEvent(event).ok ? event : null;
}
