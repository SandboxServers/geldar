import type { Bot } from 'mineflayer';

/** The way from a chunk to a neighbour: `n` is toward -z, `e` toward +x, `s` toward +z, `w` toward -x. */
export type ChunkHeading = 'n' | 'e' | 's' | 'w';

const AXES: ReadonlyArray<{ heading: ChunkHeading; dx: number; dz: number }> = [
  { heading: 'n', dx: 0, dz: -1 },
  { heading: 'e', dx: 1, dz: 0 },
  { heading: 's', dx: 0, dz: 1 },
  { heading: 'w', dx: -1, dz: 0 },
];

/**
 * The four axis neighbours of chunk (cx, cz) whose column the Body's world holds loaded, in
 * n, e, s, w order. An unloaded column is never returned: the Body has no terrain there to walk to.
 */
export function loadedNeighbours(
  bot: Bot,
  cx: number,
  cz: number,
): Array<{ cx: number; cz: number; heading: ChunkHeading }> {
  return AXES.filter((axis) => bot.world.getColumn(cx + axis.dx, cz + axis.dz) != null).map(
    (axis) => ({ cx: cx + axis.dx, cz: cz + axis.dz, heading: axis.heading }),
  );
}
