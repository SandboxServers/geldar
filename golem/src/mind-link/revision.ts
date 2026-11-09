/**
 * The Body's snapshot revision (spec 5.3.2, decision 0025): a counter that goes up by one for
 * every snapshot the Body builds. A plan carries the revision of the snapshot it was made from,
 * and the validity check refuses a plan more than the window behind the current revision.
 */
export class SnapshotRevision {
  private value: number;

  /** `start` is the revision before the first snapshot (default 0, so the first snapshot is 1). */
  constructor(start = 0) {
    if (!Number.isInteger(start) || start < 0) {
      throw new Error(`snapshot revision must start at a non-negative integer, got ${start}`);
    }
    this.value = start;
  }

  /** The revision of the latest snapshot built (the start value before any). */
  get current(): number {
    return this.value;
  }

  /** Takes the next revision: call once per snapshot, and put the result in that snapshot. */
  next(): number {
    this.value += 1;
    return this.value;
  }

  /** The getter `createBody({ currentRevision })` takes; it always reads the live counter. */
  getter(): () => number {
    return () => this.value;
  }
}
