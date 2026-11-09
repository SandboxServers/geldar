/**
 * Prompts and output validation (spec 5.3, 5.4, 5.5, wave 5 conventions). The library turns typed
 * variables into a message list; the validator turns the model's text into a typed, checked
 * result. In-world text is untrusted: the renderer places speech, sign text and player names only
 * as JSON-escaped strings in the fixed "quoted world text" section of the user message, never in
 * the system message, and the validator is the control on the way back. P0-29 implements both.
 */
import type { Reflection, Snapshot, Thought } from '@geldar/contract';
import type { WakeDecision } from './attention.ts';
import type { GoalRow, JournalEntry, MemoryRow, RelationshipRow } from './memory.ts';
import type { ModelMessage } from './model.ts';

/** Who the agent is, as the prompts state it. */
export interface AgentIdentity {
  /** The display name (decision 0051). */
  name: string;
  lifeId: string;
  /** The approved personality seed. */
  personalitySeed: string;
}

/** The variables of the `thought` template. */
export interface ThoughtPromptVars {
  agent: AgentIdentity;
  /** The snapshot the thought is made from; its `heard` lines go in the quoted-world-text section. */
  snapshot: Snapshot;
  /** Why the Mind woke and the events behind it. */
  wake: WakeDecision;
  goals: GoalRow[];
  relationships: RelationshipRow[];
  /** Active beliefs. */
  beliefs: MemoryRow[];
  /** Commitments that fall due now. */
  dueCommitments: MemoryRow[];
  /** Episodic memories retrieved for this wake, nearest first. */
  episodic: MemoryRow[];
  /** The latest thoughts (the working window), oldest first. */
  recentThoughts: JournalEntry[];
}

/** The variables of the `reflection` template (the sleep reflection, spec 5.4). */
export interface ReflectionPromptVars {
  agent: AgentIdentity;
  /** The world day being summarised. */
  day: number;
  /** The day's thoughts, oldest first. */
  journal: JournalEntry[];
  goals: GoalRow[];
  relationships: RelationshipRow[];
  beliefs: MemoryRow[];
  /** Episodic memories retrieved for the day, nearest first. */
  episodic: MemoryRow[];
  /**
   * What the day's events came to (the reflection's digest of events, spec 5.4). Rendered inside the
   * user message as quoted data, escaped like other in-world text.
   */
  digest: string;
  /** True when the Mind is on the degraded path (a smaller output budget; see `parseReflection`). */
  degraded: boolean;
}

/** A rendered prompt. */
export interface PromptRender {
  messages: ModelMessage[];
  /** The version of the template file used, for example `v1`. Recorded on the thought. */
  templateVersion: string;
  /** Leading characters identical across renders of this template (the Thinker's cache hint). */
  stablePrefixChars: number;
  /** The JSON Schema the output must satisfy, to send as the job's `responseSchema`. */
  responseSchema: Record<string, unknown>;
}

/** The two templates. */
export type PromptKind = 'thought' | 'reflection';

/** Renders the templates in `prompts/`. */
export interface PromptLibrary {
  /** The template version id the thought prompt records, 	hought@1+sha256:<12 hex>. */
  readonly thoughtVersion: string;
  /** The reflection template's version id, eflection@1+sha256:<12 hex>. */
  readonly reflectionVersion: string;
  /** The Body API table's version id, ody-api@1+sha256:<12 hex>. */
  readonly bodyApiVersion: string;
  render(kind: 'thought', vars: ThoughtPromptVars): PromptRender;
  render(kind: 'reflection', vars: ReflectionPromptVars): PromptRender;
}

/** Why an output was rejected. */
export type OutputErrorCode =
  /** The text is not one JSON document. */
  | 'not_json'
  /** The JSON fails the contract schema. */
  | 'schema'
  /** A value is valid for the schema but not allowed in Phase 0 (an action outside the allow-list). */
  | 'not_allowed'
  /** A number or length is outside the bounds the validator enforces beyond the schema. */
  | 'out_of_bounds'
  /** The output is empty. */
  | 'empty';

/** One reason an output was rejected. */
export interface OutputError {
  code: OutputErrorCode;
  /** A JSON pointer to the offending value, or the empty string for the whole output. */
  path: string;
  /** A short human-readable explanation, at most 256 characters. */
  detail: string;
}

/** The result of validating one output. A failure is rejected and recorded, never repaired silently. */
export type OutputResult<T> = { ok: true; value: T } | { ok: false; errors: OutputError[] };

/** Validates model output. */
export interface OutputValidator {
  /** Checks the text as a `Thought` (schema, allow-list, bounds). */
  parseThought(text: string): OutputResult<Thought>;
  /**
   * Checks the text as a `Reflection`. `degraded` selects the smaller bounds of the degraded path
   * (fewer memories and updates), which the validator documents.
   */
  parseReflection(text: string, options: { degraded: boolean }): OutputResult<Reflection>;
  /**
   * The user message that asks the model to try once more, naming the errors (codes and paths).
   * ejected, when given, is the rejected text: the implementation echoes at most 512 characters
   * of it as a JSON-escaped string, quoted as data, never as instructions.
   */
  correctiveMessage(errors: OutputError[], rejected?: string): ModelMessage;
}
