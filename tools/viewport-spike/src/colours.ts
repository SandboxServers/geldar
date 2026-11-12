// Block state -> flat colour for the spike. Production would use the Kino atlas's average colours
// (BlueMap textures.json `color`); names here are enough to tell scenes apart.

export type Rgb = readonly [number, number, number];

const BY_NAME: [RegExp, Rgb][] = [
  [/^grass_block$/, [106, 164, 70]],
  [/^(dirt|coarse_dirt|farmland|rooted_dirt)$/, [134, 96, 67]],
  [/sandstone/, [219, 207, 163]],
  [/^sand$/, [226, 214, 170]],
  [/^(stone|cobblestone|andesite|deepslate|gravel|diorite|granite)$/, [125, 125, 125]],
  [/leaves/, [58, 120, 40]],
  [/_log$|_wood$/, [102, 81, 50]],
  [/planks/, [162, 130, 78]],
  [/^bedrock$/, [60, 60, 60]],
  [/^(snow|snow_block)$/, [245, 250, 250]],
  [/^lava$/, [230, 110, 20]],
  [/^water$/, [50, 90, 210]],
  [/glass/, [190, 220, 230]],
  [/ore$/, [140, 130, 120]],
];

/** Blocks the ray passes through and draws nothing for (plants, torches: a spike limit). */
const PASS =
  /^(air|cave_air|void_air|short_grass|grass|tall_grass|fern|torch|wall_torch|poppy|dandelion|rail|vine)$/;
const SEE = /^(water|.*glass.*)$/;

export interface BlockLook {
  /** 0 pass through, 1 opaque, 2 blended (water, glass) */
  kind: 0 | 1 | 2;
  rgb: Rgb;
}

const cache = new Map<string, BlockLook>();

export function lookOf(state: string | undefined): BlockLook {
  if (state === undefined) return { kind: 0, rgb: [0, 0, 0] };
  let l = cache.get(state);
  if (l) return l;
  const name = /^[^:]*:([^[]+)/.exec(state)?.[1] ?? state;
  if (PASS.test(name)) l = { kind: 0, rgb: [0, 0, 0] };
  else {
    let rgb: Rgb | undefined;
    for (const [re, c] of BY_NAME) {
      if (re.test(name)) {
        rgb = c;
        break;
      }
    }
    if (!rgb) {
      let h = 7;
      for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      rgb = [90 + (h & 127), 90 + ((h >> 7) & 127), 90 + ((h >> 14) & 127)];
    }
    l = { kind: SEE.test(name) ? 2 : 1, rgb };
  }
  cache.set(state, l);
  return l;
}
