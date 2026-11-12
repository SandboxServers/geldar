// The size of an image request and the caps on it (decision 0156: default 320x180, maximum 640x360,
// a PNG of at most 256 KB; a render over the cap is re-rendered at the default size).

export const DEFAULT_WIDTH = 320;
export const DEFAULT_HEIGHT = 180;
export const MAX_WIDTH = 640;
export const MAX_HEIGHT = 360;
/** The smallest side the renderer draws: smaller asks are raised to it. */
export const MIN_SIDE = 32;
export const PNG_CAP_BYTES = 256 * 1024;

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * One side of the image. A value that is not a whole number (or not a number at all) gets the
 * default; a whole number is clamped to [MIN_SIDE, max]. An odd side is a whole number and is kept.
 */
export function clampSide(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(MIN_SIDE, value));
}

/** The size asked for, clamped. A request with no size, or a bad one, gets the default size. */
export function clampSize(input: { width?: unknown; height?: unknown } | undefined): ImageSize {
  return {
    width: clampSide(input?.width, DEFAULT_WIDTH, MAX_WIDTH),
    height: clampSide(input?.height, DEFAULT_HEIGHT, MAX_HEIGHT),
  };
}

/** Whether the size is the default one (a render over the cap is only retried when it is not). */
export function isDefaultSize(size: ImageSize): boolean {
  return size.width === DEFAULT_WIDTH && size.height === DEFAULT_HEIGHT;
}
