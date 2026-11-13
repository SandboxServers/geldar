/** What a stopped build step reports as its reason (the Body's fixed words), as a plain fact. */
const STOP_PHRASE: Record<string, string> = {
  blocked: 'the next spot was blocked',
  not_found: 'the block for the next spot was not found',
  not_possible: 'the next block could not be placed',
  out_of_reach: 'the next spot was too far to reach',
  too_far: 'the next spot was too far to reach',
  no_effect: 'placing the next block changed nothing',
  missing_materials: 'you lacked the block for the next spot',
};

const PROGRESS = /^Built ([a-z]+): (\d{1,3}) of (\d{1,3}) blocks placed\./;
const OUT_OF = /^ Out of ([a-z_]+): (\d{1,4}) more needed\./;
const STOPPED = /^ Stopped at step \d{1,3}: ([a-z_]+):/;
const NO_ROOM = /^ No room to step aside\./;

/**
 * Plain facts from the Body's build detail (`Built shelter: 12 of 23 blocks placed. ...`), rebuilt from
 * fixed templates: only digits and lowercase item words are quoted. Undefined when the detail is not a
 * build detail, so the caller tries its other shapes.
 */
export function buildFailureReason(detail: string): string | undefined {
  const head = PROGRESS.exec(detail);
  if (!head?.[2] || !head[3]) return undefined;
  const placed = `you placed ${head[2]} of ${head[3]} blocks`;
  const rest = detail.slice(head[0].length);
  const out = OUT_OF.exec(rest);
  if (out?.[1] && out[2]) return `${placed} and lack ${out[2]} more ${out[1].replaceAll('_', ' ')}`;
  if (NO_ROOM.test(rest)) return `${placed}, then there was no free cell to step aside into`;
  const stop = STOPPED.exec(rest);
  if (stop?.[1]) return `${placed}, then ${STOP_PHRASE[stop[1]] ?? 'it stopped'}`;
  return placed;
}
