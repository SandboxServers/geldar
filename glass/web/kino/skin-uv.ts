// The pure parts of the skinned figure: the skin URL, slim-arm detection and the UV rectangles of the standard
// Minecraft skin layout. Rectangles are in skin pixels, origin top-left. Figure space: +Y up, the figure faces +Z,
// so its right side is -X ("right" faces on -X, "left" faces on +X).

export type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';
export type Rect = { x: number; y: number; w: number; h: number };
export type FaceRects = Record<Face, Rect>;
export type PartName =
  | 'head'
  | 'body'
  | 'rightArm'
  | 'leftArm'
  | 'rightLeg'
  | 'leftLeg'
  | 'hat'
  | 'jacket'
  | 'rightSleeve'
  | 'leftSleeve'
  | 'rightPants'
  | 'leftPants';

/** Same rule as Glass (glass/src/kino/skins.ts): the id is a file stem of lower case letters, digits, `_`, `-`. */
const AGENT_ID = /^[a-z][a-z0-9_-]{0,31}$/;

/** The same-origin skin URL for an agent id, or undefined for an id Glass would refuse. */
export function skinUrl(agentId: string): string | undefined {
  return AGENT_ID.test(agentId) ? `/kino/skins/${agentId}.png` : undefined;
}

/**
 * Slim ("Alex") arms are 3 wide, so the two right-arm columns x 54..55, rows 20..31 (the last pixels of a classic
 * arm's back face) stay fully transparent. Classic skins use them. A skin with no second half (64x32) is classic.
 * `alphaAt` returns the alpha 0..255 of a pixel.
 */
export function isSlim(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number,
): boolean {
  if (width !== 64 || height < 64) return false;
  for (let y = 20; y <= 31; y++)
    for (let x = 54; x <= 55; x++) if (alphaAt(x, y) !== 0) return false;
  return true;
}

/** Skin-layout rectangles of a box part with texture origin (u, v) and size w x h x d pixels. */
export function boxRects(u: number, v: number, w: number, h: number, d: number): FaceRects {
  return {
    top: { x: u + d, y: v, w, h: d },
    bottom: { x: u + d + w, y: v, w, h: d },
    right: { x: u, y: v + d, w: d, h },
    front: { x: u + d, y: v + d, w, h },
    left: { x: u + d + w, y: v + d, w: d, h },
    back: { x: u + 2 * d + w, y: v + d, w, h },
  };
}

/** Mirrors rectangles left to right (a legacy skin has one arm and one leg; the other is its mirror image). */
export function mirrored(r: FaceRects): FaceRects {
  return {
    top: r.top,
    bottom: r.bottom,
    right: r.left,
    left: r.right,
    front: r.front,
    back: r.back,
  };
}

export interface PartSpec {
  name: PartName;
  /** Box size in pixels. */
  size: [number, number, number];
  /** Centre of the box in figure pixels, feet at y = 0, centred on x and z. */
  centre: [number, number, number];
  /** Per-side growth in pixels (the overlay layer sits just outside the base). */
  grow: number;
  rects: FaceRects;
  /** The face rectangles are drawn flipped left to right (legacy mirrored limb). */
  flip: boolean;
}

/** 64x32 skins carry one arm and one leg: the left limbs reuse the right limb's rectangles, mirrored. */
export function figureParts(opts: { slim: boolean; legacy: boolean }): PartSpec[] {
  const aw = opts.slim ? 3 : 4;
  const arm = (
    name: PartName,
    side: 1 | -1,
    rects: FaceRects,
    grow: number,
    flip: boolean,
  ): PartSpec => ({
    name,
    size: [aw, 12, 4],
    // The arm's outer edge sits at x = 4 pixels of the body half-width; the figure's right is -X.
    centre: [side * (4 + aw / 2), 18, 0],
    grow,
    rects,
    flip,
  });
  const leg = (
    name: PartName,
    side: 1 | -1,
    rects: FaceRects,
    grow: number,
    flip: boolean,
  ): PartSpec => ({
    name,
    size: [4, 12, 4],
    centre: [side * 2, 6, 0],
    grow,
    rects,
    flip,
  });
  const head = (name: PartName, u: number, grow: number): PartSpec => ({
    name,
    size: [8, 8, 8],
    centre: [0, 28, 0],
    grow,
    rects: boxRects(u, 0, 8, 8, 8),
    flip: false,
  });
  const rArm = boxRects(40, 16, aw, 12, 4);
  const rLeg = boxRects(0, 16, 4, 12, 4);
  const parts: PartSpec[] = [
    head('head', 0, 0),
    head('hat', 32, 0.5),
    {
      name: 'body',
      size: [8, 12, 4],
      centre: [0, 18, 0],
      grow: 0,
      rects: boxRects(16, 16, 8, 12, 4),
      flip: false,
    },
    arm('rightArm', -1, rArm, 0, false),
    leg('rightLeg', -1, rLeg, 0, false),
  ];
  if (opts.legacy) {
    parts.push(
      arm('leftArm', 1, mirrored(rArm), 0, true),
      leg('leftLeg', 1, mirrored(rLeg), 0, true),
    );
    return parts;
  }
  parts.push(
    arm('leftArm', 1, boxRects(32, 48, aw, 12, 4), 0, false),
    leg('leftLeg', 1, boxRects(16, 48, 4, 12, 4), 0, false),
    {
      name: 'jacket',
      size: [8, 12, 4],
      centre: [0, 18, 0],
      grow: 0.25,
      rects: boxRects(16, 32, 8, 12, 4),
      flip: false,
    },
    arm('rightSleeve', -1, boxRects(40, 32, aw, 12, 4), 0.25, false),
    arm('leftSleeve', 1, boxRects(48, 48, aw, 12, 4), 0.25, false),
    leg('rightPants', -1, boxRects(0, 32, 4, 12, 4), 0.25, false),
    leg('leftPants', 1, boxRects(0, 48, 4, 12, 4), 0.25, false),
  );
  return parts;
}
