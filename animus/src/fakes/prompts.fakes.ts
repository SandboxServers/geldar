import {
  type Reflection,
  type Thought,
  validateReflection,
  validateThought,
} from '@geldar/contract';
import type {
  ModelMessage,
  OutputError,
  OutputResult,
  OutputValidator,
  PromptLibrary,
  PromptRender,
  ReflectionPromptVars,
  ThoughtPromptVars,
} from '../ports/index.ts';

const STABLE = 'You are a fake agent. Answer with JSON.';

/**
 * A `PromptLibrary` with one fixed system message and a user message made from the variables as
 * JSON. It records what it was given. It is not a prompt: it only gives the loop something with
 * the right shape.
 */
export class FakePromptLibrary implements PromptLibrary {
  /** Every render call, in order. */
  readonly renders: {
    kind: 'thought' | 'reflection';
    vars: ThoughtPromptVars | ReflectionPromptVars;
  }[] = [];

  render(kind: 'thought', vars: ThoughtPromptVars): PromptRender;
  render(kind: 'reflection', vars: ReflectionPromptVars): PromptRender;
  render(
    kind: 'thought' | 'reflection',
    vars: ThoughtPromptVars | ReflectionPromptVars,
  ): PromptRender {
    this.renders.push({ kind, vars });
    return {
      messages: [
        { role: 'system', content: STABLE },
        { role: 'user', content: JSON.stringify({ kind, agent: vars.agent }) },
      ],
      templateVersion: 'fake',
      stablePrefixChars: STABLE.length,
      responseSchema: { type: 'object' },
    };
  }
}

/**
 * An `OutputValidator` that parses the text as JSON and checks it with the contract validators, with
 * no Phase 0 allow-list or extra bounds. The `degraded` option is ignored.
 */
export class FakeOutputValidator implements OutputValidator {
  parseThought(text: string): OutputResult<Thought> {
    const parsed = parseJson(text);
    if (!parsed.ok) return parsed;
    const result = validateThought(parsed.value);
    return result.ok ? result : { ok: false, errors: result.errors.map(schemaError) };
  }

  parseReflection(text: string, _options: { degraded: boolean }): OutputResult<Reflection> {
    const parsed = parseJson(text);
    if (!parsed.ok) return parsed;
    const result = validateReflection(parsed.value);
    return result.ok ? result : { ok: false, errors: result.errors.map(schemaError) };
  }

  correctiveMessage(errors: OutputError[]): ModelMessage {
    const lines = errors.map((e) => `${e.code} at ${e.path === '' ? '/' : e.path}`);
    return { role: 'user', content: `Your answer was rejected: ${lines.join('; ')}. Try again.` };
  }
}

function parseJson(text: string): OutputResult<unknown> {
  if (text.trim() === '') {
    return { ok: false, errors: [{ code: 'empty', path: '', detail: 'the output is empty' }] };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      errors: [{ code: 'not_json', path: '', detail: 'the output is not JSON' }],
    };
  }
}

function schemaError(message: string): OutputError {
  return { code: 'schema', path: '', detail: message.slice(0, 256) };
}
