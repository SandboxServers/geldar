// Agent viewport renderer (decision 0156, packet VP-1). Renders what the Body can see from its eye as a
// PNG. Not wired into any tool yet: the Body adapter and the `see` tool are VP-2 and VP-3.

import { encodePng } from './png.ts';
import { renderRgb } from './raycast.ts';
import type { ViewportRequest } from './world.ts';

export { blockName, colourFor, lookOf } from './block-colours.ts';
export { encodePng } from './png.ts';
export { type RenderedRgb, renderRgb, skyAt } from './raycast.ts';
export type {
  Vec,
  ViewportEntity,
  ViewportOptions,
  ViewportRequest,
  ViewportWorld,
} from './world.ts';

/** The PNG of the view described by the request. Deterministic: the same request gives the same bytes. */
export function renderViewportPng(req: ViewportRequest): Buffer {
  const img = renderRgb(req);
  return encodePng(img.rgb, img.width, img.height);
}
