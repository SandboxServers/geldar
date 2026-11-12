import { crc32, inflateSync } from 'node:zlib';
import { MAX_SKIN_BYTES, SKIN_SIZES, SkinFileError } from './png.ts';

/** Straight RGBA pixels, row-major, four bytes per pixel. */
export interface Rgba {
  width: number;
  height: number;
  data: Buffer;
}

/** Samples per pixel and the bit depths each colour type may use: palette (3) takes 1, 2, 4 or 8 bits. */
const LAYOUT: ReadonlyMap<number, { channels: number; depths: readonly number[] }> = new Map([
  [0, { channels: 1, depths: [8] }],
  [2, { channels: 3, depths: [8] }],
  [3, { channels: 1, depths: [1, 2, 4, 8] }],
  [4, { channels: 2, depths: [8] }],
  [6, { channels: 4, depths: [8] }],
]);

/** Only these chunks may appear in a skin read by `skin heads`. */
const ALLOWED_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Chunk {
  type: string;
  data: Buffer;
}

/**
 * Decodes a skin PNG to RGBA for `skin heads`. It reads 8-bit grey, grey+alpha, RGB and RGBA, and palette images
 * of 1, 2, 4 or 8 bits, with an optional tRNS (transparency). The size, interlace, CRC and length rules are those of
 * `validateSkinPng`, which the upload path keeps strict. Throws {@link SkinFileError}.
 */
export function decodeSkinPng(bytes: Buffer): Rgba {
  if (bytes.length > MAX_SKIN_BYTES) {
    throw new SkinFileError(`the skin file is larger than ${MAX_SKIN_BYTES} bytes`);
  }
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new SkinFileError('the skin file is not a PNG');
  }
  const chunks = readChunks(bytes);
  const header = chunks[0];
  if (chunks.length < 3 || header?.type !== 'IHDR' || header.data.length !== 13) {
    throw new SkinFileError('the PNG must start with an IHDR chunk');
  }
  if (chunks[chunks.length - 1]?.type !== 'IEND') {
    throw new SkinFileError('the PNG must end with an IEND chunk');
  }
  const width = header.data.readUInt32BE(0);
  const height = header.data.readUInt32BE(4);
  const depth = header.data.readUInt8(8);
  const colorType = header.data.readUInt8(9);
  if (!SKIN_SIZES.some(([w, h]) => w === width && h === height)) {
    throw new SkinFileError('the skin must be 64x64 or 64x32 pixels');
  }
  const layout = LAYOUT.get(colorType);
  if (layout === undefined || !layout.depths.includes(depth)) {
    throw new SkinFileError(
      'the skin must be 8-bit grey, grey+alpha, RGB or RGBA, or a palette of 1, 2, 4 or 8 bits',
    );
  }
  if (header.data.readUInt8(10) !== 0 || header.data.readUInt8(11) !== 0) {
    throw new SkinFileError('the PNG uses an unknown compression or filter method');
  }
  if (header.data.readUInt8(12) !== 0) {
    throw new SkinFileError('the skin must not be interlaced');
  }
  const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data;
  const trns = chunks.find((chunk) => chunk.type === 'tRNS')?.data;
  if (colorType === 3) {
    if (palette === undefined || palette.length === 0 || palette.length % 3 !== 0) {
      throw new SkinFileError('a palette skin needs a PLTE chunk of RGB entries');
    }
  } else if (palette !== undefined) {
    throw new SkinFileError('only a palette skin may carry a PLTE chunk');
  }
  if (trns !== undefined) {
    if (colorType === 4 || colorType === 6) {
      throw new SkinFileError('tRNS is not allowed on a grey+alpha or RGBA skin');
    }
    const fits =
      colorType === 0
        ? trns.length === 2
        : colorType === 2
          ? trns.length === 6
          : trns.length <= (palette?.length ?? 0) / 3;
    if (!fits) throw new SkinFileError('the tRNS chunk does not match the skin');
  }
  const rowBytes = Math.ceil((width * layout.channels * depth) / 8);
  const bpp = Math.max(1, (layout.channels * depth) / 8);
  const expected = height * (1 + rowBytes);
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = inflateOrRefuse(idat, expected);
  if (raw.length !== expected) {
    throw new SkinFileError('the skin pixel data does not match its size');
  }
  const samples = unfilter(raw, height, rowBytes, bpp);
  const data = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const row = y * rowBytes;
      const o = (y * width + x) * 4;
      if (colorType === 3 && palette !== undefined) {
        const index = sampleAt(samples, row, x, depth);
        if (index * 3 >= palette.length) {
          throw new SkinFileError('the skin palette index is out of range');
        }
        data.set(palette.subarray(index * 3, index * 3 + 3), o);
        data[o + 3] = trns?.[index] ?? 255;
      } else {
        const s = (k: number) => sampleAt(samples, row, x * layout.channels + k, 8);
        const grey = colorType === 0 || colorType === 4;
        const r = s(0);
        const g = grey ? r : s(1);
        const b = grey ? r : s(2);
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        if (colorType === 4) data[o + 3] = s(1);
        if (colorType === 6) data[o + 3] = s(3);
        if (trns !== undefined && colorType === 0 && r === trns.readUInt16BE(0)) data[o + 3] = 0;
        if (trns !== undefined && colorType === 2) {
          const key = [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)];
          if (r === key[0] && g === key[1] && b === key[2]) data[o + 3] = 0;
        }
      }
    }
  }
  return { width, height, data };
}

/** The sample at `index` in a scanline starting at byte `row`; sub-byte samples are packed most significant bit first. */
function sampleAt(samples: Buffer, row: number, index: number, depth: number): number {
  if (depth === 8) return samples[row + index] ?? 0;
  const bit = index * depth;
  const byte = samples[row + (bit >> 3)] ?? 0;
  return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
}

/** Reverses the scanline filters. `bpp` is the filter distance in bytes (1 for sub-byte samples). */
function unfilter(raw: Buffer, height: number, rowBytes: number, bpp: number): Buffer {
  const out = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)] ?? 0;
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const cur = raw[src + i] ?? 0;
      const a = i >= bpp ? (out[dst + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (out[dst - rowBytes + i] ?? 0) : 0;
      const c = i >= bpp && y > 0 ? (out[dst - rowBytes + i - bpp] ?? 0) : 0;
      out[dst + i] = (cur + predict(filter, a, b, c)) & 0xff;
    }
  }
  return out;
}

function predict(filter: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4: {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    default:
      throw new SkinFileError('the skin PNG uses an unknown filter');
  }
}

/** Splits the PNG into chunks, checking each length, its CRC and that only allowed chunks appear. */
function readChunks(bytes: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new SkinFileError('the PNG is truncated');
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    const end = offset + 12 + length;
    if (end > bytes.length) throw new SkinFileError('the PNG is truncated');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(end - 4)) {
      throw new SkinFileError('a PNG chunk has a bad CRC');
    }
    if (!ALLOWED_CHUNKS.has(type)) {
      throw new SkinFileError(
        'the skin PNG may only contain IHDR, PLTE, tRNS, IDAT and IEND chunks',
      );
    }
    chunks.push({ type, data });
    offset = end;
  }
  return chunks;
}

/** Inflates the pixel data, refusing a stream that does not decode or that is larger than the image needs. */
function inflateOrRefuse(idat: Buffer, expected: number): Buffer {
  try {
    return inflateSync(idat, { maxOutputLength: expected });
  } catch {
    throw new SkinFileError('the skin pixel data does not decode to the image size');
  }
}
