// The plan cells on the y layers scaffold removal asks about (BLD-10). A layer is read from a fresh
// source of the plan in slices that yield to the event loop, so no step walks a whole plan in one
// synchronous pass. The cache holds the layers of the last ask and is cleared when a plan starts or
// ends (`reset`), so a later plan with the same id never answers from the earlier plan's cells.
import type { CellSource, YieldLoop } from './cell-source.ts';
import { forEachCellSliced, yieldToLoop } from './cell-source.ts';
import type { Cell } from './stand.ts';

function keyOf(c: Cell): string {
  return `${c.x},${c.y},${c.z}`;
}

export class LayerKeys {
  private layers = new Map<number, Set<string>>();
  /** Bumped by `reset`: a read that began before a reset does not store its layers after it. */
  private epoch = 0;

  /** Clears the cache: the next ask reads its layers from the plan it is given. */
  reset(): void {
    this.epoch++;
    this.layers.clear();
  }

  /**
   * The cells of `cells` that the plan works, judged per y layer from `fresh()`. Layers not cached
   * are read in one walk of the plan, sliced by `slice()` and yielding between slices.
   */
  async onPlanOf(
    cells: readonly Cell[],
    fresh: () => CellSource,
    slice: () => number,
    yieldLoop: YieldLoop = yieldToLoop,
  ): Promise<Cell[]> {
    const got = new Map<number, Set<string>>();
    const missing = new Map<number, Set<string>>();
    for (const c of cells) {
      if (got.has(c.y) || missing.has(c.y)) continue;
      const have = this.layers.get(c.y);
      if (have !== undefined) got.set(c.y, have);
      else missing.set(c.y, new Set<string>());
    }
    if (missing.size > 0) {
      const epoch = this.epoch;
      await forEachCellSliced(
        fresh(),
        0,
        Number.MAX_SAFE_INTEGER,
        slice,
        (cell) => {
          missing.get(cell.at.y)?.add(keyOf(cell.at));
        },
        yieldLoop,
      );
      for (const [y, keys] of missing) got.set(y, keys);
      // Only the layers of this ask are kept, which bounds the cache to one ask's layers.
      if (epoch === this.epoch) this.layers = new Map(got);
    }
    return cells.filter((c) => got.get(c.y)?.has(keyOf(c)) === true);
  }
}
