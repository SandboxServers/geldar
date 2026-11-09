/** Strict validation of model output (P0-29): schema, Phase 0 allow-list, bounds. */
import type { Reflection, Thought } from '@geldar/contract';
import type { ModelMessage, OutputError, OutputResult, OutputValidator } from '../ports/index.ts';
import { type Bounds, DEFAULT_BOUNDS } from './bounds.ts';
import { correctiveMessage } from './corrective.ts';
import type { InputOptions } from './json-input.ts';
import { parseReflectionOutput } from './reflection-output.ts';
import { parseThoughtOutput } from './thought-output.ts';

export {
  type Bounds,
  DEFAULT_BOUNDS,
  MAX_OUTPUT_BYTES,
  PHASE0_PROGRAMS,
  PHASE0_VERBS,
} from './bounds.ts';
export { CORRECTIVE_ECHO_CHARS, CORRECTIVE_MAX_ERRORS } from './corrective.ts';
export type { InputOptions } from './json-input.ts';

/** Options of {@link createOutputValidator}: the shard's bounds and the output mode. */
export type OutputValidatorOptions = Partial<Bounds> & InputOptions;

/** An `OutputValidator` whose `correctiveMessage` can also echo the rejected text. */
export interface StrictOutputValidator extends OutputValidator {
  /** As the port's method; `rejected` is echoed, cut to 512 characters and JSON-escaped. */
  correctiveMessage(errors: OutputError[], rejected?: string): ModelMessage;
}

/** Builds the validator. Defaults are the Phase 0 shard's: border 1500, chat 256, contract caps. */
export function createOutputValidator(options: OutputValidatorOptions = {}): StrictOutputValidator {
  const bounds: Bounds = {
    worldBorderRadius: options.worldBorderRadius ?? DEFAULT_BOUNDS.worldBorderRadius,
    sayMaxChars: options.sayMaxChars ?? DEFAULT_BOUNDS.sayMaxChars,
    maxWorldTicks: options.maxWorldTicks ?? DEFAULT_BOUNDS.maxWorldTicks,
    maxBlockOperations: options.maxBlockOperations ?? DEFAULT_BOUNDS.maxBlockOperations,
  };
  const input: InputOptions = {
    constrainedOutput: options.constrainedOutput ?? true,
    ...(options.onNormalise === undefined ? {} : { onNormalise: options.onNormalise }),
  };
  return {
    parseThought: (text: string): OutputResult<Thought> => parseThoughtOutput(text, bounds, input),
    parseReflection: (text: string, o: { degraded: boolean }): OutputResult<Reflection> =>
      parseReflectionOutput(text, o.degraded, input),
    correctiveMessage,
  };
}
