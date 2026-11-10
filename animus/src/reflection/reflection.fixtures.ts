/** Shared set-up for the reflection tests: a life with fakes behind every port. */
import type { Reflection } from '@geldar/contract';
import type { JobSettings } from '../config.ts';
import { FakeEventPublisher } from '../fakes/body.fakes.ts';
import { FakeEmbedder, FakeMemoryStore } from '../fakes/memory.fakes.ts';
import { FakeModelClient } from '../fakes/model.fakes.ts';
import { FakeOutputValidator, FakePromptLibrary } from '../fakes/prompts.fakes.ts';
import type {
  AdmissionReservation,
  AgentRow,
  AttentionController,
  MindEvent,
  ReflectionDue,
  ThoughtOutcome,
} from '../ports/index.ts';
import type { ReflectDeps } from './reflect.ts';
import { reflectOnce } from './reflect.ts';
import { ReflectionTrigger } from './trigger.ts';

export const LIFE = 'ag_adam_01';

/** Builds a `MindEvent`; the payload is whatever the type needs. */
export function event(type: MindEvent['type'], tick: number, payload: unknown, day = 3): MindEvent {
  return {
    eventId: `ev_${type}_${tick}`,
    lifeId: LIFE,
    tick,
    day,
    at: '2026-11-09T12:00:00.000Z',
    type,
    payload,
  } as MindEvent;
}

export function due(day = 3, tick = 1000): ReflectionDue {
  return { lifeId: LIFE, day, event: event('sleep', tick, {}, day) };
}

/** A valid reflection answer; `over` replaces fields. */
export function reflection(over: Partial<Reflection> = {}): Reflection {
  return {
    memories_to_keep: ['Pike gave me bread', 'I found a cave', 'It rained'],
    relationship_updates: [{ name: 'Pike', impression: 'generous', trust: 70 }],
    beliefs_add: [{ belief: 'The cave holds iron', kind: 'observation' }],
    beliefs_remove: [],
    goals: [{ goal: 'mine iron', why: 'tools need it' }],
    day_summary: 'A quiet day.',
    ...over,
  } as Reflection;
}

/** An attention controller that only counts the slot calls. */
export class SlotRecorder implements AttentionController {
  readonly calls: string[] = [];
  onEvent(): void {}
  onDecision(): () => void {
    return () => {};
  }
  onReflectionDue(): () => void {
    return () => {};
  }
  thoughtStarted(): void {
    this.calls.push('started');
  }
  thoughtSettled(outcome: ThoughtOutcome): void {
    this.calls.push(`settled:${outcome}`);
  }
}

export const SETTINGS: JobSettings = {
  maxTokens: 1500,
  temperature: 0.5,
  deadlineS: 120,
  reasoning: 'on',
};

export function agent(over: Partial<AgentRow> = {}): AgentRow {
  return {
    agentId: LIFE,
    name: 'Adam',
    lifeSeq: 1,
    gameAccount: 'adam',
    shard: 'phase0',
    mode: 'headless',
    declaredModel: null,
    modelConfig: 'cfg',
    tier: 'strong',
    personalitySeed: 'seed',
    bornAt: null,
    bornDay: 2,
    budgetRemaining: null,
    budgetDaily: null,
    lastSleepDay: null,
    ...over,
  };
}

export interface World {
  store: FakeMemoryStore;
  models: FakeModelClient;
  publisher: FakeEventPublisher;
  prompts: FakePromptLibrary;
  attention: SlotRecorder;
  deps: ReflectDeps;
  trigger: ReflectionTrigger;
  /** Reservations asked for, and how each ended. */
  admission: { asked: number[]; settled: number; released: number; grant: boolean };
}

/** A life with the fakes; `script` is the model's answers in order. */
export async function world(
  script: (string | Reflection)[],
  over: { agent?: Partial<AgentRow>; fatigueRule?: boolean; grant?: boolean } = {},
): Promise<World> {
  const store = new FakeMemoryStore();
  await store.ensureAgent(agent(over.agent));
  const models = new FakeModelClient(
    script.map((s) => (typeof s === 'string' ? s : JSON.stringify(s))),
  );
  const publisher = new FakeEventPublisher();
  const prompts = new FakePromptLibrary();
  const attention = new SlotRecorder();
  const deps: ReflectDeps = {
    shard: 'phase0',
    agent: { name: 'Adam', lifeId: LIFE, personalitySeed: 'seed' },
    model: 'fake-model',
    settings: SETTINGS,
    fatigueDays: 3,
    fatigueRule: over.fatigueRule ?? true,
    stamp: {
      schemaVersion: 'v1',
      mindVersion: '0',
      bodyVersion: '0',
      modelConfig: 'cfg',
      effort: 'high',
    },
    store,
    journal: store,
    embedder: new FakeEmbedder(),
    models,
    prompts,
    validator: new FakeOutputValidator(),
    publisher,
    now: () => new Date('2026-11-09T12:00:00.000Z'),
  };
  const admission = { asked: [] as number[], settled: 0, released: 0, grant: over.grant ?? true };
  const trigger = new ReflectionTrigger({
    lifeId: LIFE,
    store,
    attention,
    admission: {
      reserve(cost: number): AdmissionReservation | null {
        admission.asked.push(cost);
        if (!admission.grant) return null;
        return {
          cost,
          settle: () => void admission.settled++,
          release: () => void admission.released++,
        };
      },
    },
    run: (input) => reflectOnce(deps, input),
  });
  return { store, models, publisher, prompts, attention, deps, trigger, admission };
}
