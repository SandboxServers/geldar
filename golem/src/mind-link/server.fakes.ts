/** Test doubles for the `MindLinkServer`: a request server a test calls by hand, a stub executor. */
import type { PlanMessage, Snapshot } from '@geldar/contract';
import type { SubmitResult } from '../body/executor.ts';
import type { SnapshotOptions } from '../snapshot.ts';
import type { PlanExecutor, RequestServer } from './server.ts';

export const SHARD = 'phase0';
export const LIFE = 'ag_adam_01';
export const GENERATION = 4;

/** A `RequestServer` whose requests the test sends with `request`. */
export class FakeRequestServer implements RequestServer {
  private readonly handlers = new Map<
    string,
    (data: string, reply: (body: string) => void) => Promise<void>
  >();

  serve(
    subject: string,
    handler: (data: string, reply: (body: string) => void) => Promise<void>,
  ): () => void {
    this.handlers.set(subject, handler);
    return () => {
      this.handlers.delete(subject);
    };
  }

  /** Subjects being served now. */
  get subjects(): string[] {
    return [...this.handlers.keys()];
  }

  /** Delivers `data` to the handler on `subject`; resolves with the reply, or null when none was sent. */
  async request(subject: string, data: string): Promise<string | null> {
    const handler = this.handlers.get(subject);
    if (handler === undefined) throw new Error(`nobody serves ${subject}`);
    let reply: string | null = null;
    await handler(data, (body) => {
      reply = body;
    });
    return reply;
  }
}

/** An executor stub: records what it is given, answers with `result`, and can be held open. */
export class StubExecutor implements PlanExecutor {
  intentId: string | null = null;
  intentState: PlanExecutor['intentState'] = null;
  readonly submitted: unknown[] = [];
  result: SubmitResult = { rejection: null, actions: [], failedAt: null, intent: 'none' };
  /** When set, `submit` waits for it before it answers. */
  gate: Promise<void> | null = null;

  async submit(thought: unknown): Promise<SubmitResult> {
    this.submitted.push(thought);
    if (this.gate !== null) await this.gate;
    return this.result;
  }
}

/** A well-formed id: the prefix and 26 Crockford characters derived from `n`. */
export function idOf(prefix: 'th' | 'sn' | 'in' | 'ac', n: number): string {
  return `${prefix}_${String(n).padStart(26, '0')}`;
}

/** A snapshot the contract accepts, with the fields the options set. */
export function snapshotFrom(options: SnapshotOptions): Snapshot {
  return {
    snapshot_id: idOf('sn', options.revision),
    agent_id: options.lifeId,
    shard: options.shard,
    revision: options.revision,
    ...(options.bodyGeneration !== undefined ? { body_generation: options.bodyGeneration } : {}),
    world_time: { day: 0, time_of_day: 'day', ticks: 10, weather: 'clear' },
    self: {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      hunger: 20,
      armor: 0,
      held_item: null,
      inventory: [],
      effects: [],
      budget_remaining_thoughts: options.budgetRemainingThoughts ?? 0,
      days_since_sleep: options.daysSinceSleep ?? 0,
      ...(options.unlockedRecipes !== undefined
        ? { unlocked_recipes: options.unlockedRecipes }
        : {}),
    },
    surroundings: options.surroundings ?? {
      blocks_summary: '',
      notable_blocks: [],
      entities: [],
      agents: [],
    },
    heard: options.heard ?? [],
    events_since_last_thought: options.events ?? [],
    ...(options.currentPlan !== undefined ? { current_plan: options.currentPlan } : {}),
  };
}

/** A plan the Body accepts at revision 1, generation `GENERATION`, tick 10; `change` overrides fields. */
export function planOf(n: number, change: Partial<PlanMessage> = {}): PlanMessage {
  return {
    thought_id: idOf('th', n),
    life_id: LIFE,
    body_generation: GENERATION,
    source_snapshot_id: idOf('sn', n),
    snapshot_revision: 1,
    expires_tick: 1000,
    action_ids: [idOf('ac', n)],
    thought: { reasoning: 'test', actions: [{ do: 'wait', seconds: 1 }], say: 'hello there' },
    ...change,
  };
}
