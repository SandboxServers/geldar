// Seen-map 16-cube section (BLD-17): a palette of block names and a last-seen tick per cell.
// A cell with no palette entry (index 0) is unseen; the map never holds a guess about it.

export const SECTION_SIZE = 16;
const CELLS = SECTION_SIZE * SECTION_SIZE * SECTION_SIZE;

/** Where a block lies: its section key, the section's integer origin in section units, and its index inside it (0 to 4095). */
export interface CellRef {
  key: string;
  sx: number;
  sy: number;
  sz: number;
  local: number;
}

/** The section a block lies in. Negative coordinates floor toward minus infinity, so each block has exactly one section. */
export function sectionOf(x: number, y: number, z: number): CellRef {
  const sx = Math.floor(x / SECTION_SIZE);
  const sy = Math.floor(y / SECTION_SIZE);
  const sz = Math.floor(z / SECTION_SIZE);
  const lx = x - sx * SECTION_SIZE;
  const ly = y - sy * SECTION_SIZE;
  const lz = z - sz * SECTION_SIZE;
  return {
    key: `${sx},${sy},${sz}`,
    sx,
    sy,
    sz,
    local: lx + ly * SECTION_SIZE + lz * SECTION_SIZE * SECTION_SIZE,
  };
}

/** A seen cell as read back: the block name it was seen as and the game tick it was last seen. */
export interface SeenCell {
  name: string;
  lastSeen: number;
}

/** One section: a palette (index 0 means unseen) and, per cell, a palette index and a last-seen tick. */
export class Section {
  private readonly palette: string[] = [];
  private readonly paletteIndex = new Map<string, number>();
  private readonly blocks = new Uint16Array(CELLS);
  private readonly lastSeen = new Uint32Array(CELLS);

  set(local: number, name: string, tick: number): void {
    let slot = this.paletteIndex.get(name);
    if (slot === undefined) {
      if (this.palette.length >= 0xffff) throw new RangeError('section palette is full');
      this.palette.push(name);
      slot = this.palette.length;
      this.paletteIndex.set(name, slot);
    }
    this.blocks[local] = slot;
    this.lastSeen[local] = tick;
  }

  get(local: number): SeenCell | undefined {
    const slot = this.blocks[local] ?? 0;
    if (slot === 0) return undefined;
    return { name: this.palette[slot - 1] as string, lastSeen: this.lastSeen[local] as number };
  }
}

/** The seen map of one life: sections keyed by their section coordinates. */
export class SeenMap {
  private readonly sections = new Map<string, Section>();

  record(x: number, y: number, z: number, name: string, tick: number): void {
    const ref = sectionOf(x, y, z);
    let section = this.sections.get(ref.key);
    if (section === undefined) {
      section = new Section();
      this.sections.set(ref.key, section);
    }
    section.set(ref.local, name, tick);
  }

  read(x: number, y: number, z: number): SeenCell | undefined {
    const ref = sectionOf(x, y, z);
    return this.sections.get(ref.key)?.get(ref.local);
  }

  get sectionCount(): number {
    return this.sections.size;
  }
}
