import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualTiming } from './attention/timing.fakes.ts';
import { type AnimusConfig, loadAnimusConfig } from './config.ts';
import { FakeBodyLink, FakeEventPublisher, FakeEventSource } from './fakes/body.fakes.ts';
import { FakeEmbedder, FakeMemoryStore } from './fakes/memory.fakes.ts';
import { FakeOutputValidator, FakePromptLibrary } from './fakes/prompts.fakes.ts';
import { makeSnapshot, VALID_THOUGHT } from './loop/loop-fixtures.ts';
import { Mind, type MindDeps } from './mind.ts';
import {
  BodyLinkError,
  type MindEvent,
  type ModelClient,
  type ModelCompletion,
  type ModelJob,
} from './ports/index.ts';
import { agent, event, reflection } from './reflection/reflection.fixtures.ts';

/** A model that answers from a script, holds every call behind a gate and counts overlaps. */
class GatedModel implements ModelClient {
  readonly jobs: ModelJob[] = [];
  maxInFlight = 0;
  gate: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private readonly answers: string[];

  constructor(answers: string[]) {
    this.answers = [...answers];
  }

  async complete(job: ModelJob): Promise<ModelCompletion> {
    this.jobs.push(job);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await this.gate;
      return { text: this.answers.shift() ?? '', thinkerId: 'fake', latencyMs: 1 };
    } finally {
      this.inFlight--;
    }
  }
}

interface Rig {
  mind: Mind;
  source: FakeEventSource;
  body: FakeBodyLink;
  model: GatedModel;
  store: FakeMemoryStore;
  publisher: FakeEventPublisher;
  time: ManualTiming;
}

let config: AnimusConfig;
beforeEach(async () => {
  config = await loadAnimusConfig({ env: {}, allowPlaceholders: true });
});

async function rig(answers: string[], extra: Partial<MindDeps> = {}): Promise<Rig> {
  const store = new FakeMemoryStore();
  await store.ensureAgent(agent({ agentId: config.agent.username, lastSleepDay: 1 }));
  const source = new FakeEventSource();
  const body = new FakeBodyLink(makeSnapshot({ agent_id: config.agent.username }));
  const model = new GatedModel(answers);
  const publisher = new FakeEventPublisher();
  const time = new ManualTiming();
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
    prompts: new FakePromptLibrary(),
    validator: new FakeOutputValidator(),
    timing: { clock: time, scheduler: time },
    now: () => time.nowMs() + Date.parse('2026-11-09T10:00:00.000Z'),
    ...extra,
  });
  return { mind, source, body, model, store, publisher, time };
}

const speech = (text: string, tick: number): MindEvent =>
  event('speech', tick, { from: 'Eve', text, distance: 3, own: false });
const sleep = (day: number, tick: number): MindEvent => event('sleep', tick, {}, day);

describe('the Mind of one life', () => {
  it('wakes with mind_start, thinks, and sends the plan to the Body', async () => {
    const r = await rig([VALID_THOUGHT]);
    r.mind.start();
    await r.mind.settled();
    expect(r.body.snapshotRequests).toEqual(['mind_start']);
    expect(r.body.plans).toHaveLength(1);
    expect(r.body.plans[0]?.thought.intent?.program).toBe('gather');
    expect(r.store.thoughts.map((t) => t.wakeReason)).toEqual(['mind_start']);
    expect(r.publisher.published.map((e) => e.type)).toEqual(['thought']);
    await r.mind.stop();
    expect(r.source.subscriberCount(config.agent.username)).toBe(0);
  });

  it('keeps the mind_start wake when the Body is not up yet: it retries until the Body answers', async () => {
    const slept: number[] = [];
    let r: Rig | undefined;
    // The Body comes up after three waits.
    const sleep = async (ms: number): Promise<void> => {
      slept.push(ms);
      if (slept.length === 3 && r !== undefined) r.body.failWith = undefined;
    };
    r = await rig([VALID_THOUGHT], { sleep });
    r.body.failWith = new BodyLinkError('unavailable', 'nobody serves the snapshot subject');
    r.mind.start();
    await r.mind.settled();
    expect(r.body.snapshotRequests).toEqual(['mind_start', 'mind_start', 'mind_start', 'mind_start']);
    expect(slept).toHaveLength(3);
    expect(Math.max(...slept)).toBeLessThanOrEqual(5_000);
    expect(r.store.thoughts.map((t) => t.wakeReason)).toEqual(['mind_start']);
    expect(r.body.plans).toHaveLength(1);
  });

  it('records a suppressed wakeup with a reason when the Body never comes up', async () => {
    const slept: number[] = [];
    const r = await rig([VALID_THOUGHT], {
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    r.body.failWith = new BodyLinkError('unavailable', 'nobody serves the snapshot subject');
    r.mind.start();
    await r.mind.settled();
    const total = slept.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(config.mind.snapshotRetryS * 1000);
    expect(total).toBeGreaterThan(config.mind.snapshotRetryS * 1000 - 5_000);
    expect(r.body.snapshotRequests).toHaveLength(slept.length + 1);
    expect(r.store.thoughts).toHaveLength(0);
    expect(r.store.suppressed.map((s) => [s.eventTypes, s.reason])).toEqual([
      [['mind_start'], 'snapshot_unavailable'],
    ]);
  });

  it('feeds an event to attention and a decision to the loop', async () => {
    const r = await rig([VALID_THOUGHT, VALID_THOUGHT]);
    r.mind.start();
    await r.mind.settled();
    r.time.advance(20_000);
    r.source.emit(speech('Adam, come here', 100));
    await r.mind.settled();
    expect(r.body.snapshotRequests).toEqual(['mind_start', 'speech_addressed']);
    expect(r.body.plans).toHaveLength(2);
    expect(r.store.thoughts.map((t) => t.wakeReason)).toEqual(['mind_start', 'speech_addressed']);
  });

  it('runs one reflection for a sleep event, and none for a second sleep on the same day', async () => {
    const r = await rig([VALID_THOUGHT, JSON.stringify(reflection())]);
    r.mind.start();
    await r.mind.settled();
    r.source.emit(sleep(3, 500));
    await r.mind.settled();
    r.source.emit(sleep(3, 600));
    await r.mind.settled();
    expect(r.model.jobs).toHaveLength(2);
    const reflections = r.publisher.published.filter((e) => e.type === 'reflection');
    expect(reflections).toHaveLength(1);
    expect(r.store.thoughts.filter((t) => t.wakeReason === 'reflection')).toHaveLength(1);
    expect((await r.store.loadDeterministic(config.agent.username, 0)).agent.lastSleepDay).toBe(3);
  });

  it('keeps one thought in flight: a wake and a sleep arriving mid-thought wait their turn', async () => {
    const r = await rig([VALID_THOUGHT, VALID_THOUGHT, JSON.stringify(reflection())]);
    let open: () => void = () => {};
    r.model.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    r.mind.start();
    await vi.waitFor(() => expect(r.model.jobs).toHaveLength(1));
    r.source.emit(speech('Adam, hello', 100));
    r.source.emit(sleep(3, 200));
    expect(r.model.jobs).toHaveLength(1);
    r.time.advance(20_000);
    open();
    await r.mind.settled();
    expect(r.model.maxInFlight).toBe(1);
    expect(r.model.jobs).toHaveLength(3);
    expect(r.store.thoughts.map((t) => t.wakeReason)).toEqual([
      'mind_start',
      'speech_addressed',
      'reflection',
    ]);
    expect(r.store.suppressed.map((s) => s.reason)).toContain('coalesced_in_flight');
    expect(r.publisher.published.map((e) => e.type)).toEqual(['thought', 'thought', 'reflection']);
  });

  it('lets a reflection hold the slot: a wake arriving mid-reflection waits for it', async () => {
    const r = await rig([VALID_THOUGHT, JSON.stringify(reflection()), VALID_THOUGHT]);
    r.mind.start();
    await r.mind.settled();
    let open: () => void = () => {};
    r.model.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    r.source.emit(sleep(3, 200));
    await vi.waitFor(() => expect(r.model.jobs).toHaveLength(2));
    r.time.advance(20_000);
    r.source.emit(speech('Adam, hello', 300));
    await Promise.resolve();
    expect(r.model.jobs).toHaveLength(2);
    open();
    await r.mind.settled();
    expect(r.model.maxInFlight).toBe(1);
    expect(r.store.thoughts.map((t) => t.wakeReason)).toEqual([
      'mind_start',
      'reflection',
      'speech_addressed',
    ]);
  });
});
