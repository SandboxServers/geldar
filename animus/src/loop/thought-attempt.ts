/**
 * One model call of a thinking cycle: its admission, the call itself under the Thinker's bound, the
 * validation of the reply, and the `thoughts` row for it.
 */

import type { ModelCompletion, ModelMessage } from '../ports/index.ts';
import { ModelError } from '../ports/index.ts';
import { THOUGHT_COST } from './admission.ts';
import { bounded, CycleAborted } from './cycle-await.ts';
import type { Attempt, Cycle } from './cycle-state.ts';
import { jobShape } from './effort.ts';
import type { LoopEnv } from './loop-env.ts';
import { callWaitingForThinker } from './thinker-wait.ts';
import { recordThought } from './thought-store.ts';

/** One model call with its admission, validation and journal row. */
export async function attemptThought(
  env: LoopEnv,
  cycle: Cycle,
  thoughtId: string,
  wakeReason: string,
  messages: ModelMessage[],
): Promise<Attempt> {
  const { deps, options } = env;
  const reservation = deps.admission.reserve(THOUGHT_COST);
  if (reservation === null) return { kind: 'tired' };
  const shape = jobShape(cycle.effort.level, options.thought);
  cycle.calls++;
  const call = (): Promise<ModelCompletion> =>
    deps.model.complete(
      {
        model: options.model,
        messages,
        maxTokens: shape.maxTokens,
        temperature: options.thought.temperature,
        deadline: new Date(env.now() + shape.deadlineS * 1000),
        responseSchema: cycle.render.responseSchema,
        reasoning: shape.reasoning,
        effort: cycle.effort.level,
        stablePrefixChars: cycle.render.stablePrefixChars,
      },
      env.signal,
    );
  // The Thinker's own deadline, the wait for a Thinker and one step of slack bound the call.
  const thinkerBound = shape.deadlineS * 1000 + (options.thinkerWaitMs ?? 0) + env.stepMs;
  let completion: ModelCompletion;
  env.log({
    event: 'thinker_request_sent',
    life_id: options.lifeId,
    thought_id: thoughtId,
    model: options.model,
    elapsed_ms: env.elapsed(),
  });
  try {
    completion = await bounded(
      callWaitingForThinker(call, {
        model: options.model,
        lifeId: options.lifeId,
        waitMs: options.thinkerWaitMs ?? 0,
        awaitThinker: deps.awaitThinker,
        signal: env.signal,
        log: (line) => env.log(line),
      }),
      thinkerBound,
      'thinker',
    );
  } catch (error) {
    const code = error instanceof ModelError ? error.code : 'internal';
    reservation.release();
    env.log({
      event: 'thinker_reply',
      life_id: options.lifeId,
      thought_id: thoughtId,
      ok: false,
      error_code: error instanceof CycleAborted ? error.reason : code,
      elapsed_ms: env.elapsed(),
    });
    if (error instanceof CycleAborted) throw error;
    cycle.errorCode = code;
    await recordThought(
      env,
      cycle,
      thoughtId,
      wakeReason,
      messages,
      null,
      null,
      THOUGHT_COST,
      0,
      code,
    );
    return { kind: 'error', code };
  }
  reservation.settle();
  env.log({
    event: 'thinker_reply',
    life_id: options.lifeId,
    thought_id: thoughtId,
    ok: true,
    elapsed_ms: env.elapsed(),
  });
  cycle.latencyMs += completion.latencyMs;
  cycle.thinkerId = completion.thinkerId;
  const parsed = deps.validator.parseThought(completion.text);
  const value = parsed.ok ? parsed.value : null;
  await recordThought(
    env,
    cycle,
    thoughtId,
    wakeReason,
    messages,
    completion,
    value,
    THOUGHT_COST,
    THOUGHT_COST,
  );
  if (parsed.ok) return { kind: 'ok', thought: parsed.value, completion };
  return { kind: 'invalid', errors: parsed.errors, completion };
}
