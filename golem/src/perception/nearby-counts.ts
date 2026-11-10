import type { Bot } from 'mineflayer';

/** How far the Body counts natural blocks, in blocks. Counts need no line of sight. */
export const COUNT_RADIUS = 8;
/** The longest counts clause, in characters: whole entries are kept in order, the rest dropped. */
export const MAX_COUNTS_TEXT = 256;

/** The wood types whose logs and leaves are counted. */
const WOODS = [
  'oak',
  'spruce',
  'birch',
  'jungle',
  'acacia',
  'dark_oak',
  'mangrove',
  'cherry',
  'pale_oak',
] as const;

/** The closed list of counted kinds, in the order the clause reads. */
export const COUNTED_BLOCKS: readonly string[] = [
  ...WOODS.map((wood) => `${wood}_log`),
  ...WOODS.map((wood) => `${wood}_leaves`),
  'grass_block',
  'dirt',
  'sand',
  'stone',
  'water',
  'lava',
];

const COUNTED = new Set(COUNTED_BLOCKS);

/** The number of each counted kind within `COUNT_RADIUS` of the feet. */
export function countNearby(bot: Bot): Map<string, number> {
  const cells = (2 * COUNT_RADIUS + 1) ** 3;
  const found = bot.findBlocks({
    point: bot.entity.position,
    matching: (block) => COUNTED.has(block.name),
    maxDistance: COUNT_RADIUS,
    count: cells,
  });
  const counts = new Map<string, number>();
  for (const at of found) {
    const block = bot.blockAt(at);
    if (!block) continue;
    counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
  }
  return counts;
}

/**
 * The counts clause, for example `3 oak_log, 40 oak_leaves nearby`: each counted kind present, in
 * the fixed list order. Whole entries are kept until the clause would pass `MAX_COUNTS_TEXT`.
 * Empty when no counted kind is present.
 */
export function countsClause(counts: ReadonlyMap<string, number>): string {
  const parts = COUNTED_BLOCKS.filter((name) => (counts.get(name) ?? 0) > 0).map(
    (name) => `${counts.get(name)} ${name}`,
  );
  let kept: string[] = [];
  for (const part of parts) {
    const next = [...kept, part];
    if (`${next.join(', ')} nearby`.length > MAX_COUNTS_TEXT) break;
    kept = next;
  }
  return kept.length === 0 ? '' : `${kept.join(', ')} nearby`;
}

/** The `blocks_summary` with the counts clause after its own clauses, joined by `; `. */
export function summaryWithCounts(summary: string, bot: Bot): string {
  const clause = countsClause(countNearby(bot));
  if (clause === '') return summary;
  return summary === '' ? clause : `${summary}; ${clause}`;
}
