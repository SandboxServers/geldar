/** A block cell position: the same shape as a plan coordinate. */
export interface Cell {
  x: number;
  y: number;
  z: number;
}

/**
 * Pure shape helpers (BLD-04). Each yields cells in a deterministic order and never imports mineflayer.
 * Stubs until BLD-04: they throw `not_implemented`.
 */
export function boxCells(_from: Cell, _to: Cell, _hollow: boolean): IterableIterator<Cell> {
  throw new Error('not_implemented');
}

/** The cells of a line from one corner to another. */
export function lineCells(_from: Cell, _to: Cell): IterableIterator<Cell> {
  throw new Error('not_implemented');
}

/** The cells of a wall between two corners. */
export function wallCells(_from: Cell, _to: Cell): IterableIterator<Cell> {
  throw new Error('not_implemented');
}

/** The cells of a circle of a radius on the plane that drops the named axis. */
export function circleCells(
  _center: Cell,
  _radius: number,
  _axis: 'x' | 'y' | 'z',
): IterableIterator<Cell> {
  throw new Error('not_implemented');
}

/** The cells of a solid sphere. */
export function sphereCells(_center: Cell, _radius: number): IterableIterator<Cell> {
  throw new Error('not_implemented');
}
