import { describe, expect, it } from 'vitest';
import { skinAgentId } from '../../src/kino/skins.ts';
import { figureParts, isSlim, type PartName, skinUrl } from '../../web/kino/skin-uv.ts';

const part = (opts: { slim: boolean; legacy: boolean }, name: PartName) => {
  const p = figureParts(opts).find((x) => x.name === name);
  if (!p) throw new Error(`no part ${name}`);
  return p;
};
const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('skin UV table', () => {
  const classic = { slim: false, legacy: false };
  it('head: every face of the 8x8x8 box', () => {
    expect(part(classic, 'head').rects).toEqual({
      top: r(8, 0, 8, 8),
      bottom: r(16, 0, 8, 8),
      right: r(0, 8, 8, 8),
      front: r(8, 8, 8, 8),
      left: r(16, 8, 8, 8),
      back: r(24, 8, 8, 8),
    });
    expect(part(classic, 'hat').rects.front).toEqual(r(40, 8, 8, 8));
  });
  it('body: every face of the 8x12x4 box', () => {
    expect(part(classic, 'body').rects).toEqual({
      top: r(20, 16, 8, 4),
      bottom: r(28, 16, 8, 4),
      right: r(16, 20, 4, 12),
      front: r(20, 20, 8, 12),
      left: r(28, 20, 4, 12),
      back: r(32, 20, 8, 12),
    });
  });
  it('classic arms and legs (64x64)', () => {
    expect(part(classic, 'rightArm').rects).toEqual({
      top: r(44, 16, 4, 4),
      bottom: r(48, 16, 4, 4),
      right: r(40, 20, 4, 12),
      front: r(44, 20, 4, 12),
      left: r(48, 20, 4, 12),
      back: r(52, 20, 4, 12),
    });
    expect(part(classic, 'leftArm').rects.front).toEqual(r(36, 52, 4, 12));
    expect(part(classic, 'rightLeg').rects.front).toEqual(r(4, 20, 4, 12));
    expect(part(classic, 'leftLeg').rects.front).toEqual(r(20, 52, 4, 12));
    expect(part(classic, 'jacket').rects.front).toEqual(r(20, 36, 8, 12));
    expect(part(classic, 'leftSleeve').rects.front).toEqual(r(52, 52, 4, 12));
    expect(part(classic, 'rightPants').rects.front).toEqual(r(4, 36, 4, 12));
  });
  it('slim arms are 3 wide', () => {
    const slim = { slim: true, legacy: false };
    expect(part(slim, 'rightArm').rects).toEqual({
      top: r(44, 16, 3, 4),
      bottom: r(47, 16, 3, 4),
      right: r(40, 20, 4, 12),
      front: r(44, 20, 3, 12),
      left: r(47, 20, 4, 12),
      back: r(51, 20, 3, 12),
    });
    expect(part(slim, 'leftArm').rects.front).toEqual(r(36, 52, 3, 12));
    expect(part(slim, 'leftArm').size).toEqual([3, 12, 4]);
    // The figure's left is +X and the arm hangs against the body.
    expect(part(slim, 'leftArm').centre[0]).toBe(5.5);
    expect(part(slim, 'rightArm').centre[0]).toBe(-5.5);
    expect(part(classic, 'leftArm').centre[0]).toBe(6);
  });
  it('legacy 64x32 skins: left limbs mirror the right and there is no second layer', () => {
    const legacy = { slim: false, legacy: true };
    const names = figureParts(legacy).map((p) => p.name);
    expect(names.sort()).toEqual([
      'body',
      'hat',
      'head',
      'leftArm',
      'leftLeg',
      'rightArm',
      'rightLeg',
    ]);
    const left = part(legacy, 'leftArm');
    expect(left.flip).toBe(true);
    expect(left.rects.front).toEqual(r(44, 20, 4, 12));
    // Mirrored: the left arm's inner (right) face is the right arm's outer-facing left rectangle.
    expect(left.rects.right).toEqual(r(48, 20, 4, 12));
    expect(left.rects.left).toEqual(r(40, 20, 4, 12));
    expect(part(legacy, 'leftLeg').rects.front).toEqual(r(4, 20, 4, 12));
    expect(part(legacy, 'rightArm').flip).toBe(false);
  });
});

describe('slim detection', () => {
  const opaque = () => 255;
  it('is slim when columns 54..55, rows 20..31 are fully transparent (64x64)', () => {
    expect(isSlim(64, 64, (x, y) => (x >= 54 && x <= 55 && y >= 20 && y <= 31 ? 0 : 255))).toBe(
      true,
    );
  });
  it('is classic when any pixel in that block is not transparent', () => {
    expect(isSlim(64, 64, opaque)).toBe(false);
    for (const [px, py] of [
      [54, 20],
      [55, 31],
      [54, 31],
      [55, 20],
    ] as const) {
      expect(isSlim(64, 64, (x, y) => (x === px && y === py ? 1 : 0))).toBe(false);
    }
  });
  it('a pixel just outside the block does not matter', () => {
    expect(isSlim(64, 64, (x, y) => (x === 53 || y === 32 ? 255 : 0))).toBe(true);
  });
  it('a 64x32 skin is always classic', () => {
    expect(isSlim(64, 32, () => 0)).toBe(false);
  });
});

describe('skin id whitelist', () => {
  it('builds a URL for underscore and hyphen ids and agrees with Glass', () => {
    for (const id of ['ag_jason_01', 'ag-zack-01']) {
      const url = skinUrl(id);
      expect(url).toBe(`/kino/skins/${id}.png`);
      expect(skinAgentId(url as string)).toBe(id);
    }
  });
  it('refuses anything Glass refuses', () => {
    for (const id of ['', '../x', 'a/b', 'a.b', 'Ag_X', '_x', 'a b', 'a'.repeat(33), 'a%2fb']) {
      expect(skinUrl(id), id).toBeUndefined();
    }
  });
});
