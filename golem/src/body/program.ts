import type { Intent } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { JsonValue } from '../actions/outcome.ts';
import type { ActionRegistry } from '../actions/registry.ts';
import type { RecordSink } from './records.ts';
import type { BodyView } from './view.ts';
import type { WakeReason } from './wake.ts';

/** What a program gets: the bot to act through, the view to read, and the Body's identity. */
export interface ProgramContext {
  bot: Bot;
  view: BodyView;
  registry: ActionRegistry;
  sink: RecordSink;
  lifeId: string;
  bodyGeneration: number;
  /** Aborted when the intent is cancelled or the runtime stops. */
  signal: AbortSignal;
}

/** What one `step` says about the program. */
export type StepResult =
  | { status: 'running' }
  | { status: 'completed'; detail?: Record<string, JsonValue> }
  | { status: 'failed'; message: string }
  /** The program wants the Mind (for example `precondition_failed`). */
  | { status: 'wake'; reason: WakeReason; message?: string };

/** What a program saves to survive a Body restart: plain JSON, owned by the program. */
export type ProgramCheckpoint = Record<string, JsonValue>;

/**
 * A durable intent's code (spec 5.3): travel, gather, craft and so on. One instance is one intent
 * run, so it may hold state. The executor calls `start` once, then `step` until it stops running;
 * `checkpoint` is read between steps and saved; after a restart a fresh instance gets `resume`
 * with the saved value instead of `start`.
 */
export interface IntentProgram {
  readonly name: string;
  /** Begins the run with the intent's `arguments`. Throws when they are unusable. */
  start(args: Intent['arguments'], ctx: ProgramContext): Promise<void>;
  /** Does a bounded slice of work and says what happened. Must return promptly when `ctx.signal` aborts. */
  step(ctx: ProgramContext): Promise<StepResult>;
  /** The state `resume` needs, or null when the program has nothing to save. */
  checkpoint(): ProgramCheckpoint | null;
  /** Restores a state saved from this program's `checkpoint`. */
  resume(checkpoint: ProgramCheckpoint, ctx: ProgramContext): Promise<void>;
}

/** Builds a fresh program instance for one intent run. */
export type ProgramFactory = () => IntentProgram;

/** Maps a program name (`travel`, a skill name) to its factory. Empty until programs register. */
export class ProgramRegistry {
  private readonly factories = new Map<string, ProgramFactory>();

  /** Adds a program. Throws if the name already has one. */
  register(name: string, factory: ProgramFactory): void {
    if (this.factories.has(name)) throw new Error(`duplicate program ${name}`);
    this.factories.set(name, factory);
  }

  /** A fresh instance of the named program, or undefined when none is registered. */
  create(name: string): IntentProgram | undefined {
    return this.factories.get(name)?.();
  }

  /** The registered names, in registration order. */
  names(): string[] {
    return [...this.factories.keys()];
  }
}
