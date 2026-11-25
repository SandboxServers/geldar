import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import { ENTITY_RANGE } from '../perception/entities.ts';
import { eyePosition, isSeeThrough } from '../perception/notable-blocks.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

/**
 * Why a recipient was not in sight: no loaded player has that exact name (`name_not_matched`), the
 * server lists the name but the Body has not loaded the entity (`not_loaded`), the entity is beyond
 * `ENTITY_RANGE` (`out_of_range_24`), or the line from the eyes is blocked (`los_blocked`).
 */
export type NotInSightCheck = 'name_not_matched' | 'not_loaded' | 'out_of_range_24' | 'los_blocked';

/** The most loaded players one diag line lists, the nearest first. */
const MAX_LOADED_PLAYERS = 12;

/** The fields of a loaded entity the diag reads; the typings do not declare the pose fields. */
interface LoadedPlayer {
  type?: string;
  username?: string;
  position: Vec3;
  height?: number;
  pose?: unknown;
  isSleeping?: boolean;
}

interface RayWorld {
  raycast(
    from: Vec3,
    direction: Vec3,
    range: number,
    filter: (
      block: { name: string; shapes: unknown; position: Vec3 },
      iter: { intersect(shapes: unknown, at: Vec3): unknown },
    ) => boolean,
  ): { position: Vec3 } | null;
}

/** Rounds to two decimal places, for a diag line. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The first block that stops a line, by name and block position. */
interface Blocker {
  name: string;
  pos: { x: number; y: number; z: number };
}

/** The first block that stops the line from the eyes to `at`, or null when none does. */
function firstBlockingBlock(bot: Bot, at: Vec3): Blocker | null {
  const eyes = eyePosition(bot);
  const toPoint = at.minus(eyes);
  const range = toPoint.norm();
  if (range === 0) return null;
  const hit = (bot.world as unknown as RayWorld).raycast(
    eyes,
    toPoint.normalize(),
    range,
    (block, iter) =>
      !isSeeThrough(block.name) && iter.intersect(block.shapes, block.position) !== null,
  );
  if (!hit) return null;
  // The block is read by its position, which every raycast result carries.
  const name = bot.blockAt(hit.position)?.name;
  if (!name) return null;
  return { name, pos: { x: hit.position.x, y: hit.position.y, z: hit.position.z } };
}

/** Where on a standing player the eyes are, as a share of its height (1.62 of 1.8). */
const EYE_SHARE = 0.9;
/** How far above the feet the feet line ends, so it does not graze the floor under them. */
const FEET_LIFT = 0.1;

/**
 * The block that stops each of three lines from the Body's eyes: to the target's feet, to the middle
 * of its body (the line the visible check uses) and to its eyes; null where that line is clear. A
 * clear eyes line beside a blocked middle line means a low obstacle, not a wall.
 */
function rayBlockers(
  bot: Bot,
  feet: Vec3,
  height: number,
): { feet: string | null; middle: string | null; eyes: string | null } {
  const at = (lift: number) => firstBlockingBlock(bot, feet.offset(0, lift, 0))?.name ?? null;
  return { feet: at(FEET_LIFT), middle: at(height / 2), eyes: at(height * EYE_SHARE) };
}

/**
 * The facts of one failed recipient lookup, read at the moment it failed. It is operator-only: the
 * agent never sees it. The server's player list is read here, and only here, to tell a name that is
 * listed but not loaded from one that matches nobody; the give's outcome never depends on it.
 */
export function notInSightFacts(bot: Bot, to: string): Record<string, unknown> {
  const self = bot.entity.position;
  const loaded = (Object.values(bot.entities) as LoadedPlayer[]).filter(
    (entity) =>
      entity.type === 'player' &&
      entity.username !== bot.username &&
      entity !== (bot.entity as unknown as LoadedPlayer),
  );
  const entity = loaded.find((candidate) => candidate.username === to) ?? null;
  const loadedPlayers = loaded
    .map((other) => ({
      username: other.username ?? '',
      dist: round(self.distanceTo(other.position)),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_LOADED_PLAYERS);
  if (!entity) {
    const listed = Object.hasOwn(bot.players ?? {}, to);
    return facts(
      bot,
      to,
      listed ? 'not_loaded' : 'name_not_matched',
      null,
      null,
      loadedPlayers,
      null,
      null,
    );
  }
  const height = entity.height ?? 1;
  const pose =
    typeof entity.pose === 'string' ? entity.pose : entity.isSleeping === true ? 'sleeping' : null;
  const dist = self.distanceTo(entity.position);
  const shape = {
    x: round(entity.position.x),
    y: round(entity.position.y),
    z: round(entity.position.z),
    height,
    pose,
  };
  if (dist > ENTITY_RANGE)
    return facts(bot, to, 'out_of_range_24', shape, dist, loadedPlayers, null, null);
  const los = firstBlockingBlock(bot, entity.position.offset(0, height / 2, 0));
  const rays = rayBlockers(bot, entity.position, height);
  return facts(bot, to, 'los_blocked', shape, dist, loadedPlayers, los, rays);
}

/** The diag line's fields, in one place. */
function facts(
  bot: Bot,
  to: string,
  check: NotInSightCheck,
  entity: Record<string, unknown> | null,
  dist: number | null,
  loadedPlayers: { username: string; dist: number }[],
  los: Blocker | null,
  rays: Record<string, string | null> | null,
): Record<string, unknown> {
  const self = bot.entity.position;
  return {
    event: 'not_in_sight',
    check,
    to,
    self: { x: round(self.x), y: round(self.y), z: round(self.z) },
    entity,
    dist: dist === null ? null : round(dist),
    loaded_players: loadedPlayers,
    los_block: los?.name ?? null,
    los_block_pos: los?.pos ?? null,
    rays,
    tick: bot.time?.age ?? null,
  };
}

/** Writes the `not_in_sight` diag line for a recipient that failed the lookup. Never throws. */
export function logNotInSight(bot: Bot, to: string): void {
  try {
    DEFAULT_DIAG_SINK.log(JSON.stringify(notInSightFacts(bot, to)));
  } catch {
    // A diag line that cannot be written never changes the give's outcome.
  }
}
