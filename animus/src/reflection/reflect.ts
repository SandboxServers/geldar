/**
 * One sleep reflection (spec 5.4, Appendix B.2): build the digest, ask the model once (with one
 * retry on invalid output), apply the result, and record the attempt as a journal row and a
 * `reflection` event. A failed attempt applies nothing and is recorded; it never throws.
 */
import type { Reflection, WorldEvent } from '@geldar/contract';
import type { JobSettings } from '../config.ts';
import { newId } from '../ids.ts';
import {
  type AgentIdentity,
  type Embedder,
  type EventPublisher,
  type Journal,
  type MemoryStore,
  type MindEvent,
  type ModelClient,
  ModelError,
  type ModelMessage,
  type OutputError,
  type OutputValidator,
  type PromptLibrary,
  REFLECTION_COST,
  type ReflectionDue,
  type ReflectionPromptVars,
  type ThoughtRow,
} from '../ports/index.ts';
import { type ApplyResult, applyReflection, type LogLine } from './apply.ts';
import { buildDigest, type InventoryReading } from './digest.ts';

/** The versions every thought records (wave 5 conventions). */
export interface ThoughtStamp {
  schemaVersion: string;
  mindVersion: string;
  bodyVersion: string;
  modelConfig: string;
  effort: string;
}

/** What a reflection needs from the outside. */
export interface ReflectDeps {
  shard: string;
  agent: AgentIdentity;
  /** The model tag, fixed for the life. */
  model: string;
  settings: JobSettings;
  /** `memory.fatigue_days`. */
  fatigueDays: number;
  /** The shard's fatigue switch (spec 5.4: toggleable per shard). */
  fatigueRule: boolean;
  stamp: ThoughtStamp;
  store: MemoryStore;
  journal: Journal;
  embedder: Embedder;
  models: ModelClient;
  prompts: PromptLibrary;
  validator: OutputValidator;
  publisher: EventPublisher;
  now: () => Date;
  /** Where a failed apply or embedding is reported; `console.error` when not given. */
  log?: LogLine;
}

/** What one reflection works from. */
export interface ReflectInput {
  due: ReflectionDue;
  /** The tick the previous reflection covered up to. */
  sinceTick: number;
  events: MindEvent[];
  inventory: InventoryReading[];
  signal?: AbortSignal;
}

/** How a reflection ended. */
export type ReflectOutcome =
  | 'applied'
  | 'degraded'
  | 'invalid_output'
  | 'model_error'
  | 'apply_failed';

/** The result of `reflectOnce`. */
export interface ReflectResult {
  outcome: ReflectOutcome;
  thoughtId: string;
  apply?: ApplyResult;
  errors?: OutputError[];
}

function estimate(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Runs one reflection for `input.due` and records it. */
export async function reflectOnce(deps: ReflectDeps, input: ReflectInput): Promise<ReflectResult> {
  const { due } = input;
  const thoughtId = newId('th');
  const signal = input.signal ?? new AbortController().signal;
  const memory = await deps.store.loadDeterministic(due.lifeId, due.event.tick);
  const journal = await deps.journal.journalSince(due.lifeId, input.sinceTick);
  const last = memory.agent.lastSleepDay ?? memory.agent.bornDay ?? due.day;
  const degraded = deps.fatigueRule && due.day - last >= deps.fatigueDays;
  const digest = buildDigest({
    day: due.day,
    sinceTick: input.sinceTick,
    nowTick: due.event.tick,
    events: input.events,
    journal,
    inventory: input.inventory,
    beliefs: memory.beliefs,
    commitments: [...memory.beliefs, ...memory.dueCommitments].filter(
      (m) => m.provenance === 'commitment',
    ),
    knownNames: memory.relationships.map((r) => r.otherId),
  });
  const vars: ReflectionPromptVars = {
    agent: deps.agent,
    day: due.day,
    journal: journal.filter((j) => j.worldDay === due.day),
    goals: memory.goals,
    relationships: memory.relationships,
    beliefs: memory.beliefs,
    episodic: [],
    degraded,
    digest: digest.text,
  };
  const render = deps.prompts.render('reflection', vars);

  let messages: ModelMessage[] = render.messages;
  let raw: string | null = null;
  let thinkerId: string | null = null;
  let latencyMs = 0;
  let usage: Record<string, unknown> | null = null;
  let outcome: ReflectOutcome = 'invalid_output';
  let errors: OutputError[] | undefined;
  let applied: ApplyResult | undefined;
  let reflection: Reflection | null = null;
  const sent: ModelMessage[][] = [];

  for (let attempt = 0; attempt < 2 && outcome === 'invalid_output'; attempt++) {
    sent.push(messages);
    try {
      const completion = await deps.models.complete(
        {
          model: deps.model,
          messages,
          maxTokens: deps.settings.maxTokens,
          temperature: deps.settings.temperature,
          deadline: new Date(deps.now().getTime() + deps.settings.deadlineS * 1000),
          responseSchema: render.responseSchema,
          reasoning: deps.settings.reasoning,
          effort: deps.stamp.effort,
          stablePrefixChars: render.stablePrefixChars,
        },
        signal,
      );
      raw = completion.text;
      thinkerId = completion.thinkerId;
      latencyMs += completion.latencyMs;
      usage = completion.usageReported ? { ...completion.usageReported, source: 'provider' } : null;
    } catch (error) {
      outcome = 'model_error';
      errors = [
        {
          code: 'empty',
          path: '',
          detail: error instanceof ModelError ? error.code : 'internal',
        },
      ];
      break;
    }
    const parsed = deps.validator.parseReflection(raw, { degraded });
    if (parsed.ok) {
      reflection = parsed.value;
      try {
        applied = await applyReflection(deps, parsed.value, {
          lifeId: due.lifeId,
          day: due.day,
          thoughtId,
          degraded,
          digest,
          beliefs: memory.beliefs,
        });
        outcome = degraded ? 'degraded' : 'applied';
        errors = undefined;
      } catch (error) {
        // Nothing was written (the store commits all or nothing); the sleep day stays unset.
        (deps.log ?? ((message: string) => console.error(message)))(
          `reflection ${thoughtId}: apply failed, nothing stored: ${error}`,
        );
        outcome = 'apply_failed';
      }
    } else {
      errors = parsed.errors;
      messages = [...render.messages, deps.validator.correctiveMessage(parsed.errors, raw)];
    }
  }

  const chars = (sent.at(-1) ?? []).reduce((sum, m) => sum + m.content.length, 0);
  const row: ThoughtRow = {
    thoughtId,
    lifeId: due.lifeId,
    at: deps.now().toISOString(),
    worldDay: due.day,
    worldTick: due.event.tick,
    wakeReason: 'reflection',
    snapshot: null,
    modelInput: sent.at(-1) ?? null,
    promptTemplateVersion: render.templateVersion,
    schemaVersion: deps.stamp.schemaVersion,
    mindVersion: deps.stamp.mindVersion,
    bodyVersion: deps.stamp.bodyVersion,
    modelConfig: deps.stamp.modelConfig,
    thinkerId,
    effort: deps.stamp.effort,
    tokensInEstimated: estimate(chars),
    tokensOutEstimated: raw === null ? null : estimate(raw.length),
    providerUsage: usage,
    rawOutput: raw,
    parsed: reflection,
    latencyMs,
    creditsReserved: REFLECTION_COST,
    creditsSettled: REFLECTION_COST,
  };
  await deps.journal.recordThought(row);
  const event: WorldEvent = {
    source_event_id: newId('ev'),
    at: row.at,
    shard: deps.shard,
    world_day: due.day,
    world_tick: due.event.tick,
    type: 'reflection',
    agent_id: due.lifeId,
    ...(thinkerId === null ? {} : { thinker_id: thinkerId }),
    payload: {
      thought_id: thoughtId,
      outcome,
      degraded,
      attempts: sent.length,
      memories_written: applied?.memoriesWritten ?? 0,
      errors: (errors ?? []).map((e) => ({ code: e.code, path: e.path })),
    },
  };
  await deps.publisher.publish(event);
  return {
    outcome,
    thoughtId,
    ...(applied ? { apply: applied } : {}),
    ...(errors ? { errors } : {}),
  };
}
