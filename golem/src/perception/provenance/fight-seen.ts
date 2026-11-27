/**
 * The Body's view of a fight near it (AN-47c): a combat provenance `engaged` message names the player who
 * hit a mob. When that player is visible to the Body (`observedActor`) and a mob of the target type is
 * within 24 blocks of the Body and in sight, the Body observes a `fight_seen`. A `killed` message teaches
 * nothing here, the Body's own fights are not observed, and nothing names a fighter who is out of sight.
 * The payload never carries health, a sheet or a mob position. Inert: nothing wires this in yet (AN-50b).
 * Paper-only in behaviour; do not enable on NeoForge until the human-handling question is decided.
 */
import {
  type ObservationPayload,
  type ObservedActor,
  type Provenance,
  validateObservationPayload,
} from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { canSeeBody } from '../body-sight.ts';
import { observedActor } from './visible-actor.ts';

/** The combat member of the Provenance union: `engaged` and `killed` (a combat provenance from the plugin). */
export type CombatProvenance = Extract<Provenance, { kind: 'engaged' | 'killed' }>;

/** The farthest mob, in blocks, from the Body that still counts as in reach. */
const REACH = 24;
/** A fighter's pair is observed at most once per this many ticks (measured on the Body's clock). */
const WINDOW_TICKS = 600;
/** Pairs remembered; past this the least recently observed pair is forgotten. */
const WINDOW_LIMIT = 256;
/** The contract's target bound (`fight_seen.target`): a mob type without namespace. */
const TARGET = /^[a-z_]{1,64}$/;

/** The fields of a mob entity the observer reads, as mineflayer lists it. */
interface MobEntity {
  type?: string;
  name?: string;
  position: Vec3;
  height?: number;
}

/**
 * Bounded memory of the last observation time per (fighter, target) pair. A pair seen again inside the
 * window is refused and does not move its time; past 256 pairs the least recently observed is dropped.
 */
export class FightWindows {
  private readonly last = new Map<string, number>();

  /** True when `pair` may be observed at `now`: never seen, or its last observation is 600 or more ticks old. */
  admit(pair: string, now: number): boolean {
    const previous = this.last.get(pair);
    if (previous !== undefined && now - previous < WINDOW_TICKS) return false;
    this.last.delete(pair);
    this.last.set(pair, now);
    if (this.last.size > WINDOW_LIMIT) {
      const oldest = this.last.keys().next().value;
      if (oldest !== undefined) this.last.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.last.size;
  }
}

export interface FightContext {
  bot: Bot;
  /** The world age now. The 600-tick window is measured on this clock, not on the message's tick. */
  tick: number;
  /** The Body's own username. A fight by the Body is not observed. */
  self: string;
  /** The Body's world name. When given, a fight in any other world is refused. */
  world?: string;
  /** Per-pair observation times. Required: a repeated message is observed once only if every caller passes it. */
  windows: FightWindows;
  /** Names the fighter. Defaults to `observedActor`; injected so a throwing resolver can be tested. */
  resolve?: (username: string) => ObservedActor | null;
}

/** Whether the message's fields are the kind a server sends, inside the contract's bounds. */
function wellFormed(msg: CombatProvenance): boolean {
  return (
    (msg.actor === null || typeof msg.actor === 'string') &&
    typeof msg.world === 'string' &&
    msg.world.length > 0 &&
    Number.isInteger(msg.tick) &&
    msg.tick >= 0 &&
    typeof msg.target === 'string' &&
    TARGET.test(msg.target)
  );
}

/** The fighter as the Body may name them. A throwing resolver names nobody. */
function fighterOf(username: string, ctx: FightContext): ObservedActor | null {
  try {
    return ctx.resolve ? ctx.resolve(username) : observedActor(ctx.bot, username);
  } catch {
    return null;
  }
}

/**
 * Whether a mob of the target type is within reach of the Body and in its sight: the same rule
 * `visibleView` uses for players, `canSeeBody`. Players are not mobs. A throwing read is no mob.
 */
function mobInSight(bot: Bot, target: string): boolean {
  try {
    const here = bot.entity.position;
    const mobs = Object.values(bot.entities) as unknown as MobEntity[];
    return mobs.some(
      (entity) =>
        entity.type !== 'player' &&
        entity.name === target &&
        here.distanceTo(entity.position) <= REACH &&
        canSeeBody(bot, entity.position, entity.height ?? 1),
    );
  } catch {
    return false;
  }
}

/**
 * The `fight_seen` observation for an engaged message, or null. Null for a `killed` message, for the
 * Body's own fight, for a fight in another world (when `ctx.world` is given), for a null or unseen or
 * hostile fighter, for a target with no mob in reach and in sight, for a payload the contract refuses, and
 * for a pair already observed within 600 ticks. A refused fight takes no window slot.
 */
export function observeFight(msg: CombatProvenance, ctx: FightContext): ObservationPayload | null {
  if (msg.kind !== 'engaged' || !wellFormed(msg)) return null;
  if (ctx.world !== undefined && msg.world !== ctx.world) return null;
  if (msg.actor === null || msg.actor.toLowerCase() === ctx.self.toLowerCase()) return null;
  const actor = fighterOf(msg.actor, ctx);
  if (actor === null) return null;
  if (!mobInSight(ctx.bot, msg.target)) return null;
  const key = `fight:${msg.tick}:${actor.name}:${msg.target}`.toLowerCase();
  const payload: ObservationPayload = { kind: 'fight_seen', actor, target: msg.target, key };
  // The contract has the last word (key shape and length, target, actor); a refused fight takes no slot.
  if (!validateObservationPayload(payload)) return null;
  if (!ctx.windows.admit(`${actor.name}:${msg.target}`.toLowerCase(), ctx.tick)) return null;
  return payload;
}
