import { crc32, inflateSync } from 'node:zlib';

/** The largest skin file the tool reads. Mojang's own upload limit is 24 KiB, so a bigger file is refused. */
export const MAX_SKIN_BYTES = 24 * 1024;

/** The two skin sizes Minecraft reads: the current 64x64 and the legacy 64x32. */
export const SKIN_SIZES: ReadonlyArray<readonly [number, number]> = [
  [64, 64],
  [64, 32],
];

/** The colour types a skin may use: RGB (2) and RGBA (6), both 8 bits per channel. */
const ALLOWED_COLOR_TYPES: ReadonlyMap<number, number> = new Map([
  [2, 3],
  [6, 4],
]);

/** The only chunks a skin may carry. Anything else (text, time, colour profiles, ...) is refused. */
const ALLOWED_CHUNKS = new Set(['IHDR', 'IDAT', 'IEND']);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A refusal with a fixed message: it never echoes file content. */
export class SkinFileError extends Error {}

export interface SkinDimensions {
  width: number;
  height: number;
  colorType: number;
}

/**
 * Checks that the bytes are a PNG that Minecraft can read as a player skin: a 64x64 or 64x32 image, 8 bits per
 * channel, not interlaced, with only IHDR, IDAT and IEND chunks, valid CRCs, and pixel data of exactly the
 * expected length. Returns the dimensions; throws {@link SkinFileError} otherwise.
 */
export function validateSkinPng(bytes: Buffer): SkinDimensions {
  if (bytes.length > MAX_SKIN_BYTES) {
    throw new SkinFileError(`the skin file is larger than ${MAX_SKIN_BYTES} bytes`);
  }
  if (
    bytes.length < PNG_SIGNATURE.length ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
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
  const bitDepth = header.data.readUInt8(8);
  const colorType = header.data.readUInt8(9);
  const interlace = header.data.readUInt8(12);
  if (!SKIN_SIZES.some(([w, h]) => w === width && h === height)) {
    throw new SkinFileError('the skin must be 64x64 or 64x32 pixels');
  }
  const channels = ALLOWED_COLOR_TYPES.get(colorType);
  if (channels === undefined || bitDepth !== 8) {
    throw new SkinFileError('the skin must be 8-bit RGB or RGBA');
  }
  if (interlace !== 0) {
    throw new SkinFileError('the skin must not be interlaced');
  }
  const idat = Buffer.concat(
    chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data),
  );
  const expected = height * (1 + width * channels);
  const pixels = inflateOrRefuse(idat, expected);
  if (pixels.length !== expected) {
    throw new SkinFileError('the skin pixel data does not match its size');
  }
  return { width, height, colorType };
}

interface Chunk {
  type: string;
  data: Buffer;
}

/** Splits the PNG into chunks, checking each length, its CRC and that only allowed chunks appear. */
function readChunks(bytes: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new SkinFileError('the PNG is truncated');
    }
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    const end = offset + 12 + length;
    if (end > bytes.length) {
      throw new SkinFileError('the PNG is truncated');
    }
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const crc = bytes.readUInt32BE(end - 4);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== crc) {
      throw new SkinFileError('a PNG chunk has a bad CRC');
    }
    if (!ALLOWED_CHUNKS.has(type)) {
      throw new SkinFileError('the skin PNG may only contain IHDR, IDAT and IEND chunks');
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
