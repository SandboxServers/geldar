import { crc32, inflateSync } from 'node:zlib';

/** The cap on the uploaded file, in bytes (32 KiB, decision 0172 point 2). */
export const SKIN_MAX_BYTES = 32 * 1024;
/** The only accepted size, in pixels, on both axes. */
export const SKIN_SIZE = 64;

/** Stable refusal codes. The owner sees the code in words; the PNG is never echoed. */
export type SkinRefusal =
  | 'too_large'
  | 'not_png'
  | 'truncated'
  | 'bad_crc'
  | 'disallowed_chunk'
  | 'bad_chunk_order'
  | 'bad_header'
  | 'bad_size'
  | 'bad_bit_depth'
  | 'bad_color_type'
  | 'interlaced'
  | 'bad_compression'
  | 'bad_inflate'
  | 'decompression_bomb'
  | 'bad_pixel_data_size';

export type SkinCheck = { ok: true } | { ok: false; code: SkinRefusal };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ALLOWED_CHUNKS = new Set(['IHDR', 'IDAT', 'IEND']);

interface Chunk {
  type: string;
  data: Uint8Array;
}

function refuse(code: SkinRefusal): SkinCheck {
  return { ok: false, code };
}

function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/** Splits the file into chunks. Returns a refusal instead when the layout or a CRC is wrong. */
function readChunks(bytes: Uint8Array): Chunk[] | SkinRefusal {
  const chunks: Chunk[] = [];
  let pos = SIGNATURE.length;
  while (pos < bytes.length) {
    if (pos + 8 > bytes.length) return 'truncated';
    const length = readU32(bytes, pos);
    const typeBytes = bytes.subarray(pos + 4, pos + 8);
    const type = String.fromCharCode(...typeBytes);
    if (!/^[A-Za-z]{4}$/.test(type)) return 'bad_chunk_order';
    const end = pos + 12 + length;
    if (end > bytes.length) return 'truncated';
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    const stored = readU32(bytes, pos + 8 + length);
    if (crc32(bytes.subarray(pos + 4, pos + 8 + length)) !== stored) return 'bad_crc';
    if (!ALLOWED_CHUNKS.has(type)) return 'disallowed_chunk';
    chunks.push({ type, data });
    pos = end;
  }
  return chunks;
}

function checkOrder(chunks: Chunk[]): SkinRefusal | null {
  if (chunks.length < 3) return 'bad_chunk_order';
  if (chunks[0].type !== 'IHDR' || chunks[chunks.length - 1].type !== 'IEND')
    return 'bad_chunk_order';
  if (chunks[0].data.length !== 13) return 'bad_header';
  if (chunks[chunks.length - 1].data.length !== 0) return 'bad_chunk_order';
  let idat = 0;
  for (const chunk of chunks.slice(1, -1)) {
    if (chunk.type === 'IHDR' || chunk.type === 'IEND') return 'bad_chunk_order';
    idat++;
  }
  return idat > 0 ? null : 'bad_chunk_order';
}

/**
 * Checks an uploaded skin. Pure: no I/O, no logging. It accepts one PNG that is exactly 64x64, 8-bit RGB or RGBA,
 * at most 32 KiB, with only IHDR, IDAT and IEND chunks, no interlacing, and an inflated pixel stream of exactly
 * the expected size. Any other input is refused with a stable code. Errors inside are refusals, never throws.
 */
export function checkSkinPng(bytes: Uint8Array): SkinCheck {
  if (bytes.length > SKIN_MAX_BYTES) return refuse('too_large');
  if (bytes.length < SIGNATURE.length) return refuse('not_png');
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) return refuse('not_png');
  }
  const chunks = readChunks(bytes);
  if (!Array.isArray(chunks)) return refuse(chunks);
  const order = checkOrder(chunks);
  if (order) return refuse(order);

  const header = chunks[0].data;
  const width = readU32(header, 0);
  const height = readU32(header, 4);
  const bitDepth = header[8];
  const colorType = header[9];
  if (width !== SKIN_SIZE || height !== SKIN_SIZE) return refuse('bad_size');
  if (bitDepth !== 8) return refuse('bad_bit_depth');
  if (colorType !== 2 && colorType !== 6) return refuse('bad_color_type');
  if (header[10] !== 0 || header[11] !== 0) return refuse('bad_compression');
  if (header[12] !== 0) return refuse('interlaced');

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const expected = SKIN_SIZE * (1 + SKIN_SIZE * bytesPerPixel);
  const idatBytes = Buffer.concat(
    chunks.filter((c) => c.type === 'IDAT').map((c) => Buffer.from(c.data)),
  );
  let pixels: Buffer;
  try {
    pixels = inflateSync(idatBytes, { maxOutputLength: expected + 1 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    return refuse(code === 'ERR_BUFFER_TOO_LARGE' ? 'decompression_bomb' : 'bad_inflate');
  }
  if (pixels.length !== expected) return refuse('bad_pixel_data_size');
  return { ok: true };
}
