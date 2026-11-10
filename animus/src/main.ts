/**
 * The Mind process (decision 0050): reads the config, opens Postgres, checks the embedder, starts
 * the Thinker hub and the NATS link, then wakes the life with `mind_start`. A SIGINT or SIGTERM
 * stops it in the reverse order: the Mind, the Thinkers (a `drain` frame), the event consumer, the
 * NATS connection and the pool. Logs are one JSON object per line with `life_id`, `thought_id` and
 * `intent_id` where they apply; prompt and completion text never reach a log.
 */
import { pathToFileURL } from 'node:url';
import type { WorldEvent } from '@geldar/contract';
import { connectNats } from '@geldar/contract/nats';
import { thinkerToken } from '@geldar/contract/thinker-token';
import { jetstream } from '@nats-io/jetstream';
import { type AnimusConfig, loadAnimusConfig } from './config.ts';
import { NatsBodyLink, natsRequestTransport } from './link/nats-body-link.ts';
import { jetStreamEventStream, NatsEventSource } from './link/nats-event-source.ts';
import { jetPublish, NatsPublisher } from './link/nats-publisher.ts';
import { loopOptionsFromConfig } from './loop/thinking-loop.ts';
import { OllamaEmbedder } from './memory/embedder-ollama.ts';
import { PgJournal } from './memory/journal.ts';
import { openPool, PgMemoryStore } from './memory/pg-store.ts';
import { Mind } from './mind.ts';
import type {
  AgentRow,
  BodyLink,
  Embedder,
  EventPublisher,
  EventSource,
  Journal,
  MemoryStore,
  ModelClient,
} from './ports/index.ts';
import { createPromptLibrary } from './prompts/library.ts';
import { ThinkerHub } from './thinker/hub.ts';
import { LocalThinkerClient } from './thinker/local-client.ts';
import { createOutputValidator } from './validate/index.ts';

/** The versions every thought of this build records (the Body version has no source in the config). */
export const VERSIONS = { schema: 'thought@1', mind: 'mind-0.1.0', body: 'body-0.1.0' };

/** One structured log line. */
export type LogLine = (line: Record<string, unknown>) => void;

/** What the Postgres step gives the Mind. */
export interface StoreResource {
  store: MemoryStore & { ensureAgent(agent: AgentRow): Promise<void> };
  journal: Journal;
  close(): Promise<void>;
}

/** What the Thinker hub step gives the Mind. */
export interface HubResource {
  model: ModelClient;
  /** Resolves true when a Thinker for the model is connected, false after the timeout. */
  waitForThinker?: (model: string, timeoutMs: number, signal: AbortSignal) => Promise<boolean>;
  /** Sends the Thinkers a `drain` frame and closes the socket. */
  stop(): Promise<void>;
}

/** What the NATS step gives the Mind. */
export interface LinkResource {
  body: BodyLink;
  events: EventSource;
  publisher: EventPublisher;
  /** Opens the consumer on the event stream. */
  start(): Promise<void>;
  /** Stops the consumer. */
  stopConsumer(): void;
  close(): Promise<void>;
}

/** The outside pieces the start-up order opens; the real ones are in {@link realStack}, tests pass fakes. */
export interface MindStack {
  openStore(config: AnimusConfig, embedder: Embedder): Promise<StoreResource>;
  /** Throws a clear error when the embedder cannot be used. */
  checkEmbedder(config: AnimusConfig): Promise<void>;
  startHub(config: AnimusConfig, log: LogLine): Promise<HubResource>;
  openLink(config: AnimusConfig, log: LogLine): Promise<LinkResource>;
  embedder(config: AnimusConfig): Embedder;
}

/** A running Mind process and its stop. */
export interface RunningMind {
  mind: Mind;
  stop(): Promise<void>;
}

/** The life number of a life id: `ag_adam_01` is life 1. */
function lifeSeq(lifeId: string): number {
  return Number(lifeId.slice(lifeId.lastIndexOf('_') + 1));
}

/** The `agents` row of this run (spec 5.9); `ensureAgent` keeps an existing row as it is. */
export function agentRow(config: AnimusConfig, now: Date = new Date()): AgentRow {
  const options = loopOptionsFromConfig(config, VERSIONS);
  return {
    agentId: config.agent.username,
    name: config.agent.name,
    lifeSeq: lifeSeq(config.agent.username),
    gameAccount: config.agent.username,
    shard: config.shard,
    mode: 'headless',
    declaredModel: options.model,
    modelConfig: options.modelConfig,
    tier: config.agent.tier,
    personalitySeed: config.agent.personalitySeed,
    bornAt: now.toISOString(),
    bornDay: null,
    budgetRemaining: null,
    budgetDaily: null,
    lastSleepDay: null,
  };
}

/**
 * Checks that Ollama answers on `/api/tags` and has the embedding model. The error says what to
 * do; it never includes more than the model name and the status.
 */
export async function checkOllamaEmbedder(
  config: AnimusConfig,
  fetchTags: typeof fetch = fetch,
): Promise<void> {
  const model = config.embedding.model;
  let body: unknown;
  try {
    const response = await fetchTags(`${config.ollamaUrl.replace(/\/+$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    throw new Error(
      `Ollama is not reachable at ${config.ollamaUrl} (${String(error)}); start it before the Mind`,
      { cause: error },
    );
  }
  const names = ((body as { models?: { name?: unknown }[] }).models ?? []).map((m) => m.name);
  if (!names.some((n) => n === model || n === `${model}:latest`)) {
    throw new Error(`Ollama has no '${model}' model; run: ollama pull ${model}`);
  }
}

/** Logs what a thought or reflection event says (ids only) and passes it on. */
function loggingPublisher(inner: EventPublisher, lifeId: string, log: LogLine): EventPublisher {
  return {
    async publish(event: WorldEvent): Promise<void> {
      await inner.publish(event);
      const payload = event.payload as { thought_id?: unknown; intent_id?: unknown };
      log({
        event: event.type,
        life_id: lifeId,
        ...(typeof payload.thought_id === 'string' ? { thought_id: payload.thought_id } : {}),
        ...(typeof payload.intent_id === 'string' ? { intent_id: payload.intent_id } : {}),
        source_event_id: event.source_event_id,
      });
    },
  };
}

/**
 * Starts the Mind in the start-up order: Postgres and `ensureAgent`, the embedder check, the
 * Thinker hub, the NATS link and the event consumer, then the Mind itself (its `mind_start` wake).
 * A step that fails closes what the earlier steps opened and rethrows.
 */
export async function startMind(
  config: AnimusConfig,
  stack: MindStack,
  log: LogLine,
): Promise<RunningMind> {
  const lifeId = config.agent.username;
  const stops: (() => Promise<void>)[] = [];
  const closeAll = async (): Promise<void> => {
    for (const stop of stops.splice(0).reverse()) {
      await stop().catch((error: unknown) =>
        log({ event: 'stop_failed', life_id: lifeId, error: String(error) }),
      );
    }
  };
  try {
    const embedder = stack.embedder(config);
    const db = await stack.openStore(config, embedder);
    stops.push(() => db.close());
    await db.store.ensureAgent(agentRow(config));
    log({ event: 'postgres_ready', life_id: lifeId });
    await stack.checkEmbedder(config);
    log({ event: 'embedder_ready', life_id: lifeId, model: config.embedding.model });
    const hub = await stack.startHub(config, log);
    stops.push(() => hub.stop());
    const link = await stack.openLink(config, log);
    stops.push(() => link.close());
    await link.start();
    stops.push(async () => link.stopConsumer());
    const mind = new Mind({
      config,
      versions: VERSIONS,
      body: link.body,
      events: link.events,
      publisher: loggingPublisher(link.publisher, lifeId, log),
      model: hub.model,
      ...(hub.waitForThinker ? { awaitThinker: hub.waitForThinker } : {}),
      log,
      store: db.store,
      journal: db.journal,
      embedder,
      prompts: createPromptLibrary({
        thoughtBudgetTokens: config.mind.promptBudgetTokens,
        maxBeliefs: config.mind.maxBeliefs,
      }),
      validator: createOutputValidator({
        worldBorderRadius: config.bounds.worldBorderRadius,
        maxWorldTicks: config.bounds.maxWorldTicks,
        maxBlockOperations: config.bounds.maxBlockOperations,
      }),
      onError: (error) => log({ event: 'handler_failed', life_id: lifeId, error: String(error) }),
    });
    await mind.start();
    log({ event: 'mind_started', life_id: lifeId, shard: config.shard });
    return {
      mind,
      async stop() {
        await mind.stop();
        await closeAll();
        log({ event: 'mind_stopped', life_id: lifeId });
      },
    };
  } catch (error) {
    await closeAll();
    throw error;
  }
}

/** The production pieces: Postgres, Ollama, the Thinker hub and NATS, all on loopback. */
export const realStack: MindStack = {
  embedder: (config) =>
    new OllamaEmbedder({
      baseUrl: config.ollamaUrl,
      model: config.embedding.model,
      onCpu: config.embedding.onCpu,
      dims: config.embedding.dims,
    }),
  checkEmbedder: (config) => checkOllamaEmbedder(config),
  async openStore(config, embedder) {
    const pool = await openPool(config);
    await pool.query('SELECT 1');
    return {
      store: new PgMemoryStore(pool, {
        embedder,
        maxBeliefs: config.mind.maxBeliefs,
        maxCommitments: config.mind.maxCommitments,
      }),
      journal: new PgJournal(pool),
      close: () => pool.end(),
    };
  },
  async startHub(config, log) {
    const hub = new ThinkerHub({
      config,
      token: thinkerToken(),
      log: (line) => log({ event: 'thinker', line }),
      onThinker: ({ kind, id, models }) =>
        log({
          event: kind === 'connected' ? 'thinker_connected' : 'thinker_disconnected',
          thinker_id: id,
          thinker: config.thinker.name,
          models,
        }),
    });
    await hub.start();
    const client = new LocalThinkerClient(hub);
    return {
      model: client,
      waitForThinker: (model, timeoutMs, signal) => hub.waitForThinker(model, timeoutMs, signal),
      stop: () => hub.stop(),
    };
  },
  async openLink(config, log) {
    const nc = await connectNats({ servers: config.natsUrl, name: 'animus', timeout: 5_000 });
    const js = jetstream(nc);
    const source = new NatsEventSource({
      stream: jetStreamEventStream(js),
      shard: config.shard,
      log: (line) => log({ event: 'event_source', line }),
    });
    return {
      body: new NatsBodyLink({
        transport: natsRequestTransport(nc),
        shard: config.shard,
        lifeId: config.agent.username,
      }),
      events: source,
      publisher: new NatsPublisher(jetPublish(js)),
      start: () => source.start(),
      stopConsumer: () => source.stop(),
      close: () => nc.close().then(() => undefined),
    };
  },
};

const jsonLog: LogLine = (line) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));
};

/** Runs the Mind until a signal; the exit code is 1 when start-up failed. */
export async function main(): Promise<void> {
  const config = await loadAnimusConfig();
  const running = await startMind(config, realStack, jsonLog);
  const stopped = new Promise<void>((resolve) => {
    const onSignal = (signal: string): void => {
      jsonLog({ event: 'signal', signal, life_id: config.agent.username });
      resolve();
    };
    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));
  });
  await stopped;
  await running.stop();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    jsonLog({ event: 'fatal', error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
