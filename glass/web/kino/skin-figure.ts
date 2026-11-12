// A Minecraft player model textured from a skin image: head, body, arms and legs plus the overlay layer.
// Built around the agent marker origin (the marker is centred on the figure's middle, so the feet sit at -0.9).

import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  SRGBColorSpace,
} from 'three';
import { type Face, figureParts, isSlim, type PartSpec, type Rect } from './skin-uv.ts';

/** One skin pixel in blocks: the 32 px figure is 1.8 blocks tall, like a player. */
export const PIXEL = 1.8 / 32;
/** Marker origin to the figure's feet. */
export const FEET_OFFSET = -0.9;

/** BoxGeometry emits faces in this order, four vertices each (top-left, top-right, bottom-left, bottom-right). */
const FACE_ORDER: Face[] = ['left', 'right', 'top', 'bottom', 'front', 'back'];

function partGeometry(p: PartSpec, width: number, height: number): BoxGeometry {
  const [sx, sy, sz] = p.size;
  const g = new BoxGeometry(
    (sx + 2 * p.grow) * PIXEL,
    (sy + 2 * p.grow) * PIXEL,
    (sz + 2 * p.grow) * PIXEL,
  );
  const uv = g.getAttribute('uv');
  FACE_ORDER.forEach((face, i) => {
    const r: Rect = p.rects[face];
    let u0 = r.x / width;
    let u1 = (r.x + r.w) / width;
    // Three's v runs up the image. The bottom face lies with its image-bottom edge at the figure's front.
    let vTop = 1 - r.y / height;
    let vBot = 1 - (r.y + r.h) / height;
    if (p.flip) [u0, u1] = [u1, u0];
    if (face === 'bottom') [vTop, vBot] = [vBot, vTop];
    uv.setXY(i * 4, u0, vTop);
    uv.setXY(i * 4 + 1, u1, vTop);
    uv.setXY(i * 4 + 2, u0, vBot);
    uv.setXY(i * 4 + 3, u1, vBot);
  });
  uv.needsUpdate = true;
  return g;
}

/** Builds the figure from a decoded skin. The group faces +Z and can be added to a marker. */
export function buildFigure(canvas: HTMLCanvasElement): Group {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const slim =
    ctx !== null &&
    isSlim(canvas.width, canvas.height, (x, y) => ctx.getImageData(x, y, 1, 1).data[3] ?? 255);
  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, alphaTest: 0.5, transparent: false });
  const group = new Group();
  group.name = 'figure';
  group.userData = { slim };
  for (const p of figureParts({ slim, legacy: canvas.height < 64 })) {
    const mesh = new Mesh(partGeometry(p, canvas.width, canvas.height), material);
    mesh.name = p.name;
    mesh.position.set(p.centre[0] * PIXEL, p.centre[1] * PIXEL + FEET_OFFSET, p.centre[2] * PIXEL);
    group.add(mesh);
  }
  return group;
}

/** Loads the skin PNG at `url` into a canvas; undefined on any failure (404, bad image, no canvas). */
export async function loadSkinCanvas(url: string): Promise<HTMLCanvasElement | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const bitmap = await createImageBitmap(await res.blob());
    if (bitmap.width !== 64 || (bitmap.height !== 64 && bitmap.height !== 32)) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } catch {
    return undefined;
  }
}
