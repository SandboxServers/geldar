/**
 * The detail a rejected item carries (`rejected[].detail`, spec 5.15.3): which part of the action or
 * the thought was refused and what is expected there, in plain words. It is built from the validator's
 * path and message. It names paths and key names only, never a value the agent sent. A key that
 * carries a marker word is shown as `(name)`, so the detail passes the agent-text scan.
 */

import type { OutputError } from '@geldar/animus/src/ports/index.ts';
import { markedWords } from '@geldar/contract';

/** One refused item: its reason code and, for a validator refusal, the detail of what was refused. */
export interface Refusal {
  reason: string;
  detail?: string;
}

/** The most characters a detail carries. The contract allows 160; the agent reads this many. */
export const DETAIL_MAX_CHARS = 120;

/** The refusal of an action that is not sent because another action in its list is refused. */
export const BATCH_REFUSAL: Refusal = {
  reason: 'batch_rejected',
  detail: 'not sent: another action in this list is refused',
};

const PLAIN_NAME = /^[A-Za-z0-9_]{1,32}$/;
const INDEX = /^\d+$/;
const VERB_HINT = 'valid verbs:';

/** A key or field name as the agent may read it: plain, and free of marker words. */
function nameOf(key: string): string {
  return PLAIN_NAME.test(key) && markedWords(key).length === 0 ? key : '(name)';
}

/** True for the validator's list of valid verbs, which points at `/do` and is not the refusal itself. */
export function isVerbHint(error: OutputError): boolean {
  return error.detail.startsWith(VERB_HINT);
}

/** The place of a path, in words: `action 2.target`, `intent.arguments.target`, `say`, `the thought`. */
export function whereOf(path: string): string {
  const parts = path.split('/').slice(1);
  if (parts.length === 0) return 'the thought';
  let where = '';
  let next = 0;
  if (parts[0] === 'actions') {
    const index = parts[1];
    if (index !== undefined && INDEX.test(index)) {
      where = `action ${Number(index)}`;
      next = 2;
    } else {
      where = 'the action list';
      next = 1;
    }
  }
  for (const part of parts.slice(next)) {
    if (INDEX.test(part)) where += `[${part}]`;
    else where = where === '' ? nameOf(part) : `${where}.${nameOf(part)}`;
  }
  return where;
}

/** What is wrong there, from the validator's code and message. It quotes no value, only key names. */
function whatOf(error: OutputError): string {
  if (error.code === 'not_allowed') return 'is not available in this phase';
  if (isVerbHint(error)) return 'must be one of the listed verbs';
  const text = error.detail;
  const missing = /^must have required property '([^']*)'/.exec(text);
  if (missing) return `${nameOf(missing[1] ?? '')} is missing`;
  if (text.startsWith('must NOT have additional propert')) {
    const extra = /'([^']*)'$/.exec(text);
    return extra
      ? `'${nameOf(extra[1] ?? '')}' is not a known field`
      : 'has a field that is not known';
  }
  if (/allowed values/.test(text)) return 'must be one of the listed values';
  return text;
}

/** The refusal of one validator error: its code, and a detail of where and what, at most DETAIL_MAX_CHARS. */
export function refusalOf(error: OutputError): Refusal {
  const detail = `${whereOf(error.path)}: ${whatOf(error)}`;
  return {
    reason: error.code,
    detail:
      detail.length <= DETAIL_MAX_CHARS ? detail : `${detail.slice(0, DETAIL_MAX_CHARS - 3)}...`,
  };
}
