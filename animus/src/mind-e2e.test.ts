/**
 * The Mind end to end with fakes (P0-32b): the real composition (`Mind`, attention, the thinking
 * loop, the reflection, the output validator and the prompt library) over a scripted model, a fake
 * Body link whose snapshot function models a Body that crashes and restarts, and the in-memory
 * store as the journal. Twenty cycles: start, a plan, the intent ending, an idle wake, addressed
 * speech and a reply with `say`, a sleep and its reflection, two invalid outputs and the fallback,
 * and a Body restart. No model, no network.
 */
import type { PlanMessage, Snapshot } from '@geldar/contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualTiming } from './attention/timing.fakes.ts';
import { type AnimusConfig, loadAnimusConfig } from './config.ts';
import { FakeBodyLink, FakeEventPublisher, FakeEventSource } from './fakes/body.fakes.ts';
import { FakeEmbedder, FakeMemoryStore } from './fakes/memory.fakes.ts';
import { FakeModelClient } from './fakes/model.fakes.ts';
import { intentEvent, makeSnapshot, VALID_THOUGHT } from './loop/loop-fixtures.ts';
import { Mind } from './mind.ts';
import type { MindEvent, ModelClient, ModelCompletion, ModelJob } from './ports/index.ts';
import { createPromptLibrary } from './prompts/index.ts';
import { agent, event, reflection } from './reflection/reflection.fixtures.ts';
import { createOutputValidator } from './validate/index.ts';

const SAY_THOUGHT = JSON.stringify({ reasoning: 'Eve greeted me.', say: 'Hello, Eve.' });
const NOT_JSON = 'I think I will gather wood.';

/** Counts how many model calls overlap, around the scripted client. */
class CountingModel implements ModelClient {
  maxInFlight = 0;
  started = 0;
  gate: Promise<void> = Promise.resolve();
  private inFlight = 0;

  private readonly inner: FakeModelClient;

  constructor(inner: FakeModelClient) {
    this.inner = inner;
  }

  async complete(job: ModelJob, signal: AbortSignal): Promise<ModelCompletion> {
    this.started++;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await this.gate;
      return await this.inner.complete(job, signal);
    } finally {
      this.inFlight--;
    }
  }
}

let config: AnimusConfig;
beforeEach(async () => {
  config = await loadAnimusConfig({ env: {}, allowPlaceholders: true });
});

interface World {
  mind: Mind;
  source: FakeEventSource;
  body: FakeBodyLink;
  script: FakeModelClient;
  model: CountingModel;
  store: FakeMemoryStore;
  publisher: FakeEventPublisher;
  time: ManualTiming;
  snapshots: Snapshot[];
  /** The Body crashed and came back: the next snapshots carry the next generation. */
  restartBody: () => void;
}

async function world(): Promise<World> {
  const store = new FakeMemoryStore();
  await store.ensureAgent(agent({ agentId: config.agent.username, lastSleepDay: 1 }));
  const source = new FakeEventSource();
  let generation = 1;
  let revision = 0;
  const snapshots: Snapshot[] = [];
  const body = new FakeBodyLink(() => {
    revision++;
    const snapshot = makeSnapshot({
      agent_id: config.agent.username,
      snapshot_id: `sn_${String(snapshots.length + 1).padStart(26, '0')}`,
      revision,
      body_generation: generation,
    });
    snapshots.push(snapshot);
    return snapshot;
  });
  const script = new FakeModelClient();
  const model = new CountingModel(script);
  const publisher = new FakeEventPublisher();
  const time = new ManualTiming();
  const base = Date.parse('2026-11-09T10:00:00.000Z');
  const mind = new Mind({
    config,
    versions: { schema: 'thought@1', mind: 'mind-0', body: 'body-0' },
    body,
    events: source,
    publisher,
    model,
    store,
    journal: store,
    embedder: new FakeEmbedder(),
    prompts: createPromptLibrary(),
    validator: createOutputValidator(),
    timing: { clock: time, scheduler: time },
    now: () => base + time.nowMs(),
  });
  return {
    mind,
    source,
    body,
    script,
    model,
    store,
    publisher,
    time,
    snapshots,
    restartBody: () => {
      generation++;
    },
  };
}

const life = (): string => config.agent.username;
const speech = (text: string, tick: number): MindEvent =>
  event('speech', tick, { from: 'Eve', text, distance: 3, own: false });

/** An intent event of this life with the given id. */
function intent(id: string, state: 'accepted' | 'completed' | 'interrupted', tick: number) {
  const e = intentEvent(id, state, tick);
  return { ...e, lifeId: life() } as MindEvent;
}

/** The `thought` events the Mind published, with their outcomes. */
function outcomes(w: World): string[] {
  return w.publisher.published.flatMap((e) =>
    e.type === 'thought' ? [(e.payload as { outcome: string }).outcome] : [],
  );
}

describe('the Mind end to end with fakes', () => {
  it('a say-only thought with nothing running wakes the Mind again, with no external event', async () => {
    const w = await world();
    const { time, mind, script, store, body } = w;
    script.script(SAY_THOUGHT, SAY_THOUGHT);
    await mind.start();
    await mind.settled();
    expect(store.thoughts.map((t) => t.wakeReason)).toEqual(['mind_start']);
    time.advance(59_000);
    await mind.settled();
    expect(store.thoughts).toHaveLength(1);
    time.advance(1_000);
    await mind.settled();
    expect(store.thoughts.map((t) => t.wakeReason)).toEqual(['mind_start', 'idle']);
    expect(body.plans.at(-1)?.thought.say).toBe('Hello, Eve.');
  });

  it('runs twenty cycles: plans, idle, speech, sleep, fallback and a Body restart', async () => {
    const w = await world();
    const { source, time, mind, script, store, body } = w;
    const step = async (ms = 20_000): Promise<void> => {
      await mind.settled();
      time.advance(ms);
    };

    // 1. mind_start: a plan with an intent.
    script.script(VALID_THOUGHT);
    await mind.start();
    await step();
    expect(body.snapshotRequests).toEqual(['mind_start']);

    // 2. The intent runs and completes: after the settle window the Mind wakes as idle.
    script.script(VALID_THOUGHT);
    source.emit(intent('in_a', 'accepted', 100));
    source.emit(intent('in_a', 'completed', 200));
    time.advance(300);
    await step();
    expect(store.thoughts.map((t) => t.wakeReason)).toEqual(['mind_start', 'idle']);

    // 3. Addressed speech and the reply with `say`.
    script.script(SAY_THOUGHT);
    source.emit(speech('Adam, hello', 300));
    await step();
    expect(w.body.plans.at(-1)?.thought.say).toBe('Hello, Eve.');

    // 4. A wake and a sleep arrive while a thought runs: both wait, one thought in flight.
    let open: () => void = () => {};
    w.model.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    script.script(VALID_THOUGHT, VALID_THOUGHT, JSON.stringify(reflection()));
    source.emit(speech('Adam, are you there?', 400));
    await vi.waitFor(() => expect(w.model.started).toBe(4));
    source.emit(speech('Adam, answer me', 500));
    source.emit(event('sleep', 600, {}, 3));
    time.advance(20_000);
    w.model.gate = Promise.resolve();
    open();
    await step();
    expect(w.model.maxInFlight).toBe(1);
    expect(store.suppressed.map((s) => s.reason)).toContain('coalesced_in_flight');
    expect(store.thoughts.filter((t) => t.wakeReason === 'reflection')).toHaveLength(1);

    // 5. Two invalid outputs with an interrupted intent behind: the fallback continues it.
    script.script(NOT_JSON, NOT_JSON);
    source.emit(intent('in_b', 'accepted', 700));
    source.emit(intent('in_b', 'interrupted', 800));
    time.advance(300);
    await step();
    expect(outcomes(w).at(-1)).toBe('fallback_continue');
    const resumed = w.body.plans.at(-1);
    expect(resumed?.thought.intent?.program).toBe('gather');

    // 6. Two invalid outputs and nothing to continue: no plan goes out.
    const plansBefore = w.body.plans.length;
    script.script(NOT_JSON, NOT_JSON);
    source.emit(speech('Adam, hello again', 900));
    await step();
    expect(outcomes(w).at(-1)).toBe('invalid_output');
    expect(w.body.plans).toHaveLength(plansBefore);

    // 7. The Body crashes and restarts: the next plan carries the next generation.
    const before = w.body.plans.length;
    w.restartBody();
    script.script(VALID_THOUGHT);
    source.emit(speech('Adam, welcome back', 1000));
    await step();
    expect(w.body.plans).toHaveLength(before + 1);
    expect(w.body.plans.at(-1)?.body_generation).toBe(2);

    // 8. Speech cycles up to twenty model calls in all.
    while (script.jobs.length < 20) {
      script.script(VALID_THOUGHT);
      source.emit(speech(`Adam, again ${script.jobs.length}`, 1100 + script.jobs.length));
      await step();
    }
    await mind.settled();

    // The journal: one row per model call, in order, every row with its snapshot.
    expect(store.thoughts).toHaveLength(script.jobs.length);
    expect(script.jobs.length).toBeGreaterThanOrEqual(20);
    expect(new Set(store.thoughts.map((t) => t.thoughtId)).size).toBe(store.thoughts.length);
    const thinking = store.thoughts.filter((t) => t.wakeReason !== 'reflection');
    expect(thinking.every((t) => t.snapshot !== null && t.modelInput !== null)).toBe(true);
    // The invalid pair is two rows; the second is the corrective retry with no parsed thought.
    expect(store.thoughts.filter((t) => t.wakeReason === 'corrective_retry')).toHaveLength(2);
    expect(store.thoughts.filter((t) => t.parsed === null).length).toBe(4);

    // Plans: unique ids, each tied to a snapshot id and revision the Body handed out.
    const plans: PlanMessage[] = w.body.plans;
    expect(new Set(plans.map((p) => p.thought_id)).size).toBe(plans.length);
    for (const plan of plans) {
      const snapshot = w.snapshots.find((s) => s.snapshot_id === plan.source_snapshot_id);
      expect(snapshot?.revision).toBe(plan.snapshot_revision);
      expect(snapshot?.body_generation).toBe(plan.body_generation);
    }
    expect(w.snapshots.map((s) => s.revision)).toEqual(w.snapshots.map((_, i) => i + 1));
    expect(plans.slice(0, 3).every((p) => p.body_generation === 1)).toBe(true);
    expect(plans.at(-1)?.body_generation).toBe(2);

    // Every wake that was held or folded left a suppressed row; nothing ran two at a time.
    expect(w.model.maxInFlight).toBe(1);
    expect(store.suppressed.length).toBeGreaterThan(0);

    await mind.stop();
    expect(source.subscriberCount(life())).toBe(0);
  });
});
