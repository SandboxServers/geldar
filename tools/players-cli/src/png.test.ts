import { describe, expect, it } from 'vitest';
import { MAX_SKIN_BYTES, SkinFileError, validateSkinPng } from './png.ts';
import { makeSkinPng } from './skin-fixture.ts';

describe('validateSkinPng', () => {
  it('accepts a 64x64 RGBA skin and a legacy 64x32 skin', () => {
    expect(validateSkinPng(makeSkinPng())).toEqual({ width: 64, height: 64, colorType: 6 });
    expect(validateSkinPng(makeSkinPng({ height: 32 }))).toEqual({
      width: 64,
      height: 32,
      colorType: 6,
    });
  });

  it('accepts an RGB skin without alpha', () => {
    expect(validateSkinPng(makeSkinPng({ colorType: 2 })).colorType).toBe(2);
  });

  it('refuses any other size', () => {
    expect(() => validateSkinPng(makeSkinPng({ width: 128, height: 128 }))).toThrow(SkinFileError);
    expect(() => validateSkinPng(makeSkinPng({ width: 64, height: 48 }))).toThrow('64x64 or 64x32');
  });

  it('refuses extra ancillary chunks such as tEXt', () => {
    const text = { type: 'tEXt', data: Buffer.from('Author\u0000someone') };
    expect(() => validateSkinPng(makeSkinPng({ extraChunks: [text] }))).toThrow(
      'only contain IHDR, IDAT and IEND',
    );
  });

  it('refuses a chunk whose CRC does not match', () => {
    expect(() => validateSkinPng(makeSkinPng({ badCrc: true }))).toThrow('bad CRC');
  });

  it('refuses pixel data of the wrong length', () => {
    expect(() => validateSkinPng(makeSkinPng({ pixelBytes: 100 }))).toThrow(
      'does not match its size',
    );
  });

  it('refuses interlaced, 16-bit and palette skins', () => {
    expect(() => validateSkinPng(makeSkinPng({ interlace: 1 }))).toThrow('not be interlaced');
    expect(() => validateSkinPng(makeSkinPng({ bitDepth: 16 }))).toThrow('8-bit RGB or RGBA');
    expect(() => validateSkinPng(makeSkinPng({ colorType: 3 }))).toThrow('8-bit RGB or RGBA');
  });

  it('refuses a file that is not a PNG, and one over the size cap', () => {
    expect(() => validateSkinPng(Buffer.from('GIF89a'))).toThrow('not a PNG');
    const big = Buffer.concat([makeSkinPng(), Buffer.alloc(MAX_SKIN_BYTES)]);
    expect(() => validateSkinPng(big)).toThrow('larger than');
  });
});
