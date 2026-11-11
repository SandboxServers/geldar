// palette-v1 decoding (kino-feed.schema.json): 4096 cells, index = (y * 16 + z) * 16 + x, indices
// packed LSB first, `bits` wide, base64 data. bits 0 means one palette entry and empty data.

export const SECTION_CELLS = 4096;

export interface PaletteSection {
  readonly palette: readonly string[];
  readonly bits: number;
  readonly data: string;
}

export function cellIndex(x: number, y: number, z: number): number {
  return (y * 16 + z) * 16 + x;
}

function base64Bytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Unpacks a section to 4096 palette indices. Throws on a malformed section. */
export function decodePaletteIndices(section: PaletteSection): Uint16Array {
  const { palette, bits } = section;
  if (!Number.isInteger(bits) || bits < 0 || bits > 12) throw new Error(`bad bits ${bits}`);
  if (palette.length < 1) throw new Error('empty palette');
  const out = new Uint16Array(SECTION_CELLS);
  if (bits === 0) {
    if (palette.length !== 1 || section.data !== '')
      throw new Error('bits 0 needs one entry, no data');
    return out;
  }
  const bytes = base64Bytes(section.data);
  if (bytes.length !== Math.ceil((SECTION_CELLS * bits) / 8))
    throw new Error('data length does not match bits');
  const mask = (1 << bits) - 1;
  for (let i = 0; i < SECTION_CELLS; i++) {
    let value = 0;
    const start = i * bits;
    for (let b = 0; b < bits; b++) {
      const k = start + b;
      value |= (((bytes[k >> 3] ?? 0) >> (k & 7)) & 1) << b;
    }
    const idx = value & mask;
    if (idx >= palette.length) throw new Error(`index ${idx} outside palette`);
    out[i] = idx;
  }
  return out;
}

/** Packs indices the same way (used by tests and the dev feed). */
export function encodePaletteIndices(indices: ArrayLike<number>, bits: number): string {
  if (bits === 0) return '';
  const bytes = new Uint8Array(Math.ceil((SECTION_CELLS * bits) / 8));
  for (let i = 0; i < SECTION_CELLS; i++) {
    for (let b = 0; b < bits; b++) {
      if (((indices[i] ?? 0) >> b) & 1) {
        const k = i * bits + b;
        bytes[k >> 3] = (bytes[k >> 3] ?? 0) | (1 << (k & 7));
      }
    }
  }
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}
