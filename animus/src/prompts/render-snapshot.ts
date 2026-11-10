import type { Snapshot } from '@geldar/contract';
import { formatNumber, type WorldTextLine } from './world-text.ts';

/** The most unlocked recipes shown; the rest are counted. */
export const MAX_RECIPES_SHOWN = 60;

/** A snapshot as prompt text, plus the in-world text it carries (for the quoted section). */
export interface RenderedSnapshot {
  /** Plain text built only from numbers and name tokens; safe outside the quoted section. */
  text: string;
  /** Heard lines, sign text, names and the other free text, for the quoted section. */
  world: WorldTextLine[];
}

/** Keeps a name token to lower-case letters, digits and underscores, at most 64 characters. */
export function nameToken(value: string): string {
  const cleaned = value.replace(/[^a-z0-9_]/g, '?');
  return cleaned.length > 64 ? cleaned.slice(0, 64) : cleaned;
}

const TOOL_SUFFIXES = ['_pickaxe', '_axe', '_shovel', '_hoe', '_sword'];
const TOOL_NAMES = new Set(['shears', 'fishing_rod', 'bucket', 'flint_and_steel', 'bow']);
const FOOD_NAMES = new Set([
  'bread',
  'cake',
  'cookie',
  'baked_potato',
  'pumpkin_pie',
  'mushroom_stew',
  'rabbit_stew',
  'beetroot_soup',
  'golden_apple',
  'golden_carrot',
  'honey_bottle',
]);
const SHELTER_PARTS = ['planks', 'door', 'fence', 'stairs', 'slab', 'glass', 'bricks', 'ladder'];
const SHELTER_NAMES = new Set([
  'crafting_table',
  'furnace',
  'chest',
  'torch',
  'cobblestone',
  'stone',
  'bed',
  'barrel',
]);

/** 0 tools, 1 food, 2 shelter and workshop blocks, 3 everything else. Lower is shown first. */
function recipeTier(item: string): number {
  if (TOOL_NAMES.has(item) || TOOL_SUFFIXES.some((s) => item.endsWith(s))) return 0;
  if (FOOD_NAMES.has(item) || item.startsWith('cooked_')) return 1;
  if (
    SHELTER_NAMES.has(item) ||
    item.endsWith('_bed') ||
    item.endsWith('_sign') ||
    SHELTER_PARTS.some((p) => item.endsWith(p))
  ) {
    return 2;
  }
  return 3;
}

/**
 * The unlocked recipes the prompt shows: tools first, then food, then shelter blocks, then the
 * rest, each group in name order, cut to {@link MAX_RECIPES_SHOWN}. `rest` counts the cut ones.
 */
export function pickRecipes(unlocked: readonly string[]): { shown: string[]; rest: number } {
  const unique = Array.from(new Set(unlocked.map(nameToken)));
  unique.sort((a, b) => recipeTier(a) - recipeTier(b) || (a < b ? -1 : a > b ? 1 : 0));
  return {
    shown: unique.slice(0, MAX_RECIPES_SHOWN),
    rest: Math.max(0, unique.length - MAX_RECIPES_SHOWN),
  };
}

/** Counts items by type, `a x2, b x1`, in name order. */
function countTypes(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([t, n]) => `${t} x${n}`)
    .join(', ');
}

/** Renders the snapshot as text, byte-stable for equal snapshots. */
export function renderSnapshot(snapshot: Snapshot): RenderedSnapshot {
  const world: WorldTextLine[] = [];
  const out: string[] = [];
  const self = snapshot.self;
  const pos = self.position;
  const biome = pos.biome === undefined ? '' : ` in biome ${nameToken(pos.biome)}`;
  const time = snapshot.world_time;

  out.push(
    `Day ${time.day}, ${time.time_of_day}, weather ${time.weather} (world tick ${time.ticks}).`,
  );
  out.push(`You stand at x=${pos.x} y=${pos.y} z=${pos.z}${biome}.`);
  out.push(
    `Health ${formatNumber(self.health)}/20. Hunger ${self.hunger}/20. Armor ${self.armor}. ` +
      `Holding: ${self.held_item === null ? 'nothing' : nameToken(self.held_item)}.`,
  );
  const stacks = [...self.inventory].sort((a, b) =>
    a.item < b.item ? -1 : a.item > b.item ? 1 : 0,
  );
  out.push(
    `Inventory: ${stacks.length === 0 ? 'empty' : stacks.map((s) => `${nameToken(s.item)} x${s.count}`).join(', ')}.`,
  );
  const effects = [...self.effects].map(nameToken).sort();
  out.push(`Effects: ${effects.length === 0 ? 'none' : effects.join(', ')}.`);

  if (self.unlocked_recipes === undefined) {
    out.push('Recipes you can craft: not reported.');
  } else {
    const { shown, rest } = pickRecipes(self.unlocked_recipes);
    const tail = rest > 0 ? ` and ${rest} more not listed` : '';
    out.push(
      `Recipes you can craft (${self.unlocked_recipes.length} unlocked): ` +
        `${shown.length === 0 ? 'none' : shown.join(', ')}${tail}. Craft needs an unlocked recipe and the materials.`,
    );
  }

  const notable = snapshot.surroundings.notable_blocks;
  out.push(
    `Notable blocks: ${
      notable.length === 0
        ? 'none'
        : notable.map((b) => `${nameToken(b.type)} at ${b.x} ${b.y} ${b.z}`).join('; ')
    }.`,
  );
  const entities = snapshot.surroundings.entities;
  out.push(
    `Creatures near you: ${
      entities.length === 0
        ? 'none'
        : entities
            .map(
              (e) =>
                `${nameToken(e.type)} ${formatNumber(e.distance)} blocks ${nameToken(e.direction)}`,
            )
            .join('; ')
    }.`,
  );
  out.push(
    `People near you: ${snapshot.surroundings.agents.length}. Their names and speech are in QUOTED WORLD TEXT.`,
  );

  const types = snapshot.events_since_last_thought.map((e) => nameToken(e.type));
  out.push(`Events since your last thought: ${types.length === 0 ? 'none' : countTypes(types)}.`);
  if (snapshot.stuck !== null && snapshot.stuck !== undefined) {
    out.push(
      `Your body noticed it repeats itself (${snapshot.stuck.repeat_count} times); try something different.`,
    );
  }

  if (snapshot.surroundings.blocks_summary !== '') {
    world.push({ kind: 'surroundings', fields: { summary: snapshot.surroundings.blocks_summary } });
  }
  for (const b of notable) {
    if (b.text !== undefined) {
      world.push({
        kind: 'sign',
        fields: { text: b.text, type: nameToken(b.type), x: b.x, y: b.y, z: b.z },
      });
    }
  }
  for (const a of snapshot.surroundings.agents) {
    world.push({
      kind: 'agent',
      fields: {
        distance: a.distance,
        health: a.health_estimate,
        held_item: a.held_item === null ? null : nameToken(a.held_item),
        name: a.name,
      },
    });
  }
  for (const h of snapshot.heard) {
    world.push({
      kind: 'heard',
      fields: { age_seconds: h.age_seconds, from: h.from, text: h.text },
    });
  }
  if (snapshot.current_plan !== null && snapshot.current_plan !== undefined) {
    const p = snapshot.current_plan;
    world.push({ kind: 'plan', fields: { action: p.action, goal: p.goal, status: p.status } });
  }
  return { text: out.join('\n'), world };
}
