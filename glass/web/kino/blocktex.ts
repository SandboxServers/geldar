// Block state -> BlueMap texture ids, biome tints and the fallback colour. Pure; no DOM.
// The plugin sends Bukkit block data strings: "minecraft:oak_leaves[distance=7,persistent=false]".

import { parseProps } from './blockshape.ts';
import type { Face } from './mesher.ts';

const DERIVED_SUFFIX = /_(stairs|slab|fence_gate|fence|wall|button|pressure_plate|carpet)$/;

/** Block names whose texture lives under another name, per face ('side' means any side). */
const SPECIAL: Record<string, Partial<Record<'top' | 'bottom' | 'side', string[]>>> = {
  grass_block: { top: ['grass_block_top'], bottom: ['dirt'], side: ['grass_block_side'] },
  podzol: { bottom: ['dirt'] },
  mycelium: { bottom: ['dirt'] },
  dirt_path: { bottom: ['dirt'], top: ['dirt_path_top'] },
  water: { top: ['water_still'], bottom: ['water_still'], side: ['water_still'] },
  lava: { top: ['lava_still'], bottom: ['lava_still'], side: ['lava_still'] },
  grass: { top: ['short_grass', 'grass'], bottom: ['short_grass'], side: ['short_grass', 'grass'] },
  kelp: { top: ['kelp_plant'], bottom: ['kelp_plant'], side: ['kelp_plant'] },
  wall_torch: { top: ['torch'], bottom: ['torch'], side: ['torch'] },
  soul_wall_torch: { top: ['soul_torch'], bottom: ['soul_torch'], side: ['soul_torch'] },
  redstone_wall_torch: {
    top: ['redstone_torch'],
    bottom: ['redstone_torch'],
    side: ['redstone_torch'],
  },
};

/** Two-block-tall plants and doors have a texture per half. */
const TWO_HALVES =
  /^(?:tall_grass|large_fern|sunflower|lilac|rose_bush|peony|tall_seagrass|pitcher_plant|.+_door)$/;

/** Crop stage texture: the block's age mapped to the stage number of its texture set. */
const CROP_STAGES: Record<string, (age: number) => number> = {
  sweet_berry_bush: (a) => a,
  wheat: (a) => a,
  beetroots: (a) => a,
  nether_wart: (a) => (a === 0 ? 0 : a < 3 ? 1 : 2),
  carrots: (a) => (a < 2 ? 0 : a < 4 ? 1 : a < 7 ? 2 : 3),
  potatoes: (a) => (a < 2 ? 0 : a < 4 ? 1 : a < 7 ? 2 : 3),
};

/** Texture ids that depend on block-state properties (half, age), best first. */
function stateTextureIds(ns: string, name: string, props: Record<string, string>): string[] {
  if (TWO_HALVES.test(name)) {
    const half = props.half === 'upper' ? 'top' : 'bottom';
    return [`${ns}:block/${name}_${half}`];
  }
  const stage = CROP_STAGES[name];
  if (stage) return [`${ns}:block/${name}_stage${stage(Number(props.age) || 0)}`];
  return [];
}

function parseState(state: string): { ns: string; name: string } | null {
  const m = /^([^:[]+):([^[]+)/.exec(state);
  return m ? { ns: m[1] as string, name: m[2] as string } : null;
}

/** Other block names whose texture stands in for this one (stairs -> planks, wood -> log). */
function stems(name: string): string[] {
  const out = [name];
  if (name.endsWith('_wood')) out.push(name.replace(/_wood$/, '_log'));
  const m = DERIVED_SUFFIX.exec(name);
  if (m) {
    const stem = name.slice(0, m.index);
    out.push(stem, `${stem}_planks`, `${stem}s`, `${stem}_block`, `${stem}_wool`);
    if (stem.endsWith('_brick')) out.push(`${stem}s`);
  }
  return out;
}

/** The texture ids to try for a block state's face, best first. */
export function faceTextureIds(state: string, face: Face): string[] {
  const p = parseState(state);
  if (!p) return [];
  const kind = face === 'py' ? 'top' : face === 'ny' ? 'bottom' : 'side';
  const ids: string[] = stateTextureIds(p.ns, p.name, parseProps(state).props);
  for (const name of stems(p.name)) {
    const base = `${p.ns}:block/${name}`;
    for (const s of SPECIAL[name]?.[kind] ?? []) ids.push(`${p.ns}:block/${s}`);
    if (kind === 'top') ids.push(`${base}_top`, `${base}_end`, base);
    else if (kind === 'bottom') ids.push(`${base}_bottom`, `${base}_end`, `${base}_top`, base);
    else ids.push(`${base}_side`, base, `${base}_top`);
  }
  return ids;
}

const GRASS = 0x79c05a;
const FOLIAGE = 0x48b518;

/** Grey vanilla textures the game multiplies by the biome grass colour. Flowers and mushrooms are not here. */
const GRASS_TINTED =
  /^(?:grass_block_top|short_grass|grass|tall_grass_(?:top|bottom)|fern|large_fern_(?:top|bottom)|sugar_cane|lily_pad)$/;

/** Vanilla ships these textures grey; the game multiplies them by a biome colour. A fixed plausible one here. */
export function tintFor(textureId: string): number | null {
  const name = textureId.replace(/^[^:]*:block\//, '');
  if (GRASS_TINTED.test(name)) return GRASS;
  if (name === 'spruce_leaves') return 0x619961;
  if (name === 'birch_leaves') return 0x80a755;
  if (/^(oak|jungle|acacia|dark_oak|mangrove)_leaves$|^vine$/.test(name)) return FOLIAGE;
  if (name === 'water_still' || name === 'water_flow') return 0x3f76e4;
  return null;
}

/** Multiplies RGBA pixels in place by an 0xRRGGBB tint; alpha is untouched. */
export function applyTint(pixels: Uint8ClampedArray, rgb: number): void {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    pixels[i] = (pixels[i] as number) * r;
    pixels[i + 1] = (pixels[i + 1] as number) * g;
    pixels[i + 2] = (pixels[i + 2] as number) * b;
  }
}

export const MISSING_COLOUR = '#ff00ff';

/**
 * The fill for a tile. An entry whose image cannot be decoded falls back to its own average colour;
 * magenta is only for a texture id that has no entry at all.
 */
export function tileFallbackColour(color: readonly number[] | undefined): string {
  if (!color) return MISSING_COLOUR;
  const c = (i: number): number => Math.round(Math.max(0, Math.min(1, color[i] ?? 0.5)) * 255);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

export const SKY_COLOUR = 0x87ceeb;
export const FOG_NEAR = 48;
export const FOG_FAR = 140;

/** Classic Minecraft face shading from a face normal: top brightest, bottom darkest, sides between. */
export function faceShade(nx: number, ny: number, nz: number): number {
  if (ny > 0.5) return 1;
  if (ny < -0.5) return 0.5;
  return Math.abs(nx) > Math.abs(nz) ? 0.6 : 0.8;
}
