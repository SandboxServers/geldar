/** The most food sources the Body remembers; the one seen longest ago goes first. */
export const MAX_FOOD_KNOWN = 10;

/** One place the Body saw something to eat: what it is and where. */
export type FoodSource = { kind: string; x: number; y: number; z: number };

/**
 * The food sources the Body has seen, newest last. A source is keyed by its identity (an
 * entity id, or a block position), so a cow that walks is one entry that moves, and a source seen
 * again becomes the newest. Sources are never aged out by distance: only the bound drops them.
 */
export class FoodMemory {
  private readonly entries = new Map<string, FoodSource>();

  /** Records a sighting under a key, replacing the earlier one and making it the newest. */
  see(key: string, source: FoodSource): void {
    this.entries.delete(key);
    this.entries.set(key, source);
    while (this.entries.size > MAX_FOOD_KNOWN) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Forgets a source the Body saw gone (a harvested crop). */
  forget(key: string): void {
    this.entries.delete(key);
  }

  /** The remembered sources, newest first. */
  list(): FoodSource[] {
    return [...this.entries.values()].reverse().map((source) => ({ ...source }));
  }
}
