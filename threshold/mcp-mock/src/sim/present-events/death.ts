import type { McpPlayerEvent } from '@geldar/contract';
import { definePresentHandler } from './types.ts';

/** The fixed death line. `cause` is one of the mapper's phrases, never world text. */
function deathText(cause: string | undefined): string {
  return `You died. ${cause ?? 'Something killed you'}. You wake at the spawn with nothing.`;
}

/** The drop line, said only when items were dropped. Mirrors the threshold presenter. */
function dropText(count: number): string {
  return `You dropped ${count} ${count === 1 ? 'item' : 'items'} where you died.`;
}

export const deathPresenter = definePresentHandler('death', (e, base) => {
  const place = e.where === undefined ? {} : { where: e.where };
  const respawn = e.respawn_point === undefined ? {} : { respawn_point: e.respawn_point };
  const lines: McpPlayerEvent[] = [
    { ...base, type: 'death', text: deathText(e.cause), ...place, ...respawn },
  ];
  if (e.drops !== undefined && e.drops > 0) {
    lines.push({ ...base, type: 'death', text: dropText(e.drops), drops: e.drops });
  }
  return lines;
});
