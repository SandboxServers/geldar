// Baked flat colours for the viewport renderer. This table is the committed source; the renderer never
// reads texture packs or the Kino atlas at runtime. Colours are approximate average texel colours of
// the vanilla textures. An unlisted block gets a stable colour from its name (see colourFor), so an
// unknown block is still a solid, distinguishable surface rather than a hole in the picture.

export type Rgb = readonly [number, number, number];

/** How a block state is drawn: 0 passes the ray through, 1 is opaque, 2 is see-through and tints. */
export type BlockKind = 0 | 1 | 2;

export interface BlockLook {
  kind: BlockKind;
  rgb: Rgb;
}

/** Name patterns, first match wins. Names have no namespace and no state properties. */
const COLOUR_RULES: readonly (readonly [RegExp, Rgb])[] = [
  [/^grass_block$/, [106, 164, 70]],
  [/^(dirt|coarse_dirt|farmland|rooted_dirt|podzol)$/, [134, 96, 67]],
  [/sandstone/, [219, 207, 163]],
  [/^(sand|suspicious_sand)$/, [226, 214, 170]],
  [/^(stone|cobblestone|andesite|deepslate|gravel|diorite|granite|tuff)$/, [125, 125, 125]],
  [/leaves/, [58, 120, 40]],
  [/_log$|_wood$|stem$/, [102, 81, 50]],
  [/planks/, [162, 130, 78]],
  [/^bedrock$/, [60, 60, 60]],
  [/^(snow|snow_block|powder_snow)$/, [245, 250, 250]],
  [/^lava$/, [230, 110, 20]],
  [/^water$/, [50, 90, 210]],
  [/glass/, [190, 220, 230]],
  [/ore$/, [140, 130, 120]],
];

/** Names the ray passes through without drawing (plants, torches, air). */
const PASS =
  /^(air|cave_air|void_air|short_grass|grass|tall_grass|fern|torch|wall_torch|poppy|dandelion|rail|vine)$/;

/** Names drawn see-through (the ray continues and the colour is blended in). */
const SEE_THROUGH = /^(water|.*glass.*)$/;

const cache = new Map<string, BlockLook>();

/** The block name without a namespace or state properties: `minecraft:oak_log[axis=y]` gives `oak_log`. */
export function blockName(state: string): string {
  return /^(?:[^:[]*:)?([^[]+)/.exec(state)?.[1] ?? state;
}

function hashName(name: string): number {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Colour for a block name: the table, else a stable colour derived from the name. */
export function colourFor(name: string): Rgb {
  for (const [re, rgb] of COLOUR_RULES) if (re.test(name)) return rgb;
  const h = hashName(name);
  return [90 + (h & 127), 90 + ((h >> 7) & 127), 90 + ((h >> 14) & 127)];
}

/** How the renderer draws a block, from the name a ViewportWorld reports. Cached per name. */
export function lookOf(state: string): BlockLook {
  const hit = cache.get(state);
  if (hit) return hit;
  const name = blockName(state);
  const look: BlockLook = PASS.test(name)
    ? { kind: 0, rgb: [0, 0, 0] }
    : { kind: SEE_THROUGH.test(name) ? 2 : 1, rgb: colourFor(name) };
  cache.set(state, look);
  return look;
}
