// Where each monitor goes on the wall (decision 0161). Pure: monitor ids, the active one, the layout
// and the screen shape in; a CSS grid template and one cell per tile out. A tile is a monitor or an
// empty "no signal" slot (id null). Hidden monitors keep their feed but are not drawn.

import type { Layout } from '../keys.ts';

export interface WallCell {
  /** A monitor id, or null for an empty slot. */
  id: number | null;
  /** CSS grid-area: "row / column / row-end / column-end", 1-based. */
  area: string;
  /** The large tile in Feature, the only tile in Solo. */
  featured: boolean;
}

export interface WallPlan {
  columns: string;
  rows: string;
  cells: WallCell[];
  /** Monitors that exist but are not on screen (Solo). */
  hidden: number[];
}

export interface WallInput {
  ids: readonly number[];
  active: number | null;
  layout: Layout;
  cap: number;
  /** A phone-shaped screen: one column. */
  narrow: boolean;
}

const area = (row: number, col: number, rowSpan = 1, colSpan = 1): string =>
  `${row} / ${col} / ${row + rowSpan} / ${col + colSpan}`;

/** Wall: equal tiles. Wide screens fill every slot up to the cap; phones add one empty slot below. */
function wall(ids: readonly number[], cap: number, narrow: boolean): WallPlan {
  const free = Math.max(0, cap - ids.length);
  const tiles: (number | null)[] = [
    ...ids,
    ...new Array(narrow ? Math.min(1, free) : free).fill(null),
  ];
  if (tiles.length === 0) tiles.push(null);
  const cols = narrow ? 1 : tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
  const rows = Math.ceil(tiles.length / cols);
  return {
    columns: `repeat(${cols}, minmax(0, 1fr))`,
    // Phones: a monitor row is at least 16rem; an empty slot is a short row.
    rows: narrow
      ? tiles.map((id) => (id === null ? '7rem' : 'minmax(16rem, 1fr)')).join(' ')
      : `repeat(${rows}, minmax(0, 1fr))`,
    cells: tiles.map((id, i) => ({
      id,
      area: area(Math.floor(i / cols) + 1, (i % cols) + 1),
      featured: false,
    })),
    hidden: [],
  };
}

/** Feature: the active monitor large, the rest (and one free slot) in a strip beside or below it. */
function feature(ids: readonly number[], main: number, cap: number, narrow: boolean): WallPlan {
  const side: (number | null)[] = ids.filter((i) => i !== main);
  if (ids.length < cap) side.push(null);
  const n = Math.max(1, side.length);
  if (narrow) {
    return {
      columns: `repeat(${n}, minmax(0, 1fr))`,
      rows: 'minmax(16rem, 3fr) minmax(6rem, 1fr)',
      cells: [
        { id: main, area: area(1, 1, 1, n), featured: true },
        ...side.map((id, i) => ({ id, area: area(2, i + 1), featured: false })),
      ],
      hidden: [],
    };
  }
  return {
    columns: 'minmax(0, 3fr) minmax(0, 1fr)',
    rows: `repeat(${n}, minmax(0, 1fr))`,
    cells: [
      { id: main, area: area(1, 1, n, 1), featured: true },
      ...side.map((id, i) => ({ id, area: area(i + 1, 2), featured: false })),
    ],
    hidden: [],
  };
}

export function planWall(input: WallInput): WallPlan {
  const { ids, layout, cap, narrow } = input;
  const main = input.active !== null && ids.includes(input.active) ? input.active : ids[0];
  if (main === undefined || layout === 'wall') return wall(ids, cap, narrow);
  if (layout === 'feature') return feature(ids, main, cap, narrow);
  return {
    columns: 'minmax(0, 1fr)',
    rows: 'minmax(0, 1fr)',
    cells: [{ id: main, area: area(1, 1), featured: true }],
    hidden: ids.filter((i) => i !== main),
  };
}
