/** A notable block the agent saw before: its kind and block coordinates, never its sign text. */
export interface RememberedBlock {
  type: string;
  x: number;
  y: number;
  z: number;
}

/** The most blocks the Body remembers; the oldest sighting goes first. */
export const MAX_REMEMBERED = 256;

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * The notable blocks the agent has seen, so a chest it walked past is still known after it turns
 * away (spec 5.2: a block the Body has not seen is never reported, one it has seen may be). Capped
 * at `MAX_REMEMBERED`; a re-sighting of a position replaces its entry and makes it the newest.
 */
export class RememberedBlocks {
  private readonly entries = new Map<string, RememberedBlock>();

  /** Records a sighting, replacing any earlier entry at the same position. */
  remember(block: RememberedBlock): void {
    const key = keyOf(block.x, block.y, block.z);
    this.entries.delete(key);
    this.entries.set(key, { type: block.type, x: block.x, y: block.y, z: block.z });
    while (this.entries.size > MAX_REMEMBERED) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Drops the entry at a position: the agent saw that the block is gone. */
  forget(x: number, y: number, z: number): void {
    this.entries.delete(keyOf(x, y, z));
  }

  /** The entry at a position, if any. */
  at(x: number, y: number, z: number): RememberedBlock | undefined {
    return this.entries.get(keyOf(x, y, z));
  }

  /** Every entry, oldest sighting first. */
  list(): RememberedBlock[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}
