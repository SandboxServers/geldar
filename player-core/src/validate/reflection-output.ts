import { type Reflection, validateReflection } from '@geldar/contract';
import type { OutputResult } from '../ports/index.ts';
import { ErrorList } from './bounds.ts';
import { type InputOptions, readJson, splitSchemaMessage } from './json-input.ts';

/** The most memories a degraded reflection keeps. */
export const DEGRADED_MEMORIES_MAX = 2;

/** The lists a degraded reflection must leave empty. */
const DEGRADED_EMPTY: (keyof Reflection)[] = [
  'relationship_updates',
  'beliefs_add',
  'beliefs_remove',
  'goals',
];

/**
 * Reads model output as a `Reflection`: the same pipeline as a thought (size, JSON, schema). The
 * degraded path (the agent is fatigued, spec 5.4) allows `memories_to_keep` of at most 2 and
 * nothing else beyond `day_summary`: the other lists must be empty.
 */
export function parseReflectionOutput(
  text: string,
  degraded: boolean,
  input: InputOptions,
): OutputResult<Reflection> {
  const read = readJson(text, input);
  if (!read.ok) return read;
  const errors = new ErrorList();
  const schema = validateReflection(read.value);
  if (!schema.ok) {
    for (const message of schema.errors) {
      const { path, detail } = splitSchemaMessage(message);
      errors.add('schema', path, detail);
    }
    return { ok: false, errors: errors.errors };
  }
  if (degraded) {
    const value = schema.value;
    if (value.memories_to_keep.length > DEGRADED_MEMORIES_MAX) {
      errors.add(
        'out_of_bounds',
        '/memories_to_keep',
        `a degraded reflection keeps at most ${DEGRADED_MEMORIES_MAX}`,
      );
    }
    for (const key of DEGRADED_EMPTY) {
      const list = value[key] as unknown[];
      if (list.length > 0) {
        errors.add('not_allowed', `/${key}`, 'a degraded reflection leaves this list empty');
      }
    }
  }
  return errors.empty ? { ok: true, value: schema.value } : { ok: false, errors: errors.errors };
}
