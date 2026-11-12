import type { Action } from '@geldar/contract';
import { type ActionOutcome, completed, failed } from './outcome.ts';
import type { ActionHandler } from './registry.ts';

/** The contract's `maxLength` for a note. */
export const NOTE_MAX_CHARS = 512;

/** True for control characters other than tab and newline, and for the line and paragraph separators. */
function isStripped(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code === 0x09 || code === 0x0a) return false;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

/**
 * Note text as the Body keeps it: control and line-separator characters removed, runs of white
 * space folded to one space, trimmed and cut to `NOTE_MAX_CHARS`. It is the agent's own text but
 * it later reaches prompts, so it is treated as untrusted data.
 */
export function sanitizeNote(text: string): string {
  return [...text]
    .filter((char) => !isStripped(char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_MAX_CHARS);
}

/**
 * `note(text)`: a private note with no in-game effect (spec 5.2 table). The action record carries
 * the sanitised text in `detail.text`, which is how it reaches the journal and the event stream.
 * It costs no world ticks and touches no world state.
 */
export const noteAction: ActionHandler<'note'> = {
  kind: 'note',
  timeoutMs: 2_000,
  async run(_ctx, action: Extract<Action, { do: 'note' }>): Promise<ActionOutcome> {
    const text = sanitizeNote(action.text);
    if (text === '') return failed('invalid_args', 'empty note');
    return completed({ text });
  },
};
