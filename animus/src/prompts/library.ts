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
  DEFAULT_MAX_BELIEFS,
  relationshipLines,
  renderBeliefs,
  renderCommitments,
  renderEpisodic,
  renderGoals,
  renderJournal,
} from './render-memory.ts';
import { renderSnapshot } from './render-snapshot.ts';
import { fill, loadTemplate, type ParsedTemplate, refuseUnknownSlots } from './template.ts';
import { renderWorldText, stableJson, type WorldTextLine } from './world-text.ts';

/** The default budget of the thought's user message, in characters (`mind.prompt_budget_chars`). */
export const DEFAULT_THOUGHT_BUDGET_CHARS = 12_000;

/** The longest day digest a reflection shows, in characters: the whole digest, not one line of it. */
const MAX_DIGEST_CHARS = 8192;

/** The size limits of the prompts. */
export interface PromptLimits {
  /** Characters of the thought's user message; the quoted world text gets what is left. */
  thoughtBudgetChars: number;
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
  3: ['day', 'journal_today', 'goal_stack', 'beliefs', 'memories', 'quoted_world_text'],
};

/** The thought template a new Mind renders: `thought/v2.md`. `thought/v1.md` stays loadable. */
export const DEFAULT_THOUGHT_VERSION = 2;

const THOUGHT_BLOCKS = [1, 2, 3, 4, 5, 6];
const REFLECTION_BLOCKS = [1, 2, 3];

/** Options of {@link createPromptLibrary}. */
export interface PromptLibraryOptions {
  /** The `prompts/` directory. Defaults to the repository's. */
  promptsDir?: string;
  /** The reflection and body-api template version to load. Only 1 exists. */
  version?: number;
  /** The thought template version to load. Defaults to {@link DEFAULT_THOUGHT_VERSION}; 1 stays loadable. */
  thoughtVersion?: number;
  /** See {@link PromptLimits.thoughtBudgetChars}. */
  thoughtBudgetChars?: number;
  /** See {@link PromptLimits.maxBeliefs}. */
  maxBeliefs?: number;
}

/** Loads and hashes the templates now; throws on an unknown slot, a missing block or a bad file. */
export function createPromptLibrary(options: PromptLibraryOptions = {}): PromptLibrary {
  const dir = options.promptsDir ?? join(repoRoot(), 'prompts');
  const n = options.version ?? 1;
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
    n,
    join(dir, 'reflection', `v${n}.md`),
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
    thoughtBudgetChars: options.thoughtBudgetChars ?? DEFAULT_THOUGHT_BUDGET_CHARS,
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
  const schema = thoughtDecodeSchema();
  const self = vars.snapshot.self;
  const values: Record<string, string> = {
    intent_and_actions_schema: stableJson(schema, 200),
    body_api_table: bodyApi,
    name: vars.agent.name,
    personality_seed: vars.agent.personalitySeed,
    skill_index: 'none yet. You have not learned any skills.',
    goal_stack: renderGoals(vars.goals),
    commitments: renderCommitments(vars.dueCommitments),
    beliefs: renderBeliefs(vars.beliefs, limits.maxBeliefs),
    memories: renderEpisodic(vars.episodic),
    days: String(vars.snapshot.world_time.day),
    days_since_sleep: String(self.days_since_sleep),
    credits: String(self.budget_remaining_thoughts),
    wake_reason: vars.wake.reason,
    recent_thoughts: renderJournal(vars.recentThoughts),
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
    limits.thoughtBudgetChars - withoutWorld.length,
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
  const values: Record<string, string> = {
    reflection_schema: stableJson(schema, 200),
    memories_max: String(max),
    degraded_note: vars.degraded
      ? fill(degradedText, { memories_max: String(max) }, 'degraded')
      : '',
    name: vars.agent.name,
    personality_seed: vars.agent.personalitySeed,
    day: String(vars.day),
    journal_today: renderJournal(vars.journal),
    goal_stack: renderGoals(vars.goals),
    beliefs: renderBeliefs(vars.beliefs, limits.maxBeliefs),
    memories: renderEpisodic(vars.episodic),
    quoted_world_text: renderWorldText([
      ...relationshipLines(vars.relationships, 'relationship', 20),
      ...(vars.digest.trim() === ''
        ? []
        : [
            {
              kind: 'day_digest',
              fields: { text: vars.digest },
              maxChars: MAX_DIGEST_CHARS,
            } satisfies WorldTextLine,
          ]),
    ]),
  };
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
