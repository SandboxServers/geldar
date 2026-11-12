// The Body's answer to an image request (decision 0156, VP-2): the view as a base64 PNG with a fixed
// caption, or a typed `view_unavailable` refusal. Never throws: the Mind always gets a reply.

import { viewImageSubject } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { RequestServer } from '../mind-link/server.ts';
import {
  clampSize,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  type ImageSize,
  isDefaultSize,
  PNG_CAP_BYTES,
} from './image-size.ts';
import type { ImageLimiter } from './limiter.ts';
import { eyeCellLoaded, readBodyScene } from './reader.ts';
import type { RenderOutcome, RenderPort } from './render-host.ts';

/** The fixed caption sent with every image. */
export const IMAGE_CAPTION = 'what you see, from your eyes (an approximation, not a photograph)';

/** Why an image was refused. `busy` and `render_timeout` are added to the decision's list. */
export type ImageDetail =
  | 'chunks_not_loaded'
  | 'rate_limited'
  | 'busy'
  | 'render_timeout'
  | 'render_failed';

export interface ImageServeDeps {
  bot: Bot;
  render: RenderPort;
  limiter: ImageLimiter;
}

function refused(detail: ImageDetail): string {
  return JSON.stringify({ error: 'view_unavailable', detail });
}

/** The size the request asked for. A body that is not JSON, or has no size, gets the default size. */
function requestedSize(data: string): ImageSize {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = undefined;
  }
  const fields = typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  return clampSize(fields as { width?: unknown; height?: unknown } | undefined);
}

/** The reply for one render outcome: the image, or the refusal it maps to. */
function outcomeReply(outcome: RenderOutcome): string {
  if (outcome.ok) {
    const png = Buffer.from(outcome.png).toString('base64');
    return JSON.stringify({ png, caption: IMAGE_CAPTION });
  }
  if (outcome.reason === 'busy') return refused('busy');
  if (outcome.reason === 'timeout') return refused('render_timeout');
  return refused('render_failed');
}

/**
 * The reply body for an image request. Checks run in order: a busy renderer, an unloaded eye cell,
 * then the rate limit (a refused call takes no budget), then the render. A render over the PNG cap
 * is retried once at the default size, and a result still over the cap is refused.
 */
export async function imageReply(deps: ImageServeDeps, data: string): Promise<string> {
  try {
    const size = requestedSize(data);
    if (deps.render.busy) return refused('busy');
    if (!eyeCellLoaded(deps.bot)) return refused('chunks_not_loaded');
    const verdict = deps.limiter.take();
    if (!verdict.ok) return refused('rate_limited');
    const scene = readBodyScene(deps.bot, size);
    let outcome = await deps.render.render(scene);
    if (outcome.ok && outcome.png.length > PNG_CAP_BYTES && !isDefaultSize(size)) {
      outcome = await deps.render.render({
        ...scene,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      });
    }
    if (outcome.ok && outcome.png.length > PNG_CAP_BYTES) outcome = { ok: false, reason: 'failed' };
    return outcomeReply(outcome);
  } catch {
    return refused('render_failed');
  }
}

/** Serves image requests on the Body's subject. Returns the function that stops serving. */
export function serveBodyImages(
  server: RequestServer,
  shard: string,
  lifeId: string,
  deps: ImageServeDeps,
): () => void {
  return server.serve(viewImageSubject(shard, lifeId), (data, reply) =>
    imageReply(deps, data).then(reply),
  );
}
