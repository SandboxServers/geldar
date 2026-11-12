import { crc32, deflateSync } from 'node:zlib';

export interface PngOptions {
  width?: number;
  height?: number;
  bitDepth?: number;
  colorType?: number;
  interlace?: number;
  extraChunks?: Array<{ type: string; data: Buffer }>;
  badCrc?: boolean;
  pixelBytes?: number;
}

/** Builds a PNG from chunks, so a test can break exactly one thing. Used by the tests only. */
export function makeSkinPng(options: PngOptions = {}): Buffer {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const colorType = options.colorType ?? 6;
  const channels = colorType === 2 ? 3 : 4;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = options.bitDepth ?? 8;
  header[9] = colorType;
  header[12] = options.interlace ?? 0;
  const pixels = Buffer.alloc(options.pixelBytes ?? height * (1 + width * channels));
  const chunks = [
    { type: 'IHDR', data: header },
    ...(options.extraChunks ?? []),
    { type: 'IDAT', data: deflateSync(pixels) },
    { type: 'IEND', data: Buffer.alloc(0) },
  ];
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const chunk of chunks) {
    const typeAndData = Buffer.concat([Buffer.from(chunk.type, 'latin1'), chunk.data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(chunk.data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(
      (crc32(typeAndData) ^ (options.badCrc && chunk.type === 'IDAT' ? 1 : 0)) >>> 0,
      0,
    );
    parts.push(length, typeAndData, crc);
  }
  return Buffer.concat(parts);
}

export interface RawPngOptions {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  /** Scanlines, each one filter byte followed by its sample bytes. */
  rows: Buffer[];
  palette?: Buffer;
  trns?: Buffer;
  interlace?: number;
  extraChunks?: Array<{ type: string; data: Buffer }>;
}

/** Builds a PNG from raw scanlines, with optional PLTE and tRNS chunks. Used by the tests only. */
export function makeRawPng(options: RawPngOptions): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(options.width, 0);
  header.writeUInt32BE(options.height, 4);
  header[8] = options.bitDepth;
  header[9] = options.colorType;
  header[12] = options.interlace ?? 0;
  const chunks = [
    { type: 'IHDR', data: header },
    ...(options.palette ? [{ type: 'PLTE', data: options.palette }] : []),
    ...(options.trns ? [{ type: 'tRNS', data: options.trns }] : []),
    ...(options.extraChunks ?? []),
    { type: 'IDAT', data: deflateSync(Buffer.concat(options.rows)) },
    { type: 'IEND', data: Buffer.alloc(0) },
  ];
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const chunk of chunks) {
    const typeAndData = Buffer.concat([Buffer.from(chunk.type, 'latin1'), chunk.data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(chunk.data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
    parts.push(length, typeAndData, crc);
  }
  return Buffer.concat(parts);
}

/**
 * Scanlines with filter type 0 and one sample per pixel at `depth` bits, packed most significant bit first.
 * `at(x, y)` gives the sample value.
 */
export function packRows(
  width: number,
  height: number,
  depth: number,
  at: (x: number, y: number) => number,
): Buffer[] {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + Math.ceil((width * depth) / 8));
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      const i = 1 + (bit >> 3);
      row[i] = (row[i] ?? 0) | (at(x, y) << (8 - depth - (bit & 7)));
    }
    rows.push(row);
  }
  return rows;
}
