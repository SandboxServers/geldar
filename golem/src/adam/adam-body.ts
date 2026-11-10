/**
 * One run of Adam's Body on one connected bot (decisions 0050, 0051): `restartBody` takes the next
 * `body_generation` and resumes a saved intent; its record sink is wrapped by the `RecentEvents`
 * digest; perception, the composed ears and the voice feed the `MindLinkServer`, which answers the
 * Mind's snapshot requests and plans over NATS. `ended` settles when the bot leaves or the Body
 * reports a fault; the supervisor (`main.ts`) then stops this run and starts the next.
 */
import type { Bot } from 'mineflayer';
import type { Body } from '../body/create-body.ts';
import type { EventPublisher } from '../body/records-nats.ts';
import {
  type RestartBodyOptions,
  type RestartedBody,
  type RestartOutcome,
  restartBody,
} from '../body/restart.ts';
import { composeEars } from '../mind-link/compose-ears.ts';
import { RecentEvents } from '../mind-link/recent-events.ts';
import { SnapshotRevision } from '../mind-link/revision.ts';
import { MindLinkServer, type RequestServer } from '../mind-link/server.ts';
import { createPerception } from '../perception/index.ts';
import { buildSnapshot } from '../snapshot.ts';
import { BotEars } from '../voice/ears.ts';
import { SpeechEvents } from '../voice/speech-event.ts';
import { BotVoice } from '../voice/voice.ts';
import { watchWorldTicks, worldAge } from '../world-clock.ts';
import type { AdamConfig } from './adam-config.ts';

/** What one run of the Body needs besides the bot. */
export interface AdamBodyEnv {
  config: AdamConfig;
  /** The generation and checkpoint buckets. */
  kv: RestartBodyOptions['kv'];
  /** Where the Body's events go (JetStream in production). */
  publisher: EventPublisher;
  /** Where the Mind's requests arrive (core NATS in production). */
  server: RequestServer;
  log: (line: string) => void;
  /** Replaced in tests; the real `restartBody` otherwise. */
  restart?: (options: RestartBodyOptions) => Promise<RestartedBody>;
  /** Passed on to `restartBody`: how long it waits before the `no_plan` wake. */
  noPlanWaitMs?: number;
}

/** A Body that is up. */
export interface RunningAdamBody {
  lifeId: string;
  generation: number;
  outcome: RestartOutcome;
  body: Body;
  /** Settles with the reason when the bot ends or `fail` is called; never rejects. */
  ended: Promise<string>;
  /** Ends this run as a crash with `reason` (a fault the supervisor should restart from). */
  fail(reason: string): void;
  /** Stops serving the Mind, the executor and the runtime; the checkpoint stays for the next run. */
  stop(): Promise<void>;
}

/**
 * Wires and starts the Body on `bot`. A start that throws, or a bot that ends during it, leaves no
 * Body behind: a live bot is quit, so the connection makes a fresh one for the supervisor.
 */
export async function startAdamBody(env: AdamBodyEnv, bot: Bot): Promise<RunningAdamBody> {
  const { config, log } = env;
  const revision = new SnapshotRevision();
  const tick = (): number => worldAge(bot) ?? 0;
  const speech = new SpeechEvents({
    publish: (event) => {
      env.publisher
        .publish(
          `geldar.${config.shard}.${event.type}`,
          JSON.stringify(event),
          event.source_event_id,
        )
        .catch((error: unknown) => log(`speech event not published: ${String(error)}`));
    },
    shard: config.shard,
    lifeId: config.lifeId,
    worldTick: tick,
    log,
  });
  // Listens before the awaited restart, so a bot that ends during the start is seen.
  let gone = false;
  let end: (reason: string) => void = () => undefined;
  const ended = new Promise<string>((resolve) => {
    end = resolve;
  });
  const onEnd = (reason?: string): void => {
    gone = true;
    end(`bot ended: ${reason ?? 'unknown'}`);
  };
  bot.once('end', onEnd);
  const wrapped: { recent: RecentEvents | null } = { recent: null };
  const restarting = (env.restart ?? restartBody)({
    lifeId: config.lifeId,
    bot,
    ticks: (listener) => watchWorldTicks(bot, listener),
    currentRevision: revision.getter(),
    kv: env.kv,
    reflexConfig: config.reflexes,
    timeScale: config.timeScale,
    nats: { publisher: env.publisher, shard: config.shard, log },
    wrapRecords: (inner) => {
      const made = new RecentEvents(inner);
      wrapped.recent = made;
      return made;
    },
    ...(env.noPlanWaitMs === undefined ? {} : { noPlanWaitMs: env.noPlanWaitMs }),
    log,
  }).then(async (body) => {
    if (wrapped.recent !== null) return body;
    await body.stop();
    throw new Error('the Body did not wrap its record sink');
  });
  let restarted: RestartedBody;
  try {
    restarted = await Promise.race([
      restarting,
      ended.then((reason) => {
        throw new Error(`bot ended during start: ${reason}`);
      }),
    ]);
  } catch (error) {
    bot.off('end', onEnd);
    // A restart that finishes after the failure is stopped, so its timers do not outlive it.
    void restarting.then(
      (late) => late.stop(),
      () => undefined,
    );
    if (!gone) bot.quit();
    throw error;
  }
  const digest = wrapped.recent;
  if (digest === null) throw new Error('the Body did not wrap its record sink');
  const { executor } = restarted.body;
  const chatEars = new BotEars({
    username: config.lifeId,
    displayName: config.displayName,
    executor: { notifyAddressed: (from) => executor.notifyAddressed(from) },
    events: speech,
    log,
  });
  const detachEars = chatEars.attach(bot);
  const voice = new BotVoice({
    username: config.lifeId,
    send: (line) => bot.chat(line),
    connected: () => bot.entity !== undefined,
    events: speech,
    rateLimitSeconds: config.rateLimitSeconds,
    maxChars: config.maxChars,
  });
  // No record carries health, so the digest learns of a drop from the bot's own event.
  const onHealth = (): void => digest.noteHealth(bot.health, tick());
  bot.on('health', onHealth);
  const link = new MindLinkServer({
    shard: config.shard,
    lifeId: config.lifeId,
    bodyGeneration: restarted.generation,
    revision,
    server: env.server,
    executor,
    perception: createPerception(bot),
    ears: composeEars(chatEars, digest),
    voice,
    buildSnapshot: (options) => buildSnapshot(bot, options),
    tick,
    publisher: env.publisher,
    log,
  });
  link.start();

  return {
    lifeId: config.lifeId,
    generation: restarted.generation,
    outcome: restarted.outcome,
    body: restarted.body,
    ended,
    fail: (reason) => end(reason),
    async stop() {
      bot.off('end', onEnd);
      bot.off('health', onHealth);
      detachEars();
      // The executor goes first: it ends the running intent, so a plan the link awaits can finish.
      await restarted.body.executor.stop();
      await link.stop();
      await restarted.stop();
    },
  };
}
