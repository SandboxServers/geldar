import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../config.ts';
import type {
  ModelMessage,
  PromptLibrary,
  PromptRender,
  ReflectionPromptVars,
  ThoughtPromptVars,
} from '../ports/index.ts';
import { renderBodyApi } from './body-api.ts';
import { reflectionDecodeSchema, thoughtDecodeSchema } from './decode-schema.ts';
import {
  beliefLines,
  DEFAULT_MAX_BELIEFS,
  episodicLines,
  fitCommitments,
  fitMemory,
  journalLines,
  relationshipLines,
  renderCommitments,
  renderGoals,
  renderLines,
} from './render-memory.ts';
import { renderSnapshot } from './render-snapshot.ts';
import { fill, loadTemplate, type ParsedTemplate, refuseUnknownSlots } from './template.ts';
import { wakeWording } from './wake-wording.ts';
import {
  fitEscaped,
  promptCost,
  renderWorldText,
  stableJson,
  type WorldTextLine,
} from './world-text.ts';

/**
 * The context window of the pinned models (`num_ctx` in `shards/phase0.yaml` `model_pins`, decision
 * 0051): the Ollama prompt and the output share it.
 */
export const CONTEXT_TOKENS = 8192;

/** The room kept for the output: above every `max_tokens` a job sends (600 and 1200 in `shards/phase0.yaml`). */
export const OUTPUT_RESERVE_TOKENS = 2048;

/**
 * The system message of thought v2 costs 3354 estimated tokens and the reflection's 773 (measured
 * with {@link promptCost} on the sample prompts). 2500 for the user message leaves
 * 8192 - 2048 - 3354 = 2790 at the top, so the sum fits with a margin of 290; the estimate charges
 * one token per three ASCII characters, which a BPE tokenizer beats on English, and the schema is a
 * grammar Ollama does not send as prompt text. A larger budget needs a larger `num_ctx`.
 */
export const DEFAULT_THOUGHT_BUDGET_TOKENS = 2_500;

/**
 * The default budget of the reflection's user message, in the same estimated tokens. Its system
 * message is 773 and its output cap 1200, so 4000 + 773 + 2048 = 6821 fits num_ctx 8192, with the
 * same output reserve as the thought.
 */
export const DEFAULT_REFLECTION_BUDGET_TOKENS = 4_000;

/** The share of a budget the memory blocks (beliefs, memories, recent thoughts) may use. */
export const MEMORY_SHARE = 0.6;

/** The share of the reflection budget the open commitments may use, within {@link MEMORY_SHARE}. */
export const COMMITMENT_SHARE = 0.25;

/**
 * The share of the reflection budget the day digest may use, cut first; the memory blocks keep
 * {@link MEMORY_SHARE} and the relationships get what the digest and the blocks leave.
 */
export const DIGEST_SHARE = 0.35;

/** Estimated tokens kept back from the digest's cap for the section's heading, footer and line frame. */
const DIGEST_RESERVE = 120;

/** The longest day digest, in characters before escaping (the most a digest may be), cut to its cost. */
const MAX_DIGEST_CHARS = 8192;

/** The size limits of the prompts. */
export interface PromptLimits {
  /** Estimated tokens of the thought's user message; the memory blocks and the quoted section share it. */
  thoughtBudgetTokens: number;
  /** Estimated tokens of the reflection's user message; the blocks and the quoted section share it. */
  reflectionBudgetTokens: number;
  /** Beliefs shown in a prompt, newest first (`mind.max_beliefs`). */
  maxBeliefs: number;
}

/** The slots each block of the thought template may use. */
const THOUGHT_SLOTS: Record<number, string[]> = {
  1: ['intent_and_actions_schema'],
  2: ['body_api_table'],
  3: ['name', 'personality_seed'],
  4: ['skill_index'],
  5: ['goal_stack', 'commitments', 'beliefs', 'memories'],
  6: [
    'days',
    'days_since_sleep',
    'credits',
    'thinking_left',
    'wake_reason',
    'recent_thoughts',
    'intent_state',
    'snapshot',
    'quoted_world_text',
  ],
};

/** The slots each block of the reflection template may use. */
const REFLECTION_SLOTS: Record<number, string[]> = {
  1: ['reflection_schema', 'memories_max', 'degraded_note'],
  2: ['name', 'personality_seed'],
  3: [
    'day',
    'journal_today',
    'goal_stack',
    'commitments',
    'beliefs',
    'memories',
    'quoted_world_text',
  ],
};

/**
 * The thought template a new Mind renders: `thought/v5.md`. `thought/v1.md` to `v4.md` stay loadable
 * (v2 and v3 use the `credits` slot, which the renderer still fills).
 */
export const DEFAULT_THOUGHT_VERSION = 5;

/** The body-api template a new Mind renders: `body-api/v4.json`. `v1` to `v3` stay loadable. */
export const DEFAULT_BODY_API_VERSION = 4;

/** The reflection template a new Mind renders: `reflection/v2.md`. `reflection/v1.md` stays loadable. */
export const DEFAULT_REFLECTION_VERSION = 2;

const THOUGHT_BLOCKS = [1, 2, 3, 4, 5, 6];
const REFLECTION_BLOCKS = [1, 2, 3];

/** Options of {@link createPromptLibrary}. */
export interface PromptLibraryOptions {
  /** The `prompts/` directory. Defaults to the repository's. */
  promptsDir?: string;
  /** The body-api template version to load. Defaults to {@link DEFAULT_BODY_API_VERSION}; 1 stays loadable. */
  version?: number;
  /** The reflection template version to load. Defaults to {@link DEFAULT_REFLECTION_VERSION}; 1 stays loadable. */
  reflectionVersion?: number;
  /** The thought template version to load. Defaults to {@link DEFAULT_THOUGHT_VERSION}; 1 stays loadable. */
  thoughtVersion?: number;
  /** See {@link PromptLimits.thoughtBudgetTokens}. */
  thoughtBudgetTokens?: number;
  /** See {@link PromptLimits.reflectionBudgetTokens}. */
  reflectionBudgetTokens?: number;
  /** See {@link PromptLimits.maxBeliefs}. */
  maxBeliefs?: number;
}

/** Loads and hashes the templates now; throws on an unknown slot, a missing block or a bad file. */
export function createPromptLibrary(options: PromptLibraryOptions = {}): PromptLibrary {
  const dir = options.promptsDir ?? join(repoRoot(), 'prompts');
  const n = options.version ?? DEFAULT_BODY_API_VERSION;
  const r = options.reflectionVersion ?? DEFAULT_REFLECTION_VERSION;
  const t = options.thoughtVersion ?? DEFAULT_THOUGHT_VERSION;
  const thought = loadChecked(
    'thought',
    t,
    join(dir, 'thought', `v${t}.md`),
    THOUGHT_BLOCKS,
    THOUGHT_SLOTS,
  );
  const reflection = loadChecked(
    'reflection',
    r,
    join(dir, 'reflection', `v${r}.md`),
    REFLECTION_BLOCKS,
    REFLECTION_SLOTS,
  );
  const bodyFile = readFileSync(join(dir, 'body-api', `v${n}.json`));
  const bodyApi = renderBodyApi(JSON.parse(bodyFile.toString('utf8')));
  const bodyApiVersion = `body-api@${n}+sha256:${createHash('sha256').update(bodyFile).digest('hex').slice(0, 12)}`;
  const degradedText = reflection.variants.get('degraded');
  if (degradedText === undefined) throw new Error('reflection template has no degraded variant');
  refuseUnknownSlots(degradedText, new Set(['memories_max']), 'reflection variant degraded');

  const limits: PromptLimits = {
    thoughtBudgetTokens: options.thoughtBudgetTokens ?? DEFAULT_THOUGHT_BUDGET_TOKENS,
    reflectionBudgetTokens: options.reflectionBudgetTokens ?? DEFAULT_REFLECTION_BUDGET_TOKENS,
    maxBeliefs: options.maxBeliefs ?? DEFAULT_MAX_BELIEFS,
  };
  return new TemplatePromptLibrary(
    thought,
    reflection,
    bodyApi,
    bodyApiVersion,
    degradedText,
    limits,
  );
}

class TemplatePromptLibrary implements PromptLibrary {
  readonly thoughtVersion: string;
  readonly reflectionVersion: string;
  readonly bodyApiVersion: string;
  private readonly thought: ParsedTemplate;
  private readonly reflection: ParsedTemplate;
  private readonly bodyApi: string;
  private readonly degradedText: string;
  private readonly limits: PromptLimits;

  constructor(
    thought: ParsedTemplate,
    reflection: ParsedTemplate,
    bodyApi: string,
    bodyApiVersion: string,
    degradedText: string,
    limits: PromptLimits,
  ) {
    this.thought = thought;
    this.reflection = reflection;
    this.bodyApi = bodyApi;
    this.bodyApiVersion = bodyApiVersion;
    this.degradedText = degradedText;
    this.limits = limits;
    this.thoughtVersion = thought.version;
    this.reflectionVersion = reflection.version;
  }

  render(kind: 'thought', vars: ThoughtPromptVars): PromptRender;
  render(kind: 'reflection', vars: ReflectionPromptVars): PromptRender;
  render(
    kind: 'thought' | 'reflection',
    vars: ThoughtPromptVars | ReflectionPromptVars,
  ): PromptRender {
    return kind === 'thought'
      ? renderThought(this.thought, this.bodyApi, vars as ThoughtPromptVars, this.limits)
      : renderReflection(
          this.reflection,
          this.degradedText,
          vars as ReflectionPromptVars,
          this.limits,
        );
  }
}

function loadChecked(
  kind: string,
  n: number,
  path: string,
  blocks: number[],
  slots: Record<number, string[]>,
): ParsedTemplate {
  const t = loadTemplate(kind, n, path);
  for (const b of blocks) {
    const text = t.blocks.get(b);
    if (text === undefined) throw new Error(`${path}: block ${b} is missing`);
    refuseUnknownSlots(text, new Set(slots[b]), `${kind} block ${b}`);
  }
  for (const b of t.blocks.keys()) {
    if (!blocks.includes(b)) throw new Error(`${path}: unexpected block ${b}`);
  }
  return t;
}

/** The identity strings go into the system message, so they are held to plain single-line text. */
function checkIdentity(name: string, seed: string): void {
  if (!/^[A-Za-z0-9_]{1,32}$/.test(name)) throw new Error('agent name is not a plain name');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: this rejects control characters
  if (seed.length === 0 || seed.length > 600 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(seed)) {
    throw new Error('personality seed must be one line of at most 600 characters');
  }
}

function block(
  t: ParsedTemplate,
  n: number,
  values: Record<string, string>,
  label: string,
): string {
  return fill(t.blocks.get(n) as string, values, `${label} block ${n}`);
}

function renderThought(
  t: ParsedTemplate,
  bodyApi: string,
  vars: ThoughtPromptVars,
  limits: PromptLimits,
): PromptRender {
  checkIdentity(vars.agent.name, vars.agent.personalitySeed);
  const snap = renderSnapshot(vars.snapshot);
  const world: WorldTextLine[] = [
    ...snap.world,
    ...relationshipLines(vars.relationships, 'person'),
  ];
  for (const e of vars.wake.events) {
    if (e.type === 'speech' && !e.payload.own) {
      world.push({ kind: 'wake_speech', fields: { from: e.payload.from, text: e.payload.text } });
    }
  }
  for (const e of vars.wake.digest) {
    if (e.type === 'speech' && !e.payload.own) {
      world.push({ kind: 'overheard', fields: { from: e.payload.from, text: e.payload.text } });
    }
  }
  // The due commitments get COMMITMENT_SHARE of the budget and come out of the memory share, as in
  // the reflection, so the user message stays inside the budget however many are due.
  const commitments = renderCommitments(
    fitCommitments(vars.dueCommitments, limits.thoughtBudgetTokens * COMMITMENT_SHARE),
  );
  const memory = fitMemory(
    {
      beliefs: beliefLines(vars.beliefs, limits.maxBeliefs),
      memories: episodicLines(vars.episodic),
      journal: journalLines(vars.recentThoughts),
    },
    limits.thoughtBudgetTokens * MEMORY_SHARE - promptCost(commitments),
  );
  const schema = thoughtDecodeSchema();
  const self = vars.snapshot.self;
  const values: Record<string, string> = {
    intent_and_actions_schema: stableJson(schema, 200),
    body_api_table: bodyApi,
    name: vars.agent.name,
    personality_seed: vars.agent.personalitySeed,
    skill_index: 'none yet. You have not learned any skills.',
    goal_stack: renderGoals(vars.goals),
    commitments,
    beliefs: renderLines(memory.beliefs),
    memories: renderLines(memory.memories),
    days: String(vars.snapshot.world_time.day),
    days_since_sleep: String(self.days_since_sleep),
    credits: String(self.budget_remaining_thoughts),
    thinking_left: String(self.budget_remaining_thoughts),
    wake_reason: wakeWording(vars.wake.reason),
    recent_thoughts: renderLines(memory.journal),
    intent_state:
      vars.snapshot.current_plan === null || vars.snapshot.current_plan === undefined
        ? 'none, you are not pursuing anything right now.'
        : 'see the plan line in QUOTED WORLD TEXT.',
    snapshot: snap.text,
    quoted_world_text: '',
  };
  // The user message is blocks 5 and 6; the quoted section gets the room the budget leaves.
  const withoutWorld = [5, 6].map((n) => block(t, n, values, 'thought')).join('\n\n');
  values.quoted_world_text = renderWorldText(
    world,
    limits.thoughtBudgetTokens - promptCost(withoutWorld),
  );
  const system = [1, 2, 3, 4].map((n) => block(t, n, values, 'thought')).join('\n\n');
  const user = [5, 6].map((n) => block(t, n, values, 'thought')).join('\n\n');
  return finish(t, system, user, schema);
}

function renderReflection(
  t: ParsedTemplate,
  degradedText: string,
  vars: ReflectionPromptVars,
  limits: PromptLimits,
): PromptRender {
  checkIdentity(vars.agent.name, vars.agent.personalitySeed);
  const schema = reflectionDecodeSchema(vars.degraded);
  const max = vars.degraded ? 2 : 8;
  const budget = limits.reflectionBudgetTokens;
  // The commitments (at most mind.max_commitments, most overdue first) get COMMITMENT_SHARE of the
  // budget and come out of the memory share, so the whole block stays inside the budget.
  const commitments = renderCommitments(
    fitCommitments(vars.commitments, budget * COMMITMENT_SHARE),
  );
  const memory = fitMemory(
    {
      beliefs: beliefLines(vars.beliefs, limits.maxBeliefs),
      memories: episodicLines(vars.episodic),
      journal: journalLines(vars.journal),
    },
    budget * MEMORY_SHARE - promptCost(commitments),
  );
  const values: Record<string, string> = {
    reflection_schema: stableJson(schema, 200),
    memories_max: String(max),
    degraded_note: vars.degraded
      ? fill(degradedText, { memories_max: String(max) }, 'degraded')
      : '',
    name: vars.agent.name,
    personality_seed: vars.agent.personalitySeed,
    day: String(vars.day),
    journal_today: renderLines(memory.journal),
    goal_stack: renderGoals(vars.goals),
    commitments,
    beliefs: renderLines(memory.beliefs),
    memories: renderLines(memory.memories),
    quoted_world_text: '',
  };
  // The user message is block 3; the quoted section gets the room the blocks leave. The digest is
  // cut after escaping to its share of the budget, and to the room, before the relationships.
  const room = budget - promptCost(block(t, 3, values, 'reflection'));
  const digestCap = Math.min(budget * DIGEST_SHARE, room - DIGEST_RESERVE);
  const digest = vars.digest.trim() === '' ? '' : fitEscaped(vars.digest, Math.max(0, digestCap));
  const world: WorldTextLine[] = [
    ...(digest === ''
      ? []
      : [{ kind: 'day_digest' as const, fields: { text: digest }, maxChars: MAX_DIGEST_CHARS }]),
    ...relationshipLines(vars.relationships, 'relationship', 20),
  ];
  values.quoted_world_text = renderWorldText(world, room);
  const system = [1, 2].map((n) => block(t, n, values, 'reflection')).join('\n\n');
  const user = block(t, 3, values, 'reflection');
  return finish(t, system, user, schema);
}

function finish(
  t: ParsedTemplate,
  system: string,
  user: string,
  responseSchema: Record<string, unknown>,
): PromptRender {
  const messages: ModelMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  return { messages, templateVersion: t.version, stablePrefixChars: system.length, responseSchema };
}
