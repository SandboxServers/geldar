// Render shape of a block state: full cube, crossed plant quads, or a few boxes (slabs, stairs, posts,
// thin layers). Pure; no DOM. An approximation of the vanilla models, enough that a fern is not a grey
// cube and a slab is not a full block. The plugin sends Bukkit data strings with properties:
// "minecraft:oak_slab[type=bottom,waterlogged=false]".

/** An axis-aligned box inside the cell, 0..1 on each axis: x0, y0, z0, x1, y1, z1. */
export type Box = readonly [number, number, number, number, number, number];

export type Shape =
  | { kind: 'cube' }
  | { kind: 'cross' }
  | { kind: 'boxes'; boxes: readonly Box[] }
  | { kind: 'skip' };

const CUBE: Shape = { kind: 'cube' };
const CROSS: Shape = { kind: 'cross' };
const SKIP: Shape = { kind: 'skip' };

/** Below this average alpha a texture is not a solid block face (leaves, 0.67, are named cubes). */
export const MIN_CUBE_COVERAGE = 0.7;

const NAMED_CUBES =
  /(?:leaves|glass|ice|slime_block|honey_block|spawner|water|lava|iron_bars|_pane|mushroom_block|beacon|sculk_sensor)$/;

const NAMED_SKIP =
  /^(?:light|barrier|structure_void|void_air|cave_air|tripwire|tripwire_hook|lever|flower_pot|.+_button|.+_sign|.+_banner|.+_head|.+_skull|.+_bed|redstone_wall_torch_off|potted_.+|bubble_column|moving_piston)$/;

const NAMED_CROSS = new RegExp(
  `^(?:short_grass|grass|tall_grass|fern|large_fern|dead_bush|bush|firefly_bush|short_dry_grass|tall_dry_grass|` +
    `dandelion|poppy|blue_orchid|allium|azure_bluet|(?:red|orange|white|pink)_tulip|oxeye_daisy|cornflower|` +
    `lily_of_the_valley|wither_rose|torchflower|open_eyeblossom|closed_eyeblossom|sunflower|lilac|rose_bush|` +
    `peony|pitcher_plant|.+_sapling|mangrove_propagule|brown_mushroom|red_mushroom|crimson_fungus|` +
    `warped_fungus|crimson_roots|warped_roots|nether_sprouts|hanging_roots|sugar_cane|bamboo_sapling|` +
    `sweet_berry_bush|fire|soul_fire|cobweb|seagrass|tall_seagrass|kelp|kelp_plant|wheat|carrots|potatoes|` +
    `beetroots|nether_wart|melon_stem|pumpkin_stem|attached_melon_stem|attached_pumpkin_stem|` +
    `azalea_plant|spore_blossom|small_dripleaf|big_dripleaf_stem|cave_vines|cave_vines_plant|` +
    `weeping_vines|weeping_vines_plant|twisting_vines|twisting_vines_plant|coral_fan|.+_coral|` +
    `.+_coral_fan|.+_coral_wall_fan|sea_pickle|torchflower_crop|pitcher_crop)$`,
);

const px = (n: number): number => n / 16;

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Shape {
  return { kind: 'boxes', boxes: [[px(x0), px(y0), px(z0), px(x1), px(y1), px(z1)]] };
}

export function parseProps(state: string): { name: string; props: Record<string, string> } {
  const m = /^(?:[^:[]*:)?([^[]+)(?:\[(.*)\])?$/.exec(state);
  const props: Record<string, string> = {};
  for (const kv of (m?.[2] ?? '').split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return { name: m?.[1] ?? state, props };
}

type Dir = 'north' | 'south' | 'east' | 'west';

/** The slab of thickness `t` sixteenths against the side a direction points to. */
function against(dir: string | undefined, t: number): Box {
  const a = px(t);
  const b = 1 - a;
  switch (dir) {
    case 'north':
      return [0, 0, 0, 1, 1, a];
    case 'south':
      return [0, 0, b, 1, 1, 1];
    case 'west':
      return [0, 0, 0, a, 1, 1];
    case 'east':
      return [b, 0, 0, 1, 1, 1];
    default:
      return [0, 0, 0, 1, a, 1];
  }
}

/** The upper half of a stair step: the half of the cell towards its facing, between y0 and y1. */
function step(facing: string | undefined, y0: number, y1: number): Box {
  const f = facing as Dir;
  if (f === 'north') return [0, y0, 0, 1, y1, 0.5];
  if (f === 'south') return [0, y0, 0.5, 1, y1, 1];
  if (f === 'west') return [0, y0, 0, 0.5, y1, 1];
  return [0.5, y0, 0, 1, y1, 1];
}

function stairs(props: Record<string, string>): Shape {
  const top = props.half === 'top';
  const base: Box = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
  return {
    kind: 'boxes',
    boxes: [base, top ? step(props.facing, 0, 0.5) : step(props.facing, 0.5, 1)],
  };
}

function slab(props: Record<string, string>): Shape {
  if (props.type === 'double') return CUBE;
  return props.type === 'top' ? box(0, 8, 0, 16, 16, 16) : box(0, 0, 0, 16, 8, 16);
}

function snow(props: Record<string, string>): Shape {
  const layers = Math.max(1, Math.min(8, Number(props.layers) || 1));
  return layers >= 8 ? CUBE : box(0, 0, 0, 16, layers * 2, 16);
}

function trapdoor(props: Record<string, string>): Shape {
  if (props.open === 'true') return { kind: 'boxes', boxes: [against(props.facing, 3)] };
  return props.half === 'top' ? box(0, 13, 0, 16, 16, 16) : box(0, 0, 0, 16, 3, 16);
}

function vineLike(props: Record<string, string>): Shape {
  const boxes: Box[] = [];
  for (const d of ['north', 'south', 'east', 'west'])
    if (props[d] === 'true') boxes.push(against(d, 1));
  if (props.up === 'true') boxes.push([0, px(15), 0, 1, 1, 1]);
  if (props.down === 'true') boxes.push([0, 0, 0, 1, px(1), 1]);
  return boxes.length > 0 ? { kind: 'boxes', boxes } : SKIP;
}

function gate(props: Record<string, string>): Shape {
  const alongX = props.facing === 'north' || props.facing === 'south';
  return alongX ? box(0, 5, 6, 16, 16, 10) : box(6, 5, 0, 10, 16, 16);
}

/** Flat things lying on the floor, one sixteenth thick. */
const FLAT =
  /^(?:.+_carpet|moss_carpet|pale_moss_carpet|.+_pressure_plate|rail|powered_rail|detector_rail|activator_rail|redstone_wire|lily_pad|leaf_litter|pink_petals|wildflowers|sculk_vein_floor)$/;

/**
 * The shape of a block state. `coverage` is the average alpha of its side texture when known: a block
 * with no rule of its own whose texture is mostly transparent is drawn as a plant, never as a cube.
 */
export function shapeOf(state: string, coverage?: number): Shape {
  const { name, props } = parseProps(state);
  if (NAMED_SKIP.test(name)) return SKIP;
  if (NAMED_CROSS.test(name)) return CROSS;
  if (/_slab$/.test(name)) return slab(props);
  if (/_stairs$/.test(name)) return stairs(props);
  if (name === 'snow') return snow(props);
  if (/_trapdoor$/.test(name)) return trapdoor(props);
  if (/_door$/.test(name)) return { kind: 'boxes', boxes: [against(props.facing, 3)] };
  if (name === 'vine' || name === 'glow_lichen' || name === 'sculk_vein' || name === 'ladder')
    return name === 'ladder'
      ? { kind: 'boxes', boxes: [against(props.facing, 1)] }
      : vineLike(props);
  if (FLAT.test(name)) return box(0, 0, 0, 16, 1, 16);
  if (/torch$/.test(name)) return box(7, 0, 7, 9, 10, 9);
  if (/lantern$/.test(name)) return box(5, 0, 5, 11, 7, 11);
  if (/candle$/.test(name)) return box(6, 0, 6, 10, 6, 10);
  if (name === 'end_rod' || name === 'chain' || name === 'lightning_rod')
    return box(7, 0, 7, 9, 16, 9);
  if (/_fence_gate$/.test(name)) return gate(props);
  if (/_fence$/.test(name)) return box(6, 0, 6, 10, 16, 10);
  if (/_wall$/.test(name)) return box(4, 0, 4, 12, 16, 12);
  if (name === 'cactus') return box(1, 0, 1, 15, 16, 15);
  if (name === 'farmland' || name === 'dirt_path') return box(0, 0, 0, 16, 15, 16);
  if (name === 'campfire' || name === 'soul_campfire') return box(0, 0, 0, 16, 7, 16);
  if (/(?:^|_)chest$/.test(name)) return box(1, 0, 1, 15, 14, 15);
  if (NAMED_CUBES.test(name)) return CUBE;
  if (coverage !== undefined && coverage < MIN_CUBE_COVERAGE) return CROSS;
  return CUBE;
}
