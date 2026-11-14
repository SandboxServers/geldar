/**
 * The live trigger for the `hurt` event (PX-1). It watches the Body's own `entityHurt` and `health`
 * events, takes the attacker from the damage cause (never from proximity), and passes each loss to a `HurtReporter`. A hurt
 * leaves the Body as a `damage` WorldEvent that carries `source`, `bearing` and `amount` (`hurtWorldEvent`).
 */
import { validateWorldEvent, type WorldEvent } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { eventIdFor } from '../body/derived-id.ts';
import { ALWAYS_HOSTILE } from './hostile-types.ts';
import type { HurtEvent, HurtReporter } from './hurt.ts';

const TICKS_PER_DAY = 24_000;

interface Point {
  x: number;
  z: number;
}

/** The fields of a mineflayer entity the attacker check reads. */
interface CauseEntity {
  id: number;
  name?: string;
  type?: string;
  position: { x: number; z: number };
}

/**
 * The attacker behind a hurt, from the server's damage cause: the entity the damage packet names
 * (mineflayer passes it as the second argument of `entityHurt`; for a projectile it is the shooter).
 * Only a hostile mob or a player counts. Nothing is attributed by proximity, so a passive mob next to
 * a drowning Body names no attacker, and neither does an absent cause (a fall, fire, drowning).
 */
function attackerOf(cause: unknown, selfId: number | undefined): Point | null {
  const entity = cause as CauseEntity | null | undefined;
  if (!entity || entity.id === selfId) return null;
  const hostile = entity.name !== undefined && ALWAYS_HOSTILE.has(entity.name);
  return hostile || entity.type === 'player'
    ? { x: entity.position.x, z: entity.position.z }
    : null;
}

/**
 * Passes each loss of the Body's health to `reporter`, with `tick` as the world age. An `entityHurt` on
 * the Body sets the attacker for the next health drop only; a drop with no such event, or with a cause
 * that is not a hostile mob or a player, is a hurt with no known cause (`other`, no bearing). Returns
 * the detach function.
 */
export function watchHurts(bot: Bot, reporter: HurtReporter, tick: () => number): () => void {
  let health: number | undefined = bot.health;
  let pending: { attacker: Point | null } | null = null;
  const onEntityHurt = (entity: unknown, cause?: unknown): void => {
    if (entity !== bot.entity) return;
    pending = { attacker: attackerOf(cause, bot.entity?.id) };
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
