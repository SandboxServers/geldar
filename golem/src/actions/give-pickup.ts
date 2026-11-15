import type { Bot } from 'mineflayer';
import { errorText } from './outcome.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

type Entity = Bot['entities'][string];

/** A tossed item spawns this close (blocks, horizontal) to the Body's feet when the Body tosses. */
const SPAWN_HORIZONTAL = 1.0;
/** A tossed item spawns this close (blocks, vertical) to the Body's feet when the Body tosses. */
const SPAWN_VERTICAL = 1.5;
/** How often the wait checks for pickups and for an abort. */
const POLL_MS = 25;

/**
 * The item entities one toss created, and the items picked up since: by the recipient, by the Body,
 * or by another player (`others`, item id to that player's name). `stacks` is the item count each
 * entity holds, the latest count from `itemDrop`, and `collected` the items the recipient took from
 * each one. Vanilla merges nearby stacks on the ground: a merged-away entity vanishes with no pickup
 * (`gone`), and its items are in the stack that survives, so the items are counted, not the entities.
 * An entity is claimed (`dropped`) only when it spawns at the Body's feet right after `arm`, and its
 * metadata says it is the item given. Any other item that spawns while the watch is up is `rejected`.
 */
export interface PickupWatch {
  dropped: Set<number>;
  rejected: Set<number>;
  stacks: Map<number, number>;
  gone: Set<number>;
  collected: Map<number, number>;
  taken: Set<number>;
  others: Map<number, string>;
  /** Why the take-back ended, for the diag line only. */
  takeBackWhy?: string;
  /** Called right before the toss: from here on, an item spawned at the Body's feet is this toss's. */
  arm(feet: Entity['position']): void;
  stop(): void;
}

/**
 * The items an item entity holds (its stack). Its metadata has not arrived at `entitySpawn`, and
 * prismarine-item throws on empty metadata, so any throw or no stack counts as one item.
 */
function stackCount(entity: Entity): number {
  try {
    return entity.getDroppedItem?.()?.count ?? 1;
  } catch {
    return 1;
  }
}

/** The item name an entity holds, or undefined while its metadata has not arrived or cannot be read. */
function droppedName(entity: Entity): string | undefined {
  try {
    return entity.getDroppedItem?.()?.name;
  } catch {
    return undefined;
  }
}

/**
 * Wraps a listener this file adds so a throw in its body never reaches the emitter (which would
 * end the process). The throw is logged as one diag line and not rethrown.
 */
function guarded<A extends unknown[]>(
  name: string,
  body: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    try {
      body(...args);
    } catch (error) {
      // Neither building the line nor writing it may throw into the emitter.
      try {
        DEFAULT_DIAG_SINK.log(
          JSON.stringify({
            event: 'give_listener_error',
            listener: name,
            error: thrownText(error),
          }),
        );
      } catch {
        // The diag line could not be written: the throw is dropped, not rethrown.
      }
    }
  };
}

/** A thrown value as diag text. One with no prototype cannot be stringified, so it reads as its type tag. */
function thrownText(error: unknown): string {
  try {
    return errorText(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

/** Whether an entity at `at` is where a toss from `feet` spawns its items. */
function atToss(at: Entity['position'], feet: { x: number; y: number; z: number }): boolean {
  const horizontal = Math.hypot(at.x - feet.x, at.z - feet.z);
  return horizontal <= SPAWN_HORIZONTAL && Math.abs(at.y - feet.y) <= SPAWN_VERTICAL;
}

/**
 * Listens for the item entities a toss creates at the Body's feet, and for pickups of them by the
 * recipient and by the Body itself. It must be started before the toss, and armed just before it, so
 * no spawn is missed. Items already on the ground, and items of another player's toss, are not claimed.
 * A pickup by the recipient counts the collect packet's `pickupItemCount` when the client reports
 * one, else the items the entity holds when it is collected.
 */
export function watchPickup(bot: Bot, to: string, item: string): PickupWatch {
  const dropped = new Set<number>();
  const rejected = new Set<number>();
  const stacks = new Map<number, number>();
  const gone = new Set<number>();
  const collected = new Map<number, number>();
  const taken = new Set<number>();
  const others = new Map<number, string>();
  const packetCounts = new Map<number, number>();
  let armedAt: { x: number; y: number; z: number } | null = null;
  // At spawn the metadata has not arrived yet, so only the position is checked here, never the stack.
  const onSpawn = guarded('entitySpawn', (entity: Entity): void => {
    if (entity.name !== 'item') return;
    if (armedAt !== null && atToss(entity.position, armedAt)) dropped.add(entity.id);
    else rejected.add(entity.id);
  });
  // `itemDrop` fires once the metadata is in, and again when a merge changes the stack. It only
  // updates an entity this toss claimed at its spawn, so a stack that was already there is never counted.
  // A claimed entity that holds another item is not this toss's, so its claim is dropped.
  const onItemDrop = guarded('itemDrop', (entity: Entity): void => {
    if (!dropped.has(entity.id)) return;
    const name = droppedName(entity);
    if (name !== undefined && name !== item) {
      dropped.delete(entity.id);
      stacks.delete(entity.id);
      rejected.add(entity.id);
      return;
    }
    stacks.set(entity.id, stackCount(entity));
  });
  const onGone = guarded('entityGone', (entity: Entity): void => {
    if (dropped.has(entity.id)) gone.add(entity.id);
  });
  const onCollect = guarded('playerCollect', (collector: Entity, picked: Entity): void => {
    if (!dropped.has(picked.id)) return;
    if (collector.username === to) {
      collected.set(picked.id, packetCounts.get(picked.id) ?? stackCount(picked));
    } else if (collector === bot.entity) taken.add(picked.id);
    else if (collector.username) others.set(picked.id, collector.username);
  });
  // The collect packet reaches this listener before mineflayer emits playerCollect for it.
  const onPacket = guarded(
    'collect',
    (packet: { collectedEntityId: number; pickupItemCount?: number }): void => {
      if (packet.pickupItemCount !== undefined) {
        packetCounts.set(packet.collectedEntityId, packet.pickupItemCount);
      }
    },
  );
  const client: Bot['_client'] | undefined = bot._client;
  bot.on('entitySpawn', onSpawn);
  bot.on('itemDrop', onItemDrop);
  bot.on('entityGone', onGone);
  bot.on('playerCollect', onCollect);
  client?.prependListener('collect', onPacket);
  return {
    dropped,
    rejected,
    stacks,
    gone,
    collected,
    taken,
    others,
    arm: (feet) => {
      armedAt = { x: feet.x, y: feet.y, z: feet.z };
    },
    stop: () => {
      bot.removeListener('entitySpawn', onSpawn);
      bot.removeListener('itemDrop', onItemDrop);
      bot.removeListener('entityGone', onGone);
      bot.removeListener('playerCollect', onCollect);
      client?.removeListener('collect', onPacket);
    },
  };
}

/** The items the recipient collected. */
export function pickedItems(watch: PickupWatch): number {
  return [...watch.collected.values()].reduce((sum, count) => sum + count, 0);
}

/**
 * The items the toss left: each claimed entity's latest count (or what the recipient collected from
 * it, if more). An entity that went away with no pickup is left out: a merged-away one's items are
 * in the survivor, which is counted, and a vanished one has none.
 */
export function tossedItems(watch: PickupWatch): number {
  let sum = 0;
  for (const id of watch.dropped) {
    const pickedUp = watch.collected.has(id) || watch.taken.has(id) || watch.others.has(id);
    if (watch.gone.has(id) && !pickedUp) continue;
    sum += Math.max(watch.stacks.get(id) ?? 1, watch.collected.get(id) ?? 0);
  }
  return sum;
}

/** Every tossed item has been picked up by the recipient. */
export function allPicked(watch: PickupWatch): boolean {
  const total = tossedItems(watch);
  return total > 0 && pickedItems(watch) >= total;
}

/** Waits until `done()` holds, the wait runs out, or the run aborts. */
export async function awaitUntil(
  done: () => boolean,
  signal: AbortSignal,
  waitMs: number,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (!signal.aborted && Date.now() < deadline && !done()) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
