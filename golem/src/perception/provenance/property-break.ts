/**
 * The owner's view of a broken owned block (AN-27b): when someone other than the Body breaks a block the
 * Body owns (the message's `prior_owner` is the Body), and the Body can see that cell right now, the Body
 * observes a `property_broken`. Nothing here names a breaker who is out of sight, the Body itself, or a
 * name that is not a Minecraft username, and a break of an unowned block teaches nothing. The cell must
 * be within 24 blocks of the Body. Sight of the cell is injected (`canSee`). Inert: nothing wires this in
 * yet (AN-28b). Paper-only in behaviour; do not enable on NeoForge until the human-handling question is
 * decided.
 */
import {
  type ObservationPayload,
  type ObservedActor,
  type Provenance,
  validateObservationPayload,
} from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { TakeKeyLru } from './container-take.ts';

/** The break record of the Provenance union (`Extract` keeps the intersection form from matching the take). */
export type BreakProvenance = Extract<Provenance, { kind: 'break' }>;

export interface BreakContext {
  /** The Body's own username: the owner the break is checked against. */
  selfName: string;
  bot: Bot;
  /** Keys already observed (bounded at 256 by `TakeKeyLru`). A key seen again is refused. */
  seen: TakeKeyLru;
  /** Names the breaker through the visible-actor rule; null when the name is not a visible player. */
  resolve: (username: string | undefined) => ObservedActor | null;
  /** Whether the Body can see the cell now. Injected: this module never calls the real sight check. */
  canSee: (x: number, y: number, z: number) => boolean;
}

/** Whether the breaker is the Body itself. Minecraft names are not case-sensitive, so the capitals do not count. */
function isSelf(actor: string | null | undefined, selfName: string): boolean {
  return typeof actor === 'string' && actor.toLowerCase() === selfName.toLowerCase();
}

/** The farthest cell centre, in blocks, from the Body that still counts as in reach. */
const REACH = 24;
const BLOCK = /^[a-z_]{1,64}$/;
/** The contract's bounds (WorldCoord), checked before any lookup. */
const MAX_COORD = 30_000_000;
const MAX_Y = 2048;

/** Whether the break's numbers and block name are the kind a server sends, inside the contract's bounds. */
function wellFormed(msg: BreakProvenance): boolean {
  const whole = [msg.x, msg.y, msg.z, msg.tick].every((n) => Number.isInteger(n));
  const inBounds =
    Math.abs(msg.x) <= MAX_COORD && Math.abs(msg.z) <= MAX_COORD && Math.abs(msg.y) <= MAX_Y;
  const block = typeof msg.block === 'string' && BLOCK.test(msg.block);
  return whole && inBounds && msg.tick >= 0 && block;
}

/** Whether the centre of the cell is within 24 blocks of the Body's position. A missing position is not. */
function inReach(bot: Bot, x: number, y: number, z: number): boolean {
  try {
    return new Vec3(x + 0.5, y + 0.5, z + 0.5).distanceTo(bot.entity.position) <= REACH;
  } catch {
    return false;
  }
}

/** Whether the Body sees the cell. A throwing check is a refusal. */
function seesCell(ctx: BreakContext, x: number, y: number, z: number): boolean {
  try {
    return ctx.canSee(x, y, z) === true;
  } catch {
    return false;
  }
}

/** The breaker, named only through `resolve`. A throwing resolver leaves the breaker unnamed. */
function breakerOf(ctx: BreakContext, username: string | undefined): ObservedActor | null {
  try {
    return ctx.resolve(username);
  } catch {
    return null;
  }
}

/**
 * The `property_broken` observation for a break of a block the Body owns, or null. Null when the Body is
 * not the prior owner (so other lives' blocks teach nothing), when the Body broke it itself, when the
 * message is malformed, when the cell is out of reach or out of sight, or when the key was already
 * observed. The breaker is named only through `ctx.resolve`; an unseen breaker leaves the observation
 * unattributed, and the key then carries `none` in place of a name.
 */
export function observeBreak(msg: BreakProvenance, ctx: BreakContext): ObservationPayload | null {
  if (msg.prior_owner !== ctx.selfName || isSelf(msg.actor, ctx.selfName)) return null;
  if (!wellFormed(msg)) return null;
  if (!inReach(ctx.bot, msg.x, msg.y, msg.z)) return null;
  if (!seesCell(ctx, msg.x, msg.y, msg.z)) return null;
  const actor = breakerOf(ctx, msg.actor ?? undefined);
  const key = `brk:${msg.tick}:${msg.x}:${msg.y}:${msg.z}:${actor?.name ?? 'none'}`.toLowerCase();
  const payload: ObservationPayload = {
    kind: 'property_broken',
    ...(actor ? { actor } : {}),
    block: msg.block,
    key,
  };
  // The contract has the last word (key shape and length, block name, actor); a refused break takes no slot.
  if (!validateObservationPayload(payload)) return null;
  if (!ctx.seen.admit(key)) return null;
  return payload;
}
