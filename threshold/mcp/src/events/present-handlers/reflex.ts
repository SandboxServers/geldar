import type { McpPlayerEvent } from '@geldar/contract';
import { definePresentHandler } from './types.ts';

/** Identical reflex lines within this many ms of the first one fold into it (one line per few seconds). */
const REFLEX_REPEAT_MS = 3000;

/** What set each reflex off, as a fixed phrase per reflex name. */
const REFLEX_TRIGGERS: Readonly<Record<string, string>> = {
  eat: 'your hunger was low, so you ate',
  fall_stop: 'you were falling, you braced',
  retreat: 'your health was low with a hostile close, you walked back to safety',
  fight_or_flee: 'a hostile was close, you fought or fled',
  panic_burrow: 'a threat was close, you dug in',
  hazard_escape: 'you were in a hazard, you got out',
  unstick: 'you were stuck, you tried to get free',
  blocked_path: 'your path was blocked, you looked for a way round',
  dark_shelter: 'it was dark and you were exposed, you took cover',
};

/** The reflex names that have a line; a test checks it covers every reflex the Body can fire. */
export const REFLEX_LINE_NAMES: readonly string[] = Object.keys(REFLEX_TRIGGERS);

/**
 * The fixed reflex line: the reflex's name, what set it off and, when it did not finish, that.
 * Only names in the table are printed; any other name reads as an unnamed reflex, never as world text.
 */
export function reflexText(name: string | undefined, result: string | undefined): string {
  const known = name !== undefined && Object.hasOwn(REFLEX_TRIGGERS, name);
  const trigger = known ? REFLEX_TRIGGERS[name] : 'you acted on your own';
  const tail = result === 'handled' ? '' : ' It did not finish.';
  return `Reflex ${known ? name : 'unknown'}: ${trigger}.${tail}`;
}

/** A firing identical to the run before it, within the window, folds into that run's line with a count. */
export const reflexPresenter = definePresentHandler('reflex', (e, base, call) => {
  const text = reflexText(e.name, e.result);
  const last = call.lastReflex;
  if (last && last.text === text && e.atMs - last.atMs <= REFLEX_REPEAT_MS) {
    last.count += 1;
    last.entry.text = `${text} (x${last.count})`;
    return [];
  }
  const entry: McpPlayerEvent = { ...base, type: 'reflex', text };
  call.lastReflex = { entry, text, atMs: e.atMs, count: 1 };
  return [entry];
});
