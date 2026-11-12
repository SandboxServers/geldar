import { type Snapshot, validateSnapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { isEnclosed } from './body/view.ts';
import { wearOf } from './perception/item-wear.ts';
import { selfProbes } from './perception/self/index.ts';
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
  /** Authorized surroundings from the perception module; empty when absent. */
  surroundings?: Snapshot['surroundings'];
  /** Item names the agent has unlocked recipes for; `self.unlocked_recipes` is left out when absent. */
  unlockedRecipes?: string[];
  /** The Body's generation; `body_generation` is left out when absent. */
  bodyGeneration?: number;
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

/** Thunder outranks rain: a thunderstorm is also raining, and the snapshot names one weather. */
function weatherName(bot: Bot): Snapshot['world_time']['weather'] {
  if (bot.thunderState > 0) return 'thunder';
  if (bot.isRaining) return 'rain';
  return 'clear';
}

/** The contract's bare lowercase name: biome ids and effect names both match it. */
const CONTRACT_NAME = /^[a-z_]{1,64}$/;

/**
 * The bare biome id for the snapshot, or `undefined` when there is no name or the name does not
 * match the contract. The namespaced `minecraft:plains` becomes `plains`. Mineflayer on 26.1 can
 * report an empty name, so an unusable name leaves `biome` out rather than guessing one.
 */
function biomeId(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const bare = name.replace(/^minecraft:/, '');
  return CONTRACT_NAME.test(bare) ? bare : undefined;
}

/**
 * The snake_case form of a registry effect name: `MiningFatigue` becomes `mining_fatigue`, the
 * spelling the contract uses. The 26.1 registry names are CamelCase.
 */
function snakeName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Effect names from the entity's active effects, in snake_case. Ids the registry does not know,
 * and names that still do not match the contract after conversion, are dropped.
 */
function effectNames(bot: Bot): string[] {
  const names: string[] = [];
  for (const effect of Object.values(bot.entity.effects)) {
    const registryName = bot.registry.effects[effect.id]?.name;
    if (registryName === undefined) continue;
    const name = snakeName(registryName);
    if (CONTRACT_NAME.test(name)) names.push(name);
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
  const cell = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
  const block = bot.blockAt(cell);
  const position: Snapshot['self']['position'] = {
    x: cell.x,
    y: cell.y,
    z: cell.z,
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
      // Health Boost can lift the current health above the contract's 20; the contract caps it.
      health: Math.min(20, bot.health),
      hunger: bot.food,
      // Per-feature self fields (armor among them) come from the probe registry, in its order.
      ...selfProbes(bot),
      held_item: bot.heldItem?.name ?? null,
      // Mineflayer's bare item names (`cobblestone`); the contract's item name is a free string.
      inventory: bot.inventory
        .items()
        .map((stack) => ({ item: stack.name, count: stack.count, ...wearOf(stack) })),
      effects: effectNames(bot),
      budget_remaining_thoughts: opts.budgetRemainingThoughts ?? 0,
      days_since_sleep: opts.daysSinceSleep ?? 0,
      ...(opts.unlockedRecipes !== undefined ? { unlocked_recipes: opts.unlockedRecipes } : {}),
    },
    // Empty unless the caller passes the perception module's authorized surroundings (spec 5.2).
    // `enclosed` is the Body's own read of its cell (decision 0074), not perception.
    surroundings: {
      ...(opts.surroundings ?? {
        blocks_summary: '',
        notable_blocks: [],
        entities: [],
        agents: [],
      }),
      enclosed: isEnclosed((at) => bot.blockAt(at), cell),
    },
    ...(opts.bodyGeneration !== undefined ? { body_generation: opts.bodyGeneration } : {}),
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
