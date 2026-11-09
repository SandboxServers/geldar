import { type Snapshot, validateSnapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ulid } from './ulid.ts';

const DAY_TICKS = 24000;

/** Fields the Body fills in from its own state; the snapshot builder takes them as given. */
export interface SnapshotOptions {
  /** The agent life the snapshot belongs to (`agent_id`). */
  lifeId: string;
  shard: string;
  /** The revision the attention controller compares plans against (decision 0025). */
  revision: number;
  budgetRemainingThoughts?: number;
  daysSinceSleep?: number;
  heard?: Snapshot['heard'];
  events?: Snapshot['events_since_last_thought'];
  currentPlan?: Snapshot['current_plan'];
  stuck?: Snapshot['stuck'];
}

/**
 * Maps the vanilla time of day (0 to 23999) to the snapshot's name for it. Dusk, night and dawn
 * are the windows where mobs spawn and light changes; everything else is day.
 */
function timeOfDayName(t: number): Snapshot['world_time']['time_of_day'] {
  if (t >= 12000 && t <= 13799) return 'dusk';
  if (t >= 13800 && t <= 22299) return 'night';
  if (t >= 22300 && t <= 23999) return 'dawn';
  return 'day';
}

function weatherName(bot: Bot): Snapshot['world_time']['weather'] {
  if (bot.thunderState > 0) return 'thunder';
  if (bot.isRaining) return 'rain';
  return 'clear';
}

/** The contract's biome id: a bare lowercase name such as `plains`. */
const BIOME_ID = /^[a-z_]{1,64}$/;

/**
 * The bare biome id for the snapshot, or `undefined` when there is no name or the name does not
 * match the contract. The namespaced `minecraft:plains` becomes `plains`. Mineflayer on 26.1 can
 * report an empty name, so an unusable name leaves `biome` out rather than guessing one.
 */
function biomeId(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const bare = name.replace(/^minecraft:/, '');
  return BIOME_ID.test(bare) ? bare : undefined;
}

/** Effect names from the entity's active effects; ids the registry does not know are dropped. */
function effectNames(bot: Bot): string[] {
  const names: string[] = [];
  for (const effect of Object.values(bot.entity.effects)) {
    const name = bot.registry.effects[effect.id]?.name;
    if (name !== undefined) names.push(name);
  }
  return names;
}

/**
 * Builds one contract snapshot from the bot's state. `world_time.ticks` is the world age, not the
 * time of day, so it is comparable with `expires_tick` on the Thinker's side. Authorized
 * perception (spec 5.2) is wave 4: the surroundings are empty until then, and the bot's own
 * knowledge of the world is not handed to the Mind. Throws if the contract rejects the result,
 * because a snapshot the contract rejects is a bug in this code, not data.
 */
export function buildSnapshot(bot: Bot, opts: SnapshotOptions): Snapshot {
  const age = bot.time.age;
  const feet = bot.entity.position;
  const block = bot.blockAt(new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z)));
  const position: Snapshot['self']['position'] = {
    x: Math.floor(feet.x),
    y: Math.floor(feet.y),
    z: Math.floor(feet.z),
  };
  const biome = biomeId(block?.biome?.name);
  if (biome !== undefined) position.biome = biome;

  const snapshot = {
    snapshot_id: `sn_${ulid()}`,
    agent_id: opts.lifeId,
    shard: opts.shard,
    revision: opts.revision,
    world_time: {
      day: Math.floor(age / DAY_TICKS),
      time_of_day: timeOfDayName(bot.time.timeOfDay),
      ticks: age,
      weather: weatherName(bot),
    },
    self: {
      position,
      health: bot.health,
      hunger: bot.food,
      // Armor is computed in wave 4 from the equipped items; 0 until then.
      armor: 0,
      held_item: bot.heldItem?.name ?? null,
      // Mineflayer's bare item names (`cobblestone`); the contract's item name is a free string.
      inventory: bot.inventory.items().map((stack) => ({ item: stack.name, count: stack.count })),
      effects: effectNames(bot),
      budget_remaining_thoughts: opts.budgetRemainingThoughts ?? 0,
      days_since_sleep: opts.daysSinceSleep ?? 0,
    },
    // Empty until authorized perception (spec 5.2) lands in wave 4.
    surroundings: { blocks_summary: '', notable_blocks: [], entities: [], agents: [] },
    heard: opts.heard ?? [],
    events_since_last_thought: opts.events ?? [],
    ...(opts.currentPlan !== undefined ? { current_plan: opts.currentPlan } : {}),
    ...(opts.stuck !== undefined ? { stuck: opts.stuck } : {}),
  };

  const checked = validateSnapshot(snapshot);
  if (!checked.ok)
    throw new Error(`snapshot rejected by the contract: ${checked.errors.join('; ')}`);
  return checked.value;
}
