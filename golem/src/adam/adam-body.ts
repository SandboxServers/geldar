/**
 * One run of Adam's Body on one connected bot (decisions 0050, 0051): `restartBody` takes the next
 * `body_generation` and resumes a saved intent; its record sink is wrapped by the `RecentEvents`
 * digest; perception, the composed ears and the voice feed the `MindLinkServer`, which answers the
 * Mind's snapshot requests and plans over NATS. `ended` settles when the bot leaves or the Body
 * reports a fault; the supervisor (`main.ts`) then stops this run and starts the next.
 */
import { createHash } from 'node:crypto';
import { canonicalSheetJson } from '@geldar/psyche';
import type { Bot } from 'mineflayer';
import { DEFAULT_DIAG_SINK, type DiagSink } from '../actions/stall-diag.ts';
import { type OwnerTransport, wireBlockOwners } from '../body/block-owners.ts';
import type { Body } from '../body/create-body.ts';
import { watchChunkVisits } from '../body/evidence/chunk-visits.ts';
import type { EventPublisher } from '../body/records-nats.ts';
import {
  type RestartBodyOptions,
  type RestartedBody,
  type RestartOutcome,
  restartBody,
} from '../body/restart.ts';
import { stampedPublisher } from '../body/stamped-publisher.ts';
import { placeFields } from '../body/where.ts';
import { serveBodyImages } from '../body-image/image-serve.ts';
import { ImageLimiter } from '../body-image/limiter.ts';
import { RenderHost } from '../body-image/render-host.ts';
import { planCheckFrom } from '../building/plan-check-reply.ts';
import { surveyFrom } from '../building/survey-reply.ts';
import { AuditPublisher } from '../character/audit-publisher.ts';
import type { LifeCharacter } from '../character/character-config.ts';
import type { ProficiencyCache } from '../character/proficiency-cache.ts';
import { lifeThreatPolicy } from '../character/runtime.ts';
import { countingSink, type GolemMetrics } from '../metrics.ts';
import { composeEars } from '../mind-link/compose-ears.ts';
import { RecentEvents } from '../mind-link/recent-events.ts';
import { SnapshotRevision } from '../mind-link/revision.ts';
import { MindLinkServer, type RequestServer } from '../mind-link/server.ts';
import { heardSoundEvent } from '../perception/heard-sound-event.ts';
import { HurtReporter } from '../perception/hurt.ts';
import { hurtLogLine } from '../perception/hurt-log.ts';
import { hurtWorldEvent, watchHurts } from '../perception/hurt-trigger.ts';
import { createPerception } from '../perception/index.ts';
import {
  type ObservationSubscription,
  startBodyObservations,
} from '../perception/provenance/subscribe.ts';
import { observedActor } from '../perception/provenance/visible-actor.ts';
import { watchSounds } from '../perception/sounds.ts';
import { viewTextFromBot } from '../perception/view/view-from-bot.ts';
import { buildSnapshot } from '../snapshot.ts';
import { BotEars } from '../voice/ears.ts';
import { SpeechEvents } from '../voice/speech-event.ts';
import { BotVoice } from '../voice/voice.ts';
import { watchWorldTicks, worldAge } from '../world-clock.ts';
import { type ActionTracer, actionSpanSink } from './action-span-sink.ts';
import type { AdamConfig } from './adam-config.ts';

export {
  ACTION_SPAN_NAME,
  type ActionSpan,
  type ActionTracer,
  actionSpanSink,
} from './action-span-sink.ts';

/** What one run of the Body needs besides the bot. */
export interface AdamBodyEnv {
  config: AdamConfig;
  /** The generation and checkpoint buckets. */
  kv: RestartBodyOptions['kv'];
  /** Where the Body's events go (JetStream in production). */
  publisher: EventPublisher;
  /** Where the Mind's requests arrive (core NATS in production). */
  server: RequestServer;
  /** The Body's NATS connection for the block ownership record (decision 0165); absent in tests. */
  owners?: OwnerTransport;
  /**
   * Turns on the Body's observed evidence (AN-28b): the provenance subscription and the actor a hurt
   * may name. Absent or false: off, and the code path is today's. On needs `owners` too (the Body's
   * own connection). Nothing sets it in W5.
   */
  observations?: boolean;
  log: (line: string) => void;
  /**
   * Where the hurt line goes: one JSON line per hurt, written as its own line (not wrapped in `log`'s
   * body). Default: stdout, as the reflex lines are. Replaced in tests.
   */
  diag?: DiagSink;
  /** Replaced in tests; the real `restartBody` otherwise. */
  restart?: (options: RestartBodyOptions) => Promise<RestartedBody>;
  /** Passed on to `restartBody`: how long it waits before the `no_plan` wake. */
  noPlanWaitMs?: number;
  /** Telemetry (push only with a URL, see `metrics.ts`); absent in tests that do not check it. */
  metrics?: GolemMetrics;
  /** Action spans (T-07); absent when telemetry is off, so no span is made. */
  tracer?: ActionTracer;
  /**
   * The life's character (AN-07). Absent, mode off, or the standard fallback: nothing is built and
   * nothing is emitted. With a sheet from config (`source` 'config'), one `sheet_adopted` is recorded
   * at start. The sheet itself is never logged.
   */
  character?: LifeCharacter;
  /** Replaces the AuditPublisher this run would build for the adoption (tests only). */
  audit?: AuditPublisher;
  /**
   * The life's proficiency cache (AN-12a), started by the host only for a config sheet. Its combat level is read
   * at each threat decision; absent, the level is 0.
   */
  proficiency?: ProficiencyCache;
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
  const diag = env.diag ?? DEFAULT_DIAG_SINK;
  // Every event the Body publishes leaves through this seam, so the run's harness and model stamp it.
  const publisher = stampedPublisher(env.publisher, config.stamp);
  // The ownership record for goto's digging (decisions 0164, 0165): on the Body's own connection.
  const owners =
    env.owners === undefined
      ? undefined
      : wireBlockOwners({ bot, shard: config.shard, transport: env.owners, log, diag });
  // The observed evidence (AN-28b) is on only when asked for, and then needs the Body's own connection.
  const observeTransport = env.observations === true ? env.owners : undefined;
  const revision = new SnapshotRevision();
  const tick = (): number => worldAge(bot) ?? 0;
  const speech = new SpeechEvents({
    publish: (event) => {
      publisher
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
    publisher
      .publish(`geldar.${config.shard}.heard_sound`, JSON.stringify(event), event.source_event_id)
      .catch((error: unknown) => log(`heard sound not published: ${String(error)}`));
  });
  // Listens before the awaited restart, so a bot that ends during the start is seen.
  let gone = false;
  let end: (reason: string) => void = () => undefined;
  const ended = new Promise<string>((resolve) => {
    end = resolve;
  });
  // Ends the plan_check dry run still walking when this Body ends (plan-check-reply.ts).
  const planLife = new AbortController();
  // The server's world age comes with each time packet: the TPS and tick-lag metrics read it here.
  const onTime = (): void => {
    const age = worldAge(bot);
    if (age !== null) env.metrics?.worldAge(age, Date.now());
  };
  bot.on('time', onTime);
  const onEnd = (reason?: string): void => {
    gone = true;
    planLife.abort();
    stopSounds();
    bot.off('time', onTime);
    end(`bot ended: ${reason ?? 'unknown'}`);
  };
  bot.once('end', onEnd);
  const wrapped: { recent: RecentEvents | null } = { recent: null };
  // The audit producer is built when the Body's generation is bound (AN-12a), before the Body starts.
  let audit: AuditPublisher | undefined;
  const restarting = (env.restart ?? restartBody)({
    lifeId: config.lifeId,
    bot,
    ticks: (listener) => watchWorldTicks(bot, listener),
    currentRevision: revision.getter(),
    kv: env.kv,
    reflexConfig: config.reflexes,
    editSign: config.editSign,
    use: config.use,
    swim: config.swim,
    ...(env.metrics === undefined ? {} : { metrics: env.metrics }),
    building: config.building,
    agentId: config.lifeId,
    timeScale: config.timeScale,
    // Only a sheet from config is bound (AN-07 and AN-12a): the standard fallback and off build no policy.
    bindThreat: (generation) => {
      const sheet = env.character?.sheet ?? null;
      if (sheet === null || env.character?.source !== 'config') return undefined;
      audit ??=
        env.audit ??
        new AuditPublisher({
          publisher,
          shard: config.shard,
          lifeId: config.lifeId,
          generation,
          tick,
          log,
        });
      return lifeThreatPolicy({
        sheet,
        rolls: env.character.config.rolls,
        lifeId: config.lifeId,
        generation,
        tick,
        audit,
        combatLevel: () => env.proficiency?.level('combat') ?? 0,
      });
    },
    nats: { publisher, shard: config.shard, log },
    wrapRecords: (inner) => {
      const traced = env.tracer ? actionSpanSink(inner, env.tracer, log) : inner;
      const made = new RecentEvents(env.metrics ? countingSink(traced, env.metrics) : traced);
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
      (late) => {
        late.stop();
        audit?.close();
      },
      () => audit?.close(),
    );
    audit?.close();
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
  let detachChunks: () => void = () => undefined;
  let link: MindLinkServer | undefined;
  let renders: RenderHost | undefined;
  let stopImages: (() => void) | undefined;
  let stopObservations: ObservationSubscription | undefined;
  try {
    const digest = wrapped.recent;
    if (digest === null) throw new Error('the Body did not wrap its record sink');
    // The character block (AN-07): only a sheet from config is adopted. Off, no sheet, or the standard
    // fallback (never stored, so no baseline) builds no audit producer at all and emits nothing.
    const sheet = env.character?.sheet ?? null;
    if (sheet !== null && env.character?.source === 'config') {
      audit ??=
        env.audit ??
        new AuditPublisher({
          publisher,
          shard: config.shard,
          lifeId: config.lifeId,
          generation: restarted.generation,
          tick,
          log,
        });
      const hash = createHash('sha256').update(canonicalSheetJson(sheet)).digest('hex');
      audit.recordAdoption(sheet, hash, 'config');
      // First-visit chunk evidence (AN-09b), for a config sheet only. The publisher's promise is handled by the watcher.
      detachChunks = watchChunkVisits({
        bot,
        shard: config.shard,
        lifeId: config.lifeId,
        tick,
        publish: (event) =>
          publisher.publish(
            `geldar.${config.shard}.${event.type}`,
            JSON.stringify(event),
            event.source_event_id,
          ),
        log,
      });
    }
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
      // One log line per hurt, with where the Body stood: the damage event carries no coordinates.
      diag.log(
        hurtLogLine(hurt, placeFields(bot.entity?.position, bot.game?.dimension), worldTick),
      );
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
      publisher
        .publish(`geldar.${config.shard}.damage`, JSON.stringify(event), event.source_event_id)
        .catch((error: unknown) => log(`hurt event not published: ${String(error)}`));
    });
    detachHurts =
      observeTransport === undefined
        ? watchHurts(bot, hurts, tick)
        : watchHurts(bot, hurts, tick, (username) => observedActor(bot, username));
    if (observeTransport !== undefined) {
      stopObservations = startBodyObservations({
        transport: observeTransport,
        shard: config.shard,
        lifeId: config.lifeId,
        bot,
        publisher,
        log,
      });
    }
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
      view: async (size) => viewTextFromBot(bot, size),
      tick,
      publisher,
      log,
      // The survey answers from this Body's seen map (BLD-38e/38g); absent with the building flag off.
      ...(restarted.body.seen === null || restarted.body.seen === undefined
        ? {}
        : {
            survey: surveyFrom(restarted.body.seen, tick),
            planCheck: planCheckFrom(restarted.body.seen.map, bot, planLife.signal),
          }),
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
    detachChunks();
    hurts?.close();
    detachEars();
    stopObservations?.stop();
    stopImages?.();
    await renders?.close();
    audit?.close();
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
      planLife.abort();
      if (onHealth !== undefined) bot.off('health', onHealth);
      detachHurts();
      detachChunks();
      hurts?.close();
      detachEars();
      owners?.stop();
      stopObservations?.stop();
      // No new plan is accepted from here on. Then the executor and the running action end, so a
      // plan the link awaits can finish; only after that is the link waited for.
      link?.stopServing();
      stopImages?.();
      // The audit publisher closes even when an earlier step rejects: its retry loop must not outlive the Body.
      try {
        await executor.stop();
        await runtime.cancelAction();
        await link?.idle();
        await renders?.close();
        await restarted.stop();
      } finally {
        audit?.close();
      }
    },
  };
}
