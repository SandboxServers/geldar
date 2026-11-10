/**
 * One life's Mind, composed from its ports (spec 5.3, 5.4): the event source feeds the attention
 * controller (P0-27), whose wake decisions run the thinking loop (P0-30), which sends a plan to the
 * Body through the `BodyLink`; a `ReflectionDue` runs the sleep reflection (P0-31). The loop and the
 * reflection share one admission counter and one in-flight slot: a due reflection waits while a
 * thought runs, and the thought that was held waits while a reflection runs. Nothing here reads the
 * environment or opens a connection; the mains build the ports and pass them in.
 */
import type { PlanAck, PlanMessage, Snapshot } from '@geldar/contract';
import { Attention } from './attention/controller.ts';
import type { Clock, Scheduler } from './attention/timing.ts';
import type { AnimusConfig } from './config.ts';
import { Admission } from './loop/admission.ts';
import type { LoopVersions } from './loop/journal-row.ts';
import { loopOptionsFromConfig, ThinkingLoop } from './loop/thinking-loop.ts';
import type {
  BodyLink,
  Embedder,
  EventPublisher,
  EventSource,
  Journal,
  MemoryStore,
  ModelClient,
  OutputValidator,
  PromptLibrary,
  ReflectionDue,
  WakeDecision,
} from './ports/index.ts';
import { reflectOnce } from './reflection/reflect.ts';
import { ReflectionTrigger } from './reflection/trigger.ts';

/** The ports one life's Mind is built from, and what it reads from the configuration. */
export interface MindDeps {
  config: AnimusConfig;
  /** The versions every thought records; the Body version has no source in the config. */
  versions: LoopVersions;
  body: BodyLink;
  events: EventSource;
  publisher: EventPublisher;
  model: ModelClient;
  store: MemoryStore;
  journal: Journal;
  embedder: Embedder;
  prompts: PromptLibrary;
  validator: OutputValidator;
  /** The shard's fatigue switch (spec 5.4); on when absent. */
  fatigueRule?: boolean;
  /** Time sources for the attention controller; tests pass a manual one. */
  timing?: { clock: Clock; scheduler: Scheduler };
  /** Wall clock in milliseconds for the loop and the reflection; defaults to `Date.now`. */
  now?: () => number;
  /** Waits `ms` between snapshot retries; tests pass an instant one. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Resolves true when a Thinker for the model is connected, false after the timeout. */
  awaitThinker?: (model: string, timeoutMs: number, signal: AbortSignal) => Promise<boolean>;
  /** One structured log line from the loop (ids and codes, never prompt or completion text). */
  log?: (line: Record<string, unknown>) => void;
  /** Called with anything a handler threw (the handlers themselves never reject). */
  onError?: (error: unknown) => void;
}

/** The Mind of one life. */
export class Mind {
  readonly attention: Attention;
  readonly loop: ThinkingLoop;
  readonly reflection: ReflectionTrigger;
  readonly admission: Admission;

  private readonly deps: MindDeps;
  private readonly lifeId: string;
  private readonly work = new Set<Promise<unknown>>();
  /** Thoughts running; a settled thought can start the next one before its own task returns. */
  private running = 0;
  private unsubscribe: (() => void) | null = null;
  private detach: (() => void)[] = [];

  constructor(deps: MindDeps) {
    this.deps = deps;
    const { config } = deps;
    this.lifeId = config.agent.username;
    const now = deps.now ?? Date.now;
    this.admission = new Admission(config.admission.maxThoughtsPerRealHour, now);
    this.attention = new Attention({
      lifeId: this.lifeId,
      identity: { name: config.agent.name, username: config.agent.username },
      config: config.attention,
      tickRate: config.tickRate,
      journal: deps.journal,
      ...(deps.timing ? { clock: deps.timing.clock, scheduler: deps.timing.scheduler } : {}),
    });
    const options = loopOptionsFromConfig(config, deps.versions);
    this.reflection = new ReflectionTrigger({
      lifeId: this.lifeId,
      store: deps.store,
      attention: this.attention,
      admission: this.admission,
      thinking: () => this.running > 0,
      run: (input) =>
        reflectOnce(
          {
            shard: config.shard,
            agent: {
              name: config.agent.name,
              lifeId: this.lifeId,
              personalitySeed: config.agent.personalitySeed,
            },
            model: options.model,
            settings: config.reflection,
            fatigueDays: config.memory.fatigueDays,
            fatigueRule: deps.fatigueRule ?? true,
            stamp: {
              schemaVersion: deps.versions.schema,
              mindVersion: deps.versions.mind,
              bodyVersion: deps.versions.body,
              modelConfig: options.modelConfig,
              effort: config.reflection.reasoning === 'on' ? 'high' : 'minimal',
            },
            store: deps.store,
            journal: deps.journal,
            embedder: deps.embedder,
            models: deps.model,
            prompts: deps.prompts,
            validator: deps.validator,
            publisher: deps.publisher,
            now: () => new Date(now()),
          },
          input,
        ),
    });
    this.loop = new ThinkingLoop(
      {
        body: this.observingBody(deps.body),
        model: deps.model,
        memory: deps.store,
        journal: deps.journal,
        embedder: deps.embedder,
        prompts: deps.prompts,
        validator: deps.validator,
        attention: this.attention,
        events: deps.publisher,
        admission: this.admission,
        now,
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
        ...(deps.awaitThinker ? { awaitThinker: deps.awaitThinker } : {}),
        ...(deps.log ? { log: deps.log } : {}),
      },
      options,
    );
  }

  /** Subscribes to the life's events, wires decisions and reflections, and wakes with `mind_start`. */
  start(): void {
    if (this.unsubscribe !== null) return;
    this.detach = [
      this.attention.onDecision((decision) => this.track(this.think(decision))),
      this.attention.onReflectionDue((due) => this.track(this.reflect(due))),
    ];
    this.unsubscribe = this.deps.events.subscribe(this.lifeId, (event) => {
      this.loop.observe(event);
      this.reflection.observe(event);
      this.attention.onEvent(event);
    });
    this.attention.start();
  }

  /** Stops listening and cancels the model call in flight; resolves when the work in hand ends. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const off of this.detach) off();
    this.detach = [];
    this.loop.stop();
    await this.settled();
    // After the work in hand: a thought that settles late must not re-arm the idle watchdog.
    this.attention.stop();
  }

  /** Resolves when every thought and reflection started so far has ended (for stop and tests). */
  async settled(): Promise<void> {
    while (this.work.size > 0) await Promise.allSettled([...this.work]);
  }

  /** One thought at a time: the controller allows one decision in flight, and the slot is held here too. */
  private async think(decision: WakeDecision): Promise<void> {
    this.running++;
    try {
      await this.loop.handle(decision);
    } finally {
      this.running--;
    }
    await this.reflection.resume();
  }

  private async reflect(due: ReflectionDue): Promise<void> {
    await this.reflection.handle(due);
    if (this.running === 0) await this.reflection.resume();
  }

  private track(task: Promise<void>): void {
    const tracked = task
      .catch((error: unknown) => this.deps.onError?.(error))
      .finally(() => {
        this.work.delete(tracked);
      });
    this.work.add(tracked);
  }

  /** The loop's body link, which also gives the reflection the inventory of every snapshot. */
  private observingBody(body: BodyLink): BodyLink {
    return {
      requestSnapshot: async (reason: string): Promise<Snapshot> => {
        const snapshot = await body.requestSnapshot(reason);
        this.reflection.observeInventory({
          tick: snapshot.world_time.ticks,
          items: snapshot.self.inventory.map((s) => ({ item: s.item, count: s.count })),
        });
        return snapshot;
      },
      submitPlan: (plan: PlanMessage): Promise<PlanAck> => body.submitPlan(plan),
    };
  }
}
