import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkSkinPng, SKIN_MAX_BYTES, type SkinRefusal } from './skin-validate.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function header(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace = 0,
  method = 0,
): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  data[10] = method;
  data[11] = method;
  data[12] = interlace;
  return data;
}

/** The pixel stream a valid 64x64 image inflates to: one filter byte per row, then the pixels. */
function pixelBytes(colorType: number): Buffer {
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  return Buffer.alloc(64 * (1 + 64 * bytesPerPixel));
}

function png(parts: {
  ihdr?: Buffer;
  idat?: Buffer;
  extra?: Buffer[];
  iend?: Buffer;
  colorType?: number;
}): Buffer {
  const colorType = parts.colorType ?? 2;
  const idat = parts.idat ?? deflateSync(pixelBytes(colorType));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', parts.ihdr ?? header(64, 64, 8, colorType)),
    ...(parts.extra ?? []),
    chunk('IDAT', idat),
    parts.iend ?? chunk('IEND', Buffer.alloc(0)),
  ]);
}

function refusalOf(bytes: Buffer): SkinRefusal | 'ok' {
  const result = checkSkinPng(bytes);
  return result.ok ? 'ok' : result.code;
}

/** Deterministic bytes that do not compress well, so the compressed length can be steered. */
function noise(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 16;
  }
  return out;
}

/** A valid RGB PNG of exactly 32 KiB, found by seed: the IDAT is split into n pieces so the file lands on the cap. */
function exactCapPng(): Buffer {
  const target = SKIN_MAX_BYTES;
  for (let seed = 1; seed < 500; seed++) {
    const raw = noise(pixelBytes(2).length, seed);
    // Each row's filter type byte must be 0 to 4 for the image to be valid; the pixels stay noise.
    for (let row = 0; row < 64; row++) raw[row * (1 + 64 * 3)] = 0;
    const comp = deflateSync(raw);
    // file = 8 signature + 25 IHDR + 12n per IDAT overhead + comp + 12 IEND
    const rest = target - 45 - comp.length;
    if (rest <= 0 || rest % 12 !== 0) continue;
    const n = rest / 12;
    if (n < 1 || n > comp.length) continue;
    const base = Math.floor(comp.length / n);
    let at = 0;
    const idats: Buffer[] = [];
    for (let i = 0; i < n; i++) {
      const size = i < comp.length - base * n ? base + 1 : base;
      idats.push(chunk('IDAT', comp.subarray(at, at + size)));
      at += size;
    }
    return Buffer.concat([
      SIGNATURE,
      chunk('IHDR', header(64, 64, 8, 2)),
      ...idats,
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
  throw new Error('no seed gave an exact 32 KiB file');
}

describe('checkSkinPng', () => {
  it('accepts a 64x64 RGB PNG and a 64x64 RGBA PNG', () => {
    expect(refusalOf(png({ colorType: 2 }))).toBe('ok');
    expect(refusalOf(png({ colorType: 6, ihdr: header(64, 64, 8, 6) }))).toBe('ok');
  });

  it('refuses a 64x32 image and a 128x128 image as bad_size', () => {
    expect(refusalOf(png({ ihdr: header(64, 32, 8, 2) }))).toBe('bad_size');
    expect(refusalOf(png({ ihdr: header(128, 128, 8, 2) }))).toBe('bad_size');
  });

  it('refuses 16-bit depth as bad_bit_depth', () => {
    expect(refusalOf(png({ ihdr: header(64, 64, 16, 2) }))).toBe('bad_bit_depth');
  });

  it('refuses a palette image as bad_color_type', () => {
    expect(refusalOf(png({ ihdr: header(64, 64, 8, 3) }))).toBe('bad_color_type');
  });

  it('refuses an interlaced image as interlaced', () => {
    expect(refusalOf(png({ ihdr: header(64, 64, 8, 2, 1) }))).toBe('interlaced');
  });

  it('refuses a non-zero compression or filter method as bad_compression', () => {
    expect(refusalOf(png({ ihdr: header(64, 64, 8, 2, 0, 1) }))).toBe('bad_compression');
  });

  it('refuses a tEXt chunk as disallowed_chunk, even with a valid CRC', () => {
    const text = chunk('tEXt', Buffer.from('Comment\0smuggled'));
    expect(refusalOf(png({ extra: [text] }))).toBe('disallowed_chunk');
  });

  it('refuses a chunk with a bad CRC as bad_crc', () => {
    const iend = chunk('IEND', Buffer.alloc(0));
    iend[iend.length - 1] ^= 0xff;
    expect(refusalOf(png({ iend }))).toBe('bad_crc');
  });

  it('refuses a truncated file as truncated', () => {
    const full = png({});
    expect(refusalOf(full.subarray(0, full.length - 5))).toBe('truncated');
  });

  it('refuses a decompression bomb as decompression_bomb', () => {
    const bomb = deflateSync(Buffer.alloc(11 * 1024 * 1024));
    expect(refusalOf(png({ idat: bomb }))).toBe('decompression_bomb');
  });

  it('refuses a stream that does not inflate as bad_inflate', () => {
    expect(refusalOf(png({ idat: Buffer.from('not a zlib stream at all') }))).toBe('bad_inflate');
  });

  it('refuses a pixel stream one byte short as bad_pixel_data_size', () => {
    const short = deflateSync(Buffer.alloc(pixelBytes(2).length - 1));
    expect(refusalOf(png({ idat: short }))).toBe('bad_pixel_data_size');
  });

  it('refuses bytes after the end of the zlib stream in IDAT as bad_inflate', () => {
    const smuggled = Buffer.concat([deflateSync(pixelBytes(2)), Buffer.from('SMUGGLED')]);
    expect(refusalOf(png({ idat: smuggled }))).toBe('bad_inflate');
  });

  it('refuses two zlib streams concatenated in IDAT as bad_inflate', () => {
    const twice = Buffer.concat([deflateSync(pixelBytes(2)), deflateSync(pixelBytes(2))]);
    expect(refusalOf(png({ idat: twice }))).toBe('bad_inflate');
  });

  it('refuses a filter type above 4 on the first row and on the last row as bad_filter', () => {
    const stride = 1 + 64 * 3;
    for (const row of [0, 63]) {
      const pixels = pixelBytes(2);
      pixels[row * stride] = 5;
      expect(refusalOf(png({ idat: deflateSync(pixels) }))).toBe('bad_filter');
    }
  });

  it('accepts filter types 0 to 4 on every row', () => {
    const stride = 1 + 64 * 3;
    const pixels = pixelBytes(2);
    for (let row = 0; row < 64; row++) pixels[row * stride] = row % 5;
    expect(refusalOf(png({ idat: deflateSync(pixels) }))).toBe('ok');
  });

  it('accepts an RGBA pixel stream whose alpha bytes are 255 and whose filters are 0', () => {
    const stride = 1 + 64 * 4;
    const pixels = Buffer.alloc(64 * stride, 255);
    for (let row = 0; row < 64; row++) pixels[row * stride] = 0;
    const bytes = png({ colorType: 6, ihdr: header(64, 64, 8, 6), idat: deflateSync(pixels) });
    expect(refusalOf(bytes)).toBe('ok');
  });

  it('refuses an RGBA pixel stream with filter type 5 on the last row as bad_filter', () => {
    const stride = 1 + 64 * 4;
    const pixels = Buffer.alloc(64 * stride, 255);
    for (let row = 0; row < 64; row++) pixels[row * stride] = 0;
    pixels[63 * stride] = 5;
    const bytes = png({ colorType: 6, ihdr: header(64, 64, 8, 6), idat: deflateSync(pixels) });
    expect(refusalOf(bytes)).toBe('bad_filter');
  });

  it('refuses input that is not a PNG, including empty input', () => {
    expect(refusalOf(Buffer.alloc(0))).toBe('not_png');
    expect(refusalOf(Buffer.from('GIF89a' + '\0'.repeat(40)))).toBe('not_png');
  });

  it('refuses a file with no IEND, or with IEND before IDAT, as bad_chunk_order', () => {
    const noEnd = Buffer.concat([
      SIGNATURE,
      chunk('IHDR', header(64, 64, 8, 2)),
      chunk('IDAT', deflateSync(pixelBytes(2))),
    ]);
    expect(refusalOf(noEnd)).toBe('bad_chunk_order');
    const early = Buffer.concat([
      SIGNATURE,
      chunk('IHDR', header(64, 64, 8, 2)),
      chunk('IEND', Buffer.alloc(0)),
      chunk('IDAT', deflateSync(pixelBytes(2))),
    ]);
    expect(refusalOf(early)).toBe('bad_chunk_order');
  });

  it('accepts a file of exactly 32 KiB and refuses one byte more as too_large', () => {
    const exact = exactCapPng();
    expect(exact.length).toBe(SKIN_MAX_BYTES);
    expect(refusalOf(exact)).toBe('ok');
    expect(refusalOf(Buffer.concat([exact, Buffer.alloc(1)]))).toBe('too_large');
  });
});
