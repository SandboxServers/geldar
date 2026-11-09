/** Shared fixtures for the loop tests: a snapshot, events, an attention stub and a wired loop. */
import type { Snapshot } from '@geldar/contract';
import { type AckScript, FakeBodyLink, FakeEventPublisher } from '../fakes/body.fakes.ts';
import { FakeEmbedder, FakeMemoryStore } from '../fakes/memory.fakes.ts';
import { FakeModelClient, type ModelStep } from '../fakes/model.fakes.ts';
import { FakeOutputValidator, FakePromptLibrary } from '../fakes/prompts.fakes.ts';
import { newId } from '../ids.ts';
import type {
  AttentionController,
  MindEvent,
  ReflectionDue,
  ThoughtOutcome,
  WakeDecision,
} from '../ports/index.ts';
import { Admission } from './admission.ts';
import { IntentLedger } from './fallback.ts';
import { type LoopDeps, type LoopOptions, ThinkingLoop } from './thinking-loop.ts';

export const LIFE = 'ag_adam_01';

/** A valid thought: one intent and one action. */
export const VALID_THOUGHT = JSON.stringify({
  reasoning: 'I need wood.',
  intent: {
    goal: 'gather_wood',
    program: 'gather',
    arguments: { block: 'oak_log', count: 4 },
    wake_on: ['goal_completed'],
    limits: { max_world_ticks: 2000, max_block_operations: 100 },
  },
  actions: [{ do: 'eat' }],
});

/** A snapshot at day 3, tick 1000, revision 7, generation 2. */
export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    snapshot_id: `sn_${'1'.repeat(26)}`,
    agent_id: LIFE,
    shard: 'phase0',
    revision: 7,
    body_generation: 2,
    world_time: { day: 3, time_of_day: 'day', ticks: 1000, weather: 'clear' },
    self: {
      position: { x: 0, y: 64, z: 0 },
      health: 20,
      hunger: 20,
      armor: 0,
      held_item: null,
      inventory: [],
      effects: [],
      budget_remaining_thoughts: 0,
      days_since_sleep: 0,
    },
    surroundings: { blocks_summary: 'grass', notable_blocks: [], entities: [], agents: [] },
    heard: [],
    events_since_last_thought: [],
    ...overrides,
  };
}

let eventCounter = 0;

/** An `intent` event; the accepted one carries the definition. */
export function intentEvent(
  intentId: string,
  state: 'accepted' | 'running' | 'completed' | 'failed' | 'interrupted',
  tick: number,
  program = 'gather',
  definition = true,
): MindEvent {
  const payload = {
    intent_id: intentId,
    life_id: LIFE,
    body_generation: 2,
    state,
    tick,
    ...(definition
      ? {
          goal: 'gather_wood',
          program,
          arguments: { block: 'oak_log', count: 4 },
          preconditions: [],
          wake_on: ['goal_completed'],
          limits: { max_world_ticks: 2000, max_block_operations: 100 },
        }
      : {}),
  };
  return {
    eventId: `ev_${String(++eventCounter).padStart(26, '0')}`,
    lifeId: LIFE,
    tick,
    day: 3,
    at: '2026-11-09T10:00:00.000Z',
    type: 'intent',
    payload,
  } as MindEvent;
}

/** A `plan_result` event with the given intent disposition. */
export function planResultEvent(intent: string, tick = 500): MindEvent {
  return {
    eventId: `ev_${String(++eventCounter).padStart(26, '0')}`,
    lifeId: LIFE,
    tick,
    day: 3,
    at: '2026-11-09T10:00:00.000Z',
    type: 'plan_result',
    payload: {
      thought_id: newId('th'),
      intent,
      failed_at: null,
      actions: [],
      said: false,
    },
  } as unknown as MindEvent;
}

/** A wake decision with no events. */
export function makeDecision(
  reason: WakeDecision['reason'] = 'idle',
  events: MindEvent[] = [],
): WakeDecision {
  return { reason, events, digest: [], priority: 1 };
}

/** An attention controller that records how the loop used it. */
export class StubAttention implements AttentionController {
  readonly calls: string[] = [];
  readonly settled: ThoughtOutcome[] = [];
  private callback: ((decision: WakeDecision) => void) | undefined;

  onEvent(): void {}
  onDecision(callback: (decision: WakeDecision) => void): () => void {
    this.callback = callback;
    return () => {
      this.callback = undefined;
    };
  }
  onReflectionDue(_callback: (due: ReflectionDue) => void): () => void {
    return () => {};
  }
  thoughtStarted(): void {
    this.calls.push('started');
  }
  thoughtSettled(outcome: ThoughtOutcome): void {
    this.calls.push('settled');
    this.settled.push(outcome);
  }
  /** Delivers a decision as the controller would. */
  decide(decision: WakeDecision): void {
    this.callback?.(decision);
  }
}

export const OPTIONS: LoopOptions = {
  lifeId: LIFE,
  model: 'qwen3:32b',
  modelConfig: 'qwen3:32b@sha256:abc;num_ctx=8192;temperature=0.7',
  versions: { schema: 'thought@1', mind: 'mind-0.0.0', body: 'body-0.0.0' },
  thought: { maxTokens: 600, temperature: 0.7, deadlineS: 25, reasoning: 'off' },
  expiresAfterTicks: 1200,
  workingWindow: 5,
  episodicTopK: 8,
};

export interface Rig {
  loop: ThinkingLoop;
  body: FakeBodyLink;
  model: FakeModelClient;
  store: FakeMemoryStore;
  prompts: FakePromptLibrary;
  attention: StubAttention;
  events: FakeEventPublisher;
  admission: Admission;
  ledger: IntentLedger;
  clock: { ms: number };
}

/** A loop wired to fakes. The agent has slept on day 1. */
export async function makeRig(
  steps: ModelStep[],
  options: {
    snapshot?: Snapshot;
    cap?: number;
    ack?: AckScript;
    loop?: Partial<LoopOptions>;
    deps?: Partial<LoopDeps>;
  } = {},
): Promise<Rig> {
  const clock = { ms: Date.parse('2026-11-09T10:00:00.000Z') };
  const body = new FakeBodyLink(options.snapshot ?? makeSnapshot(), options.ack);
  const model = new FakeModelClient(steps);
  const store = new FakeMemoryStore();
  await store.ensureAgent({
    agentId: LIFE,
    name: 'Adam',
    lifeSeq: 1,
    gameAccount: 'Adam',
    shard: 'phase0',
    mode: 'headless',
    declaredModel: null,
    modelConfig: OPTIONS.modelConfig,
    tier: 'strong',
    personalitySeed: 'curious',
    bornAt: null,
    bornDay: 0,
    budgetRemaining: null,
    budgetDaily: null,
    lastSleepDay: 1,
  });
  const prompts = new FakePromptLibrary();
  const attention = new StubAttention();
  const events = new FakeEventPublisher();
  const admission = new Admission(options.cap ?? 120, () => clock.ms);
  const ledger = new IntentLedger();
  const loop = new ThinkingLoop(
    {
      body,
      model,
      memory: store,
      journal: store,
      embedder: new FakeEmbedder(),
      prompts,
      validator: new FakeOutputValidator(),
      attention,
      events,
      admission,
      ledger,
      now: () => clock.ms,
      ...options.deps,
    },
    { ...OPTIONS, ...options.loop },
  );
  return { loop, body, model, store, prompts, attention, events, admission, ledger, clock };
}
