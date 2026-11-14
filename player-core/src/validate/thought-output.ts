import { type Thought, validateThought } from '@geldar/contract';
import type { OutputResult } from '../ports/index.ts';
import { focusActionErrors } from './action-focus.ts';
import {
  type Bounds,
  checkPosition,
  checkProgramArguments,
  ErrorList,
  isObject,
  MAX_CHECKPOINT_BYTES,
  PHASE0_PROGRAMS,
  PHASE0_VERBS,
  safeName,
} from './bounds.ts';
import { type InputOptions, readJson, splitSchemaMessage } from './json-input.ts';

/** Where an action carries a position, by verb. */
const ACTION_POSITION_FIELD: Record<string, string> = {
  goto: 'target',
  place: 'at',
  open: 'at',
  deposit: 'at',
  withdraw: 'at',
  till: 'at',
};

/**
 * The Phase 0 allow-list, applied to the parsed JSON before the schema so that an unknown verb or
 * program gets the reason `not_allowed` rather than a wall of schema errors. Skills, `build`,
 * `follow`, `give`, signs, books, `offer`, governance and `note` all stop here.
 */
function checkAllowList(value: unknown, errors: ErrorList): void {
  if (!isObject(value)) return;
  if (Array.isArray(value.actions)) {
    value.actions.forEach((action: unknown, i: number) => {
      if (!isObject(action)) return;
      const verb = action.do;
      if (typeof verb === 'string' && !PHASE0_VERBS.includes(verb)) {
        errors.add(
          'not_allowed',
          `/actions/${i}/do`,
          `the action ${safeName(verb)} is not available`,
        );
      }
    });
  }
  if (isObject(value.intent)) {
    const program = value.intent.program;
    if (typeof program === 'string' && !PHASE0_PROGRAMS.includes(program)) {
      errors.add(
        'not_allowed',
        '/intent/program',
        `the routine ${safeName(program)} is not available`,
      );
    }
  }
}

/** Bounds the schema cannot express, on a thought that already passed it. */
function checkBounds(thought: Thought, bounds: Bounds, errors: ErrorList): void {
  if (typeof thought.say === 'string' && Array.from(thought.say).length > bounds.sayMaxChars) {
    errors.add('out_of_bounds', '/say', `must be at most ${bounds.sayMaxChars} characters`);
  }
  (thought.actions ?? []).forEach((action, i) => {
    const field = ACTION_POSITION_FIELD[action.do];
    if (field === undefined) return;
    const value = (action as unknown as Record<string, unknown>)[field];
    if (typeof value === 'object' && value !== null) {
      checkPosition(value, `/actions/${i}/${field}`, bounds, errors);
    }
  });
  const intent = thought.intent;
  if (intent === undefined) return;
  checkProgramArguments(
    String(intent.program),
    intent.arguments,
    '/intent/arguments',
    bounds,
    errors,
  );
  if (intent.limits.max_world_ticks > bounds.maxWorldTicks) {
    errors.add(
      'out_of_bounds',
      '/intent/limits/max_world_ticks',
      `must be at most ${bounds.maxWorldTicks}`,
    );
  }
  if (intent.limits.max_block_operations > bounds.maxBlockOperations) {
    errors.add(
      'out_of_bounds',
      '/intent/limits/max_block_operations',
      `must be at most ${bounds.maxBlockOperations}`,
    );
  }
  if (
    intent.checkpoint !== undefined &&
    Buffer.byteLength(JSON.stringify(intent.checkpoint), 'utf8') > MAX_CHECKPOINT_BYTES
  ) {
    errors.add(
      'out_of_bounds',
      '/intent/checkpoint',
      `must be at most ${MAX_CHECKPOINT_BYTES} bytes`,
    );
  }
}

/**
 * Reads model output as a `Thought` (spec 5.3.4, threat model section 4): size, JSON, the Phase 0
 * allow-list, the contract schema, then bounds. Any failure is returned, never repaired.
 */
export function parseThoughtOutput(
  text: string,
  bounds: Bounds,
  input: InputOptions,
): OutputResult<Thought> {
  const read = readJson(text, input);
  if (!read.ok) return read;
  const errors = new ErrorList();
  checkAllowList(read.value, errors);
  if (!errors.empty) return { ok: false, errors: errors.errors };
  const schema = validateThought(read.value);
  if (!schema.ok) {
    const focused = focusActionErrors(read.value, splitSchemaMessage(schema.errors[0] ?? '').path);
    if (focused !== undefined) return { ok: false, errors: focused };
    for (const message of schema.errors) {
      const { path, detail } = splitSchemaMessage(message);
      errors.add('schema', path, detail);
    }
    return { ok: false, errors: errors.errors };
  }
  checkBounds(schema.value, bounds, errors);
  return errors.empty ? { ok: true, value: schema.value } : { ok: false, errors: errors.errors };
}
