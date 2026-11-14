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

/** A decoded skin, or why it did not load: `reason` is short enough for the monitor's status line. */
export type SkinLoad = { canvas: HTMLCanvasElement } | { reason: string; detail: string };

function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/**
 * Decodes one at a time: several monitors start their skins together, and a page-wide queue keeps one
 * decode in flight (hypothesis: concurrent createImageBitmap calls from several scenes).
 */
let decodeTail: Promise<unknown> = Promise.resolve();
function decodeSerially(blob: Blob): Promise<ImageBitmap> {
  const job = decodeTail.then(() => createImageBitmap(blob));
  decodeTail = job.catch(() => undefined);
  return job;
}

/** Fetches and decodes the skin PNG at `url`; never throws. */
export async function fetchSkin(url: string): Promise<SkinLoad> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return { reason: 'fetch failed', detail: `fetch threw ${describeError(e)}` };
  }
  const type = res.headers.get('content-type') ?? 'none';
  if (!res.ok)
    return { reason: `HTTP ${res.status}`, detail: `status ${res.status}, content-type ${type}` };
  try {
    const blob = await res.blob();
    const bitmap = await decodeSerially(blob);
    const shape = `${bitmap.width}x${bitmap.height}, ${blob.size} bytes, content-type ${type}`;
    if (bitmap.width !== 64 || (bitmap.height !== 64 && bitmap.height !== 32))
      return { reason: 'bad skin size', detail: `bitmap ${shape}` };
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { reason: 'no canvas context', detail: `bitmap ${shape}` };
    ctx.drawImage(bitmap, 0, 0);
    return { canvas };
  } catch (e) {
    return { reason: 'decode failed', detail: `${describeError(e)}` };
  }
}

/**
 * One load per agent id for the whole page: every monitor's scene shares the decoded canvas (each scene
 * still builds its own CanvasTexture for its own WebGL context). A failure is cached too and logged once,
 * so a missing skin is not requested again for every marker. Nothing aborts the shared promise.
 */
const skinCache = new Map<string, Promise<SkinLoad>>();

export function sharedSkin(agentId: string, url: string): Promise<SkinLoad> {
  let pending = skinCache.get(agentId);
  if (!pending) {
    pending = fetchSkin(url).then((load) => {
      if ('reason' in load)
        console.warn(
          `[kino] skin not loaded for agent ${agentId}: ${load.reason} (${load.detail})`,
        );
      return load;
    });
    skinCache.set(agentId, pending);
  }
  return pending;
}

/** Forgets every shared skin (tests only: a page never needs it). */
export function clearSharedSkins(): void {
  skinCache.clear();
}
