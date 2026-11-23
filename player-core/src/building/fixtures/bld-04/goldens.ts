/**
 * Golden cell lists for the BLD-04 helpers, written out by hand. Offsets are relative to the
 * centre, in the two coordinates the circle's plane keeps (for axis `y`: x and z).
 */

/** A radius-2 circle on the y axis: the 12 outline cells of the midpoint algorithm. */
export const CIRCLE_R2_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 2],
  [0, -2],
  [2, 0],
  [-2, 0],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
];

/** A solid sphere of radius 2 has 33 lattice points (the 3D Gauss count for r = 2). */
export const SPHERE_R2_SOLID_COUNT = 33;

/** A hollow sphere of radius 2 drops the 7 interior points (the centre and its six neighbours). */
export const SPHERE_R2_HOLLOW_COUNT = 26;
