/**
 * The app icon of the installable Thought Stream page: the sigil of the name "Glass" (the same generator
 * that draws the agents, glass/src/render-sigil.ts), in the page's amber on its dark ground. This file
 * draws the three PNGs the manifest names, and app-icon.test.ts holds the committed files to it.
 *
 *   node glass/test/app-icon.ts        # writes glass/public/icons/*.png
 *
 * No image library: a PNG here is one zlib stream of unfiltered RGBA rows. Test-only: nothing in the
 * Glass runtime imports this file.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { SIGIL_CELLS, sigilOf } from '../src/render-sigil.ts';

export interface IconSpec {
  file: string;
  /** Width and height in pixels. */
  size: number;
  /** The side of one sigil cell in pixels. The sigil is centred. */
  cell: number;
}

/**
 * The maskable icon keeps the sigil inside the middle 80% circle a launcher may crop to: its corner cell
 * is 198px from the centre, under the 204.8px radius.
 */
export const ICONS: readonly IconSpec[] = [
  { file: 'icon-192.png', size: 192, cell: 24 },
  { file: 'icon-512.png', size: 512, cell: 64 },
  { file: 'maskable-512.png', size: 512, cell: 56 },
];

/** The page's dark ground and its one accent (app.css: --bg and --accent of the dark theme). */
const GROUND = [0x0c, 0x0f, 0x0b] as const;
const INK = [0xf5, 0xa5, 0x24] as const;

/** The icon as RGBA bytes, row by row. */
export function iconPixels(spec: IconSpec): Uint8Array {
  const { cells } = sigilOf('Glass');
  const origin = (spec.size - SIGIL_CELLS * spec.cell) / 2;
  const rgba = new Uint8Array(spec.size * spec.size * 4);
  for (let y = 0; y < spec.size; y += 1) {
    for (let x = 0; x < spec.size; x += 1) {
      const cx = Math.floor((x - origin) / spec.cell);
      const cy = Math.floor((y - origin) / spec.cell);
      const inside = cx >= 0 && cy >= 0 && cx < SIGIL_CELLS && cy < SIGIL_CELLS;
      const colour = inside && cells[cy * SIGIL_CELLS + cx] === true ? INK : GROUND;
      rgba.set([...colour, 0xff], (y * spec.size + x) * 4);
    }
  }
  return rgba;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, sum]);
}

/** A square 8-bit RGBA PNG: every row has filter type 0 (none). */
export function encodePng(size: number, rgba: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const row = size * 4;
  const raw = Buffer.alloc((row + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Reads back a PNG this file wrote: its size and its RGBA bytes. Any other PNG shape is an error. */
export function decodePng(png: Buffer): { size: number; rgba: Uint8Array } {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let at = 8;
  let size = 0;
  const data: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      size = body.readUInt32BE(0);
      const square = body.readUInt32BE(4) === size;
      if (!square || body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
        throw new Error('not a square 8-bit RGBA PNG');
      }
    }
    if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const row = size * 4;
  const rgba = new Uint8Array(row * size);
  for (let y = 0; y < size; y += 1) {
    if (raw[y * (row + 1)] !== 0) throw new Error('a row uses a filter');
    rgba.set(raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1)), y * row);
  }
  return { size, rgba };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const spec of ICONS) {
    const target = new URL(`../public/icons/${spec.file}`, import.meta.url);
    writeFileSync(target, encodePng(spec.size, iconPixels(spec)));
    console.log(`wrote ${spec.file}`);
  }
}
