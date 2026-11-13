/** One block of a blueprint, as an offset from the cell the body stood in when the build began. */
export interface Cell {
  dx: number;
  dy: number;
  dz: number;
}

/** The named blueprints the `build` program knows. Every cell is made of one block the body holds. */
export const BLUEPRINT_NAMES = ['shelter', 'wall', 'pillar'] as const;
export type BlueprintName = (typeof BLUEPRINT_NAMES)[number];

/**
 * `shelter`: a ring of walls two high around the body's cell, a roof. The +z doorway (two cells,
 * `dy` 0 and 1) is part of the ring: the build puts a wooden door there when the body holds one, else
 * the build block (decision 0163).
 */
function shelterCells(): Cell[] {
  const cells: Cell[] = [];
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const centre = dx === 0 && dz === 0;
        const roof = dy === 2;
        if (centre && !roof) continue; // the body stands here
        cells.push({ dx, dy, dz });
      }
    }
  }
  return cells;
}

/** `wall`: five blocks wide and three high, one step in +z from the body, across the x axis. */
function wallCells(): Cell[] {
  const cells: Cell[] = [];
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = -2; dx <= 2; dx++) cells.push({ dx, dy, dz: 1 });
  }
  return cells;
}

/** `pillar`: three blocks up from the body's own cell (the body steps aside for them). */
function pillarCells(): Cell[] {
  return [0, 1, 2].map((dy) => ({ dx: 0, dy, dz: 0 }));
}

const CELLS: Record<BlueprintName, () => Cell[]> = {
  shelter: shelterCells,
  wall: wallCells,
  pillar: pillarCells,
};

/** True when the text names a known blueprint. */
export function isBlueprintName(name: string): name is BlueprintName {
  return (BLUEPRINT_NAMES as readonly string[]).includes(name);
}

/** The cells of a blueprint in build order: the lowest layer first, then by x and z (stable). */
export function blueprintCells(name: BlueprintName): Cell[] {
  return CELLS[name]()
    .map((cell, index) => ({ cell, index }))
    .sort((a, b) => a.cell.dy - b.cell.dy || a.index - b.index)
    .map(({ cell }) => cell);
}
