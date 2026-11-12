import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SKIN_BYTES, readSkinPng, skinAgentId } from './skins.ts';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
]);

describe('skinAgentId', () => {
  it('resolves only /kino/skins/<agent_id>.png', () => {
    expect(skinAgentId('/kino/skins/ag_jason_01.png')).toBe('ag_jason_01');
    expect(skinAgentId('/kino/skins/ag-zack-01.png')).toBe('ag-zack-01');
  });

  it('refuses traversal, encoding, subpaths, dots and other extensions', () => {
    for (const p of [
      '/kino/skins/../secrets/x.png',
      '/kino/skins/..%2Fx.png',
      '/kino/skins/a/b.png',
      '/kino/skins/.png',
      '/kino/skins/ag_jason_01.png.png',
      '/kino/skins/ag.jason.png',
      '/kino/skins/AG_JASON.png',
      '/kino/skins/ag_jason_01.jpg',
      '/kino/skins/',
      '/kino/skinsx/ag_jason_01.png',
      `/kino/skins/${'a'.repeat(33)}.png`,
    ])
      expect(skinAgentId(p), p).toBeUndefined();
  });
});

describe('readSkinPng', () => {
  it('serves a PNG file and refuses an invalid id, a missing file, a big file and a non-PNG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skins-'));
    writeFileSync(join(dir, 'ag_a.png'), PNG);
    writeFileSync(join(dir, 'ag_big.png'), Buffer.concat([PNG, Buffer.alloc(MAX_SKIN_BYTES)]));
    writeFileSync(join(dir, 'ag_text.png'), 'not a png at all');
    expect(readSkinPng(dir, 'ag_a')?.equals(PNG)).toBe(true);
    expect(readSkinPng(dir, '../ag_a')).toBeUndefined();
    expect(readSkinPng(dir, 'ag_missing')).toBeUndefined();
    expect(readSkinPng(dir, 'ag_big')).toBeUndefined();
    expect(readSkinPng(dir, 'ag_text')).toBeUndefined();
  });
});
