import type { McpPlayerEvent } from '@geldar/contract';
import { definePresentHandler } from './types.ts';

/** The words for each dimension in the death line. */
const DIMENSION_WORDS: Readonly<Record<string, string>> = {
  overworld: 'the overworld',
  nether: 'the nether',
  end: 'the end',
  other: 'another world',
};

/** The most item names the drop line lists; more are counted as "and N more". */
const LISTED_STACKS = 5;

/**
 * The fixed death line. `cause` is one of the mapper's phrases, never world text. With a dimension
 * the line says where the player died ("You died in the nether.").
 */
export function deathText(cause: string | undefined, dimension?: string): string {
  const died =
    dimension === undefined
      ? 'You died'
      : `You died in ${DIMENSION_WORDS[dimension] ?? 'another world'}`;
  return `${died}. ${cause ?? 'Something killed you'}. You wake at the spawn with nothing.`;
}

/** The drop line: said only when items were dropped. The count is a number, never item names. */
export function dropText(count: number): string {
  return `You dropped ${count} ${count === 1 ? 'item' : 'items'} where you died.`;
}

type DropStack = NonNullable<McpPlayerEvent['drop_items']>[number];

/**
 * The drop line with names: up to five stacks as "count name", then "and N more", then the place
 * the first stack with a full place lies at, when the server gave one.
 */
export function dropNamesText(stacks: readonly DropStack[]): string {
  const listed = stacks.slice(0, LISTED_STACKS).map((s) => `${s.count} ${s.item}`);
  const more = stacks.length - listed.length;
  const names = more > 0 ? `${listed.join(', ')}, and ${more} more` : listed.join(', ');
  const at = stacks.find((s) => s.x !== undefined && s.y !== undefined && s.z !== undefined);
  const place = at === undefined ? '' : ` near x=${at.x} y=${at.y} z=${at.z}`;
  return `You dropped ${names}${place}.`;
}

/**
 * A death gives the death line (with the place and, once per death, the respawn point) and one drop
 * line: with item names when the server listed the stacks, else with the count.
 */
export const deathPresenter = definePresentHandler('death', (e, base) => {
  const place = e.where === undefined ? {} : { where: e.where };
  const respawn = e.respawn_point === undefined ? {} : { respawn_point: e.respawn_point };
  const lines: McpPlayerEvent[] = [
    { ...base, type: 'death', text: deathText(e.cause, e.dimension), ...place, ...respawn },
  ];
  if (e.drop_items !== undefined && e.drop_items.length > 0) {
    lines.push({
      ...base,
      type: 'death',
      text: dropNamesText(e.drop_items),
      drop_items: e.drop_items,
    });
  } else if (e.drops !== undefined && e.drops > 0) {
    lines.push({ ...base, type: 'death', text: dropText(e.drops), drops: e.drops });
  }
  return lines;
});
