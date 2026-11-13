import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { GIVE_REACH } from '../actions/give.ts';
import { worldAge } from '../world-clock.ts';
import { compass } from './blocks-summary.ts';
import { ALWAYS_HOSTILE } from './hostile-types.ts';
import { canSeePoint } from './notable-blocks.ts';

type Surroundings = Snapshot['surroundings'];
type Entity = Surroundings['entities'][number];

/** How far the Body sees entities and other players, in blocks. */
export const ENTITY_RANGE = 24;
/** The most entities and the most agents in one snapshot, nearest first. */
export const MAX_ENTITIES = 32;
export const MAX_AGENTS = 16;
/** Dropped items of one name within this many blocks of the nearest one are one record. */
export const ITEM_CLUSTER_RADIUS = 4;
/**
 * Two samples of an entity compare for `closing` only when they are this many world ticks apart or
 * less; an older sample is discarded. The window edge itself still counts.
 */
export const CLOSING_WINDOW_TICKS = 100;

/** The metadata slot that holds a dropped item's stack (the protocol's item index). */
const ITEM_STACK_SLOT = 8;
/**
 * The metadata slot of a creeper's ignited flag (the Creeper data slots of the pinned 1.20.x line).
 * The live case `creeper-behind-wall` checks it against a real creeper.
 */
const CREEPER_IGNITED_SLOT = 18;
/** A mob this close and facing the Body is attacking it (the same reach and cone the Body uses). */
const MELEE_REACH = 4;
/** Cosine of the half-angle (60 degrees) within which a mob faces the Body. */
const FACING_COS = 0.5;

/** The fields of a Mineflayer entity read here. */
interface SeenEntity {
  type?: string;
  name?: string;
  username?: string;
  position: Vec3;
  height?: number;
  yaw?: number;
  heldItem?: { name?: string } | null;
  metadata?: unknown[];
}

/** One entity in sight, before dropped items are merged into stacks. */
interface Sighted {
  kind: string;
  position: Vec3;
  distance: number;
  /** For a dropped item: its name when it reads cleanly, and its count. */
  stack?: { name: string | null; count: number };
  /** The threat fields of a mob (hostile, state, closing, held item, fuse). */
  threat?: Partial<Entity>;
}

/** The distance and the tick at which one entity in sight was last seen. */
interface Sample {
  tick: number;
  distance: number;
}

const KIND = /^[a-z_]{1,64}$/;
const ITEM = /^[a-z0-9_]{1,64}$/;

/** The last sample of each entity in sight, per bot. Replaced on every observation, so an entity out of sight drops out. */
const samples = new WeakMap<Bot, Map<number, Sample>>();

/** How many entities the closing tracker holds for a bot; a bound for the tests. */
export function trackedSampleCount(bot: Bot): number {
  return samples.get(bot)?.size ?? 0;
}

function byDistance<T extends { distance: number }>(a: T, b: T, nameA: string, nameB: string) {
  return a.distance - b.distance || (nameA < nameB ? -1 : nameA > nameB ? 1 : 0);
}

/** Distance to one decimal, so the sentence a prompt builds from it is byte-stable. */
function tenths(distance: number): number {
  return Math.round(distance * 10) / 10;
}

/** A dropped item's stack from its metadata slot. A missing or unreadable name is null. */
function droppedStack(entity: SeenEntity): { name: string | null; count: number } {
  const stack = entity.metadata?.[ITEM_STACK_SLOT] as
    | { name?: unknown; count?: unknown }
    | undefined;
  const name = typeof stack?.name === 'string' && ITEM.test(stack.name) ? stack.name : null;
  const count =
    typeof stack?.count === 'number' && Number.isInteger(stack.count) && stack.count >= 1
      ? stack.count
      : 1;
  return { name, count };
}

/** True when the mob's body yaw points at `target` within the facing cone (horizontal only). */
function facesBody(entity: SeenEntity, target: Vec3): boolean {
  const dx = target.x - entity.position.x;
  const dz = target.z - entity.position.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) return true;
  const yaw = entity.yaw ?? 0;
  // mineflayer's forward vector for a yaw is (-sin yaw, -cos yaw): yaw 0 faces north (-z).
  return (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / length >= FACING_COS;
}

/**
 * Whether the entity closed in: its distance fell since the last sample, and that sample is inside
 * the window. An equal distance, a first sighting, or a sample out of the window is not closing.
 */
function closedIn(prev: Sample | undefined, tick: number, distance: number): boolean {
  if (prev === undefined || tick < prev.tick || tick - prev.tick > CLOSING_WINDOW_TICKS) {
    return false;
  }
  return distance < prev.distance;
}

/** The threat fields of a mob: the always-hostile flag, the observed state, the held item, the fuse. */
function threatFields(
  entity: SeenEntity,
  kind: string,
  here: Vec3,
  closing: boolean,
): Partial<Entity> {
  const fields: Partial<Entity> = {};
  if (ALWAYS_HOSTILE.has(kind)) fields.hostile = true;
  const held = entity.heldItem?.name;
  if (held && ITEM.test(held)) fields.held_item = held;
  if (kind === 'creeper' && entity.metadata?.[CREEPER_IGNITED_SLOT] === true) {
    fields.fuse = 'hissing';
  }
  if (closing) fields.closing = true;
  if (here.distanceTo(entity.position) <= MELEE_REACH && facesBody(entity, here)) {
    fields.state = 'attacking';
  } else if (closing) {
    fields.state = 'closing';
  }
  return fields;
}

/**
 * Where another agent stands against the Body: its feet more than one block above or below, or level;
 * and whether it is within give reach. Not emitted yet: the contract has no field for it, so
 * `health_estimate` stays `unknown`. Example: "unknown, below, in reach".
 */
export function agentNote(here: Vec3, position: Vec3, distance: number): string {
  const dy = position.y - here.y;
  const vertical = dy > 1 ? 'above' : dy < -1 ? 'below' : 'level';
  const reach = distance <= GIVE_REACH ? 'in reach' : 'out of reach';
  return `unknown, ${vertical}, ${reach}`;
}

/** A record at a position: the integer block coordinates, the distance and the compass direction. */
function place(here: Vec3, kind: string, position: Vec3, distance: number): Entity {
  return {
    type: kind,
    distance: tenths(distance),
    direction: compass(position.x - here.x, position.z - here.z),
    x: Math.floor(position.x),
    y: Math.floor(position.y),
    z: Math.floor(position.z),
  };
}

/**
 * Merges the sighted entities, nearest first, into records. Dropped items of one name that lie
 * within `ITEM_CLUSTER_RADIUS` of the nearest one of that name become one record with the summed
 * count and the nearest position. An item with no readable name stays a record of its own.
 */
function toRecords(here: Vec3, sighted: Sighted[]): Entity[] {
  const records: Entity[] = [];
  const clusters: { name: string; at: Vec3; record: Entity }[] = [];
  for (const seen of sighted) {
    if (seen.kind !== 'item' || seen.stack === undefined) {
      records.push({
        ...place(here, seen.kind, seen.position, seen.distance),
        ...seen.threat,
      });
      continue;
    }
    const { name, count } = seen.stack;
    if (name === null) {
      records.push(place(here, 'item', seen.position, seen.distance));
      continue;
    }
    const home = clusters.find(
      (c) => c.name === name && c.at.distanceTo(seen.position) <= ITEM_CLUSTER_RADIUS,
    );
    if (home) {
      home.record.count = (home.record.count ?? 0) + count;
      continue;
    }
    const record: Entity = {
      ...place(here, 'item', seen.position, seen.distance),
      item: name,
      count,
    };
    clusters.push({ name, at: seen.position, record });
    records.push(record);
  }
  return records;
}

/**
 * The entities and the other players the agent sees: within `ENTITY_RANGE` and with a clear line
 * from the eyes to the middle of the body. Nothing out of sight is reported. Players go to
 * `agents` (name, distance, held item, health unknown) and everything else to `entities`, each
 * with its integer block coordinates. A mob carries its threat fields; an arrow is reported only
 * while it is closing.
 */
export function observeEntities(bot: Bot): Pick<Surroundings, 'entities' | 'agents'> {
  const here = bot.entity.position;
  const tick = worldAge(bot);
  const previous = samples.get(bot) ?? new Map<number, Sample>();
  const current = new Map<number, Sample>();
  const sighted: (Sighted & { key: string })[] = [];
  const agents: (Surroundings['agents'][number] & { sort: string })[] = [];
  for (const [key, entity] of Object.entries(bot.entities) as [string, SeenEntity][]) {
    if (entity === (bot.entity as unknown as SeenEntity)) continue;
    const distance = here.distanceTo(entity.position);
    if (distance > ENTITY_RANGE) continue;
    const body = entity.position.offset(0, (entity.height ?? 1) / 2, 0);
    if (!canSeePoint(bot, body)) continue;
    const id = Number(key);
    const closing =
      tick !== null && Number.isInteger(id) && Number.isFinite(distance)
        ? closedIn(previous.get(id), tick, distance)
        : false;
    if (tick !== null && Number.isInteger(id)) current.set(id, { tick, distance });
    if (entity.type === 'player') {
      const name = entity.username ?? '';
      if (name.length < 1 || name.length > 32 || name === bot.username) continue;
      const held = entity.heldItem?.name;
      agents.push({
        name,
        distance: tenths(distance),
        held_item: held && ITEM.test(held) ? held : null,
        health_estimate: 'unknown',
        sort: name,
      });
      continue;
    }
    const kind = entity.name ?? '';
    if (!KIND.test(kind)) continue;
    if (kind === 'item') {
      const stack = droppedStack(entity);
      sighted.push({
        kind,
        position: entity.position,
        distance,
        stack,
        key: stack.name ?? '',
      });
      continue;
    }
    if (kind === 'arrow' && !closing) continue;
    const threat = threatFields(entity, kind, here, closing);
    sighted.push({ kind, position: entity.position, distance, threat, key: kind });
  }
  samples.set(bot, current);
  sighted.sort((a, b) => byDistance(a, b, a.key, b.key));
  agents.sort((a, b) => byDistance(a, b, a.sort, b.sort));
  return {
    entities: toRecords(here, sighted).slice(0, MAX_ENTITIES),
    agents: agents.slice(0, MAX_AGENTS).map(({ sort: _sort, ...rest }) => rest),
  };
}
