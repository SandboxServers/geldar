// Inputs to the viewport renderer. The renderer knows only what these describe: it never imports the
// Body, mineflayer or any server data. The Body adapter (VP-2) implements ViewportWorld from the
// Body's own loaded chunks, and passes the Body's own perception list as entities.

export interface ViewportWorld {
  /**
   * The block at a cell: a block name such as `stone` or `minecraft:oak_log[axis=y]`, or `null` when
   * the cell is not loaded. A null cell ends the ray and is drawn as sky (the Body knows nothing there).
   */
  blockAt(x: number, y: number, z: number): string | null;
}

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** An entity the Body can see. `x`, `y`, `z` is the feet position; the box is `width` by `height`. */
export interface ViewportEntity {
  type: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

export interface ViewportOptions {
  /** Pixels; default 320 by 180. */
  width?: number;
  height?: number;
  /** Vertical field of view in degrees; the client default is 70. */
  fov?: number;
  /** Ray length in blocks; default 96, inside the loaded view distance. */
  range?: number;
}

export interface ViewportRequest {
  world: ViewportWorld;
  /** Eye position in blocks (the client eye is 1.62 above the feet). */
  eye: Vec;
  /** Radians, mineflayer convention: yaw 0 faces -z; pitch above 0 looks up. */
  yaw: number;
  pitch: number;
  entities?: readonly ViewportEntity[];
  options?: ViewportOptions;
}
