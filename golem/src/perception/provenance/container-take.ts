/**
 * The owner's view of a take from a container (AN-51b): when a player takes items from a container
 * the Body owns (the message's `prior_owner` is the Body), and the Body can see that container right
 * now, the Body observes a `container_taken`. Nothing here names a taker who is out of sight, the Body
 * itself, or a name that is not a Minecraft username, and a take from anyone else's container teaches
 * nothing. Paper-only in behaviour; do not enable on NeoForge until the human-handling question is
 * decided.
 */
import {
  type ObservationPayload,
  type Provenance,
  validateObservationPayload,
} from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { canSeeBlock } from '../notable-blocks.ts';
import { observedActor } from './visible-actor.ts';

/**
 * The take record of the Provenance union. `TakeProvenance` is not exported by name, and it is the only
 * member with no `kind` field (the others each carry one).
 */
export type TakeProvenance = Exclude<Provenance, { kind: string }>;

/** The containers a take can come from: the same set `container.ts` opens. */
const CONTAINER_NAMES = new Set(['chest', 'trapped_chest', 'barrel']);
const ITEM = /^[a-z0-9_]+$/;
const TAKE_KEY_LIMIT = 256;
/** The contract's bounds (WorldCoord, the observation count and ItemName), checked before any lookup. */
const MAX_COORD = 30_000_000;
const MAX_Y = 2048;
const MAX_COUNT = 2304;
const MAX_ITEM = 64;

/**
 * Bounded memory of take keys. A key seen again is refused; past 256 keys the least recently seen is
 * forgotten. A repeat moves its key to the front.
 */
export class TakeKeyLru {
  private readonly keys = new Map<string, true>();

  /** True when `key` is new (now remembered); false for a repeat. */
  admit(key: string): boolean {
    const repeat = this.keys.has(key);
    this.keys.delete(key);
    this.keys.set(key, true);
    if (!repeat && this.keys.size > TAKE_KEY_LIMIT) {
      const oldest = this.keys.keys().next().value;
      if (oldest !== undefined) this.keys.delete(oldest);
    }
    return !repeat;
  }

  get size(): number {
    return this.keys.size;
  }
}

export interface TakeContext {
  bot: Bot;
  /** The world age now. A take stamped after it is refused. */
  tick: number;
  /** The Body's own username. */
  self: string;
  /** Keys already observed. Required: a redelivered take is observed once only if every caller passes it. */
  seen: TakeKeyLru;
}

/** Whether the take's numbers and names are the kind a server sends, inside the contract's bounds. */
function wellFormed(msg: TakeProvenance, now: number): boolean {
  const whole = [msg.x, msg.y, msg.z, msg.tick].every((n) => Number.isInteger(n));
  const inBounds =
    Math.abs(msg.x) <= MAX_COORD && Math.abs(msg.z) <= MAX_COORD && Math.abs(msg.y) <= MAX_Y;
  const item = typeof msg.item === 'string' && ITEM.test(msg.item) && msg.item.length <= MAX_ITEM;
  const count = Number.isInteger(msg.count) && msg.count > 0 && msg.count <= MAX_COUNT;
  return whole && inBounds && msg.tick >= 0 && msg.tick <= now && item && count;
}

/** Whether the block at the cell is a container the Body can see now. An unloaded or missing block is not. */
function isSeenContainer(bot: Bot, x: number, y: number, z: number): boolean {
  try {
    const block = bot.blockAt(new Vec3(x, y, z));
    return !!block && CONTAINER_NAMES.has(block.name) && canSeeBlock(bot, block);
  } catch {
    return false;
  }
}

/**
 * The `container_taken` observation for a take the Body owns, or null. Null when the Body is not the
 * prior owner (so other lives' takes teach nothing), when the Body took it itself, when the message is
 * malformed, when the container is not a visible container, or when the key was already observed. The
 * taker is named only through `observedActor`; a hidden taker leaves the observation unattributed.
 */
export function observeTake(msg: TakeProvenance, ctx: TakeContext): ObservationPayload | null {
  if (msg.prior_owner !== ctx.self || msg.actor === ctx.self) return null;
  if (!wellFormed(msg, ctx.tick)) return null;
  if (!isSeenContainer(ctx.bot, msg.x, msg.y, msg.z)) return null;
  const actor = observedActor(ctx.bot, msg.actor ?? undefined);
  const key = `take:${msg.tick}:${msg.x}:${msg.y}:${msg.z}:${actor?.name ?? '-'}:${msg.item}`;
  const payload: ObservationPayload = {
    kind: 'container_taken',
    ...(actor ? { actor } : {}),
    item: msg.item,
    count: msg.count,
    key,
  };
  // The contract has the last word (key shape and length, count, item); a refused take takes no slot.
  if (!validateObservationPayload(payload)) return null;
  if (!ctx.seen.admit(key)) return null;
  return payload;
}
