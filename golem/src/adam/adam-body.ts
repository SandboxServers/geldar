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
import { serveBodyImages } from '../body-image/image-serve.ts';
import { ImageLimiter } from '../body-image/limiter.ts';
import { RenderHost } from '../body-image/render-host.ts';
import { countingSink, type GolemMetrics } from '../metrics.ts';
import { composeEars } from '../mind-link/compose-ears.ts';
import { RecentEvents } from '../mind-link/recent-events.ts';
import { SnapshotRevision } from '../mind-link/revision.ts';
import { MindLinkServer, type RequestServer } from '../mind-link/server.ts';
import { heardSoundEvent } from '../perception/heard-sound-event.ts';
import { HurtReporter } from '../perception/hurt.ts';
import { hurtWorldEvent, watchHurts } from '../perception/hurt-trigger.ts';
import { createPerception } from '../perception/index.ts';
import { watchSounds } from '../perception/sounds.ts';
import { viewTextFromBot } from '../perception/view/view-from-bot.ts';
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
  /** Telemetry (push only with a URL, see `metrics.ts`); absent in tests that do not check it. */
  metrics?: GolemMetrics;
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
  // Heard sounds (PX-4): each leaves as a heard_sound event with a compass point and a band, never coordinates.
  let heardCount = 0;
  const stopSounds = watchSounds(bot, (sound) => {
    heardCount += 1;
    const event = heardSoundEvent(sound, {
      shard: config.shard,
      lifeId: config.lifeId,
      tick: tick(),
      at: new Date(),
      seq: heardCount,
    });
    if (event === null) return;
    env.publisher
      .publish(`geldar.${config.shard}.heard_sound`, JSON.stringify(event), event.source_event_id)
      .catch((error: unknown) => log(`heard sound not published: ${String(error)}`));
  });
  // Listens before the awaited restart, so a bot that ends during the start is seen.
  let gone = false;
  let end: (reason: string) => void = () => undefined;
  const ended = new Promise<string>((resolve) => {
    end = resolve;
  });
  // The server's world age comes with each time packet: the TPS and tick-lag metrics read it here.
  const onTime = (): void => {
    const age = worldAge(bot);
    if (age !== null) env.metrics?.worldAge(age, Date.now());
  };
  bot.on('time', onTime);
  const onEnd = (reason?: string): void => {
    gone = true;
    stopSounds();
    bot.off('time', onTime);
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
      const made = new RecentEvents(env.metrics ? countingSink(inner, env.metrics) : inner);
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
  const { executor, runtime } = restarted.body;
  env.metrics?.bodyConnected(true);
  void ended.then(() => env.metrics?.bodyConnected(false));
  // Wired after the restart: a throw here stops the restarted Body and quits the bot, as above.
  let detachEars: () => void = () => undefined;
  let onHealth: (() => void) | undefined;
  let hurts: HurtReporter | undefined;
  let detachHurts: () => void = () => undefined;
  let link: MindLinkServer | undefined;
  let renders: RenderHost | undefined;
  let stopImages: (() => void) | undefined;
  try {
    const digest = wrapped.recent;
    if (digest === null) throw new Error('the Body did not wrap its record sink');
    const chatEars = new BotEars({
      username: config.lifeId,
      displayName: config.displayName,
      executor: { notifyAddressed: (from) => executor.notifyAddressed(from) },
      events: speech,
      log,
    });
    detachEars = chatEars.attach(bot);
    const voice = new BotVoice({
      username: config.lifeId,
      send: (line) => bot.chat(line),
      connected: () => bot.entity !== undefined,
      events: speech,
      rateLimitSeconds: config.rateLimitSeconds,
      maxChars: config.maxChars,
    });
    // No record carries health, so the digest learns of a drop from the bot's own event.
    onHealth = (): void => digest.noteHealth(bot.health, tick());
    bot.on('health', onHealth);
    // The hurt event (PX-1): a loss of health, with the nearby attacker's bearing when there is one.
    let hurtSequence = 0;
    hurts = new HurtReporter((hurt, worldTick) => {
      hurtSequence += 1;
      const event = hurtWorldEvent(hurt, {
        shard: config.shard,
        lifeId: config.lifeId,
        worldTick,
        at: new Date().toISOString(),
        sequence: hurtSequence,
      });
      if (event === null) {
        log('hurt: dropped an event the contract refuses');
        return;
      }
      env.publisher
        .publish(`geldar.${config.shard}.damage`, JSON.stringify(event), event.source_event_id)
        .catch((error: unknown) => log(`hurt event not published: ${String(error)}`));
    });
    detachHurts = watchHurts(bot, hurts, tick);
    link = new MindLinkServer({
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
    // The image server (decision 0156, VP-2): its own renderer worker and rate limiter, per run.
    renders = new RenderHost();
    stopImages = serveBodyImages(env.server, config.shard, config.lifeId, {
      bot,
      render: renders,
      limiter: new ImageLimiter(),
    });
  } catch (error) {
    bot.off('end', onEnd);
    if (onHealth !== undefined) bot.off('health', onHealth);
    detachHurts();
    hurts?.close();
    detachEars();
    stopImages?.();
    await renders?.close();
    await restarted.stop().catch((stopError: unknown) => {
      log(`restarted Body did not stop after a failed start: ${String(stopError)}`);
    });
    if (!gone) bot.quit();
    throw error;
  }

  return {
    lifeId: config.lifeId,
    generation: restarted.generation,
    outcome: restarted.outcome,
    body: restarted.body,
    ended,
    fail: (reason) => end(reason),
    async stop() {
      bot.off('end', onEnd);
      if (onHealth !== undefined) bot.off('health', onHealth);
      detachHurts();
      hurts?.close();
      detachEars();
      // No new plan is accepted from here on. Then the executor and the running action end, so a
      // plan the link awaits can finish; only after that is the link waited for.
      link?.stopServing();
      stopImages?.();
      await executor.stop();
      await runtime.cancelAction();
      await link?.idle();
      await renders?.close();
      await restarted.stop();
    },
  };
}
