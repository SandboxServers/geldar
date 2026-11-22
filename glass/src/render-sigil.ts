/**
 * The agent sigil: a 5 by 5 pixel identicon, mirrored left to right, made from the agent's name. It is the
 * page's only picture, and it is drawn on a small canvas, so the policy can keep refusing every image the
 * page might be made to load. The name is hashed; no part of it reaches a style, an attribute or markup.
 *
 * This file is served to the browser after type stripping, so it stays erasable TypeScript.
 */

/** Cells on one side of the sigil. */
export const SIGIL_CELLS = 5;
/** The canvas bitmap: the cells plus a one-cell margin on every side. CSS scales it, pixelated. */
export const SIGIL_SIZE = SIGIL_CELLS + 2;

export interface Sigil {
  /** The hue of both colours, 0 to 359. */
  hue: number;
  /** The lit cells, row by row, SIGIL_CELLS * SIGIL_CELLS of them. */
  cells: boolean[];
}

/** The 2D context members the sigil uses. */
export interface SigilContext {
  fillStyle: unknown;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/** The canvas members the sigil uses. A test double without a context is left undrawn. */
export interface SigilCanvas {
  className: string;
  width: number;
  height: number;
  setAttribute(name: string, value: string): void;
  getContext?: (kind: '2d') => SigilContext | null;
}

export interface SigilDoc {
  createElement(tag: string): unknown;
}

/** FNV-1a over the UTF-16 code units of a string, as an unsigned 32-bit number. */
export function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The sigil of a name: the hue is the hash modulo 360, and each cell of the left three columns is lit by
 * one bit of a stirred hash. The centre cell is always lit, so no sigil is empty. The two right columns
 * mirror the two left ones.
 */
export function sigilOf(name: string): Sigil {
  let hash = fnv1a(`${name}geldar`);
  const hue = hash % 360;
  const cells = new Array<boolean>(SIGIL_CELLS * SIGIL_CELLS).fill(false);
  const middle = (SIGIL_CELLS - 1) / 2;
  for (let y = 0; y < SIGIL_CELLS; y += 1) {
    for (let x = 0; x <= middle; x += 1) {
      hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
      if ((hash & 1) === 0 && !(x === middle && y === middle)) continue;
      cells[y * SIGIL_CELLS + x] = true;
      cells[y * SIGIL_CELLS + (SIGIL_CELLS - 1 - x)] = true;
    }
  }
  return { hue, cells };
}

/** The two colours of a sigil. Only the hue varies, and it is a number this file computed. */
export function sigilColours(hue: number): { ground: string; ink: string } {
  return { ground: `hsl(${hue}, 28%, 16%)`, ink: `hsl(${hue}, 70%, 66%)` };
}

/** Paints a sigil on a context whose bitmap is SIGIL_SIZE square. */
export function paintSigil(ctx: SigilContext, sigil: Sigil): void {
  const { ground, ink } = sigilColours(sigil.hue);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, SIGIL_SIZE, SIGIL_SIZE);
  ctx.fillStyle = ink;
  sigil.cells.forEach((lit, index) => {
    if (lit) ctx.fillRect(1 + (index % SIGIL_CELLS), 1 + Math.floor(index / SIGIL_CELLS), 1, 1);
  });
}

/**
 * A canvas with the sigil of a name. It is decoration: hidden from a screen reader, which reads the name
 * beside it. `size` picks the CSS size by a fixed class; `dead` greys it.
 */
export function makeSigil(
  doc: SigilDoc,
  name: string,
  size: 'chip' | 'row' | 'reader',
  dead = false,
): SigilCanvas {
  const canvas = doc.createElement('canvas') as SigilCanvas;
  canvas.className = dead ? `sigil sigil-${size} dead` : `sigil sigil-${size}`;
  canvas.width = SIGIL_SIZE;
  canvas.height = SIGIL_SIZE;
  canvas.setAttribute('aria-hidden', 'true');
  // A browser without canvas, or a test document, gives no context: the square stays empty.
  let ctx: SigilContext | null = null;
  try {
    ctx = canvas.getContext?.('2d') ?? null;
  } catch {
    ctx = null;
  }
  if (ctx !== null) paintSigil(ctx, sigilOf(name));
  return canvas;
}
