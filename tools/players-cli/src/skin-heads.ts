import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { MAX_SKIN_BYTES, SkinFileError } from './png.ts';
import { decodeSkinPng, type Rgba } from './png-decode.ts';

/** The same agent id whitelist Glass uses to serve /kino/skins/<id>.png (glass/web/kino/skin-uv.ts). */
const AGENT_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const MAP_ID = /^[a-z][a-z0-9_-]{0,31}$/;

/** The head is the 8x8 face; it is written 4x larger (32x32, nearest neighbour) so the browser's smoothing stays crisp. */
export const HEAD_SCALE = 4;
const FACE = { x: 8, y: 8 };
const HAT = { x: 40, y: 8 };

/** The Java offline-mode UUID of a player name: UUID.nameUUIDFromBytes("OfflinePlayer:" + name). */
export function offlineUuid(name: string): string {
  const b = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x30;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The 8x8 face with the hat layer composed over it (the "over" operator), as RGBA. */
export function composeHead(skin: Rgba): Buffer {
  const out = Buffer.alloc(8 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const f = ((FACE.y + y) * skin.width + FACE.x + x) * 4;
      const h = ((HAT.y + y) * skin.width + HAT.x + x) * 4;
      const ha = (skin.data[h + 3] ?? 0) / 255;
      const fa = (skin.data[f + 3] ?? 0) / 255;
      const oa = ha + fa * (1 - ha);
      const o = (y * 8 + x) * 4;
      for (let k = 0; k < 3; k++) {
        const hv = skin.data[h + k] ?? 0;
        const fv = skin.data[f + k] ?? 0;
        out[o + k] = oa === 0 ? 0 : Math.round((hv * ha + fv * fa * (1 - ha)) / oa);
      }
      out[o + 3] = Math.round(oa * 255);
    }
  }
  return out;
}

/** Encodes RGBA pixels as an 8-bit RGBA PNG, scaled up by nearest neighbour. */
export function encodeScaledPng(rgba: Buffer, size: number, scale: number): Buffer {
  const w = size * scale;
  const rows: Buffer[] = [];
  for (let y = 0; y < w; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / scale) * size + Math.floor(x / scale)) * 4;
      rgba.copy(row, 1 + x * 4, s, s + 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(w, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Writes `<outDir>/maps/<map>/assets/playerheads/<uuid>.png` for every `<agent_id>.png` in the skins dir.
 * Returns one "name uuid" line per head; a file with a bad name or a bad skin is refused (nothing is written for it).
 */
export function writeHeads(skinsDir: string, outDir: string, map: string): string[] {
  if (!MAP_ID.test(map)) throw new SkinFileError('the map id is not a plain id');
  const lines: string[] = [];
  const dest = join(outDir, 'maps', map, 'assets', 'playerheads');
  const files = readdirSync(skinsDir)
    .filter((f) => f.endsWith('.png'))
    .sort();
  for (const file of files) {
    const name = file.slice(0, -4);
    if (!AGENT_ID.test(name)) throw new SkinFileError(`not a valid agent id: ${file}`);
    const path = join(skinsDir, file);
    if (statSync(path).size > MAX_SKIN_BYTES) throw new SkinFileError(`${file} is too large`);
    let head: Buffer;
    try {
      head = composeHead(decodeSkinPng(readFileSync(path)));
    } catch (error) {
      throw new SkinFileError(`${file}: ${error instanceof Error ? error.message : 'bad skin'}`);
    }
    const uuid = offlineUuid(name);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, `${uuid}.png`), encodeScaledPng(head, 8, HEAD_SCALE));
    lines.push(`${name} ${uuid}`);
  }
  return lines;
}
