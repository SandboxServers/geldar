import type { Position } from '../actions/bot-types.ts';

/** One item stack a container held: the item name and its count. */
export type ContainerStack = {
  item: string;
  count: number;
};

/** A furnace's slots and progress at an open. A slot is null when empty; progress is 0 to 100. */
export type FurnaceSlots = {
  input: ContainerStack | null;
  fuel: ContainerStack | null;
  output: ContainerStack | null;
  progress: number;
};

/** What the Body saw when it last opened a container. */
export type OpenedContents = {
  contents: ContainerStack[];
  furnace?: FurnaceSlots;
};

/** The recall read: a container the Body has opened (known) or never has (unknown). */
export type Recall =
  | { status: 'unknown' }
  | ({ status: 'known'; age_days: number } & OpenedContents);

/** The most containers the Body remembers; the container opened longest ago goes first. */
export const MAX_REMEMBERED_CONTAINERS = 64;
/** One day in milliseconds, the unit of `age_days`. */
export const DAY_MS = 24 * 60 * 60 * 1000;

interface Entry extends OpenedContents {
  openedAt: number;
}

function keyOf(at: Position): string {
  return `${at.x},${at.y},${at.z}`;
}

/**
 * The contents of the containers the agent has opened, so a chest it opened earlier can be
 * recalled after it has walked away. A container never opened is unknown: its contents are never
 * shown (spec 5.2). A re-open replaces the entry and makes it the newest.
 */
export class RememberedContainers {
  private readonly entries = new Map<string, Entry>();

  /** Records what a container held at this open, replacing any earlier open at the same position. */
  record(at: Position, opened: OpenedContents, nowMs: number): void {
    const key = keyOf(at);
    this.entries.delete(key);
    const entry: Entry = { contents: opened.contents, openedAt: nowMs };
    if (opened.furnace !== undefined) entry.furnace = opened.furnace;
    this.entries.set(key, entry);
    while (this.entries.size > MAX_REMEMBERED_CONTAINERS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** What the container at this position held at its last open, with the days since then. */
  recall(at: Position, nowMs: number): Recall {
    const entry = this.entries.get(keyOf(at));
    if (!entry) return { status: 'unknown' };
    const age_days = Math.max(0, Math.floor((nowMs - entry.openedAt) / DAY_MS));
    const known: Extract<Recall, { status: 'known' }> = {
      status: 'known',
      age_days,
      contents: entry.contents,
    };
    if (entry.furnace !== undefined) known.furnace = entry.furnace;
    return known;
  }

  get size(): number {
    return this.entries.size;
  }
}
