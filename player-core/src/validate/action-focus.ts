import type { OutputError } from '../ports/index.ts';
import { ACTION_FIELDS } from './action-shapes.ts';
import { isObject, PHASE0_VERBS } from './bounds.ts';

/** An error path that points into one action of `/actions`: the index is group 1. */
const ACTION_PATH = /^\/actions\/(\d+)(?:\/|$)/;

/**
 * The errors to report when the first schema error is in one action (spec 5.3.4). The schema is a
 * union over the verbs, so its messages for the other verbs are noise. This keeps the problems of
 * the verb the model named (missing and extra fields) and one line listing the valid verbs, verb
 * line first so the corrective cap of five never drops it. Returns undefined when the path is not
 * an action, the action is not an object, or the verb has no missing or extra field: the full
 * schema list is then reported.
 */
export function focusActionErrors(value: unknown, firstPath: string): OutputError[] | undefined {
  const match = ACTION_PATH.exec(firstPath);
  if (match === null || !isObject(value) || !Array.isArray(value.actions)) return undefined;
  const index = Number(match[1]);
  const action: unknown = value.actions[index];
  if (!isObject(action)) return undefined;
  const verbLine: OutputError = {
    code: 'schema',
    path: `/actions/${index}/do`,
    detail: `valid verbs: ${PHASE0_VERBS.join(', ')}`,
  };
  const fields = typeof action.do === 'string' ? ACTION_FIELDS[action.do] : undefined;
  if (fields === undefined) return [verbLine];
  const problems: OutputError[] = [];
  for (const field of fields) {
    if (!(field in action)) {
      problems.push({
        code: 'schema',
        path: `/actions/${index}`,
        detail: `must have required property '${field}'`,
      });
    }
  }
  for (const key of Object.keys(action)) {
    if (!fields.includes(key)) {
      problems.push({
        code: 'schema',
        path: `/actions/${index}`,
        detail: `must NOT have additional property '${key}'`,
      });
    }
  }
  return problems.length === 0 ? undefined : [verbLine, ...problems];
}
