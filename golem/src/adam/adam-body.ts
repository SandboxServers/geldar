/**
 * One run of Adam's Body on one connected bot (decisions 0050, 0051): `restartBody` takes the next
 * `body_generation` and resumes a saved intent; its record sink is wrapped by the `RecentEvents`
 * digest; perception, the composed ears and the voice feed the `MindLinkServer`, which answers the
 * Mind's snapshot requests and plans over NATS. `ended` settles when the bot leaves or the Body
 * reports a fault; the supervisor (`main.ts`) then stops this run and starts the next.
 */
import { createHash } from 'node:crypto';
import type { ActionRecord } from '@geldar/contract';
import { canonicalSheetJson } from '@geldar/psyche';
import type { Bot } from 'mineflayer';
import { DEFAULT_DIAG_SINK, type DiagSink } from '../actions/stall-diag.ts';
import { type OwnerTransport, wireBlockOwners } from '../body/block-owners.ts';
import type { Body } from '../body/create-body.ts';
import { watchChunkVisits } from '../body/evidence/chunk-visits.ts';
import type { RecordSink } from '../body/records.ts';
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
import { AuditPublisher } from '../character/audit-publisher.ts';
import type { LifeCharacter } from '../character/character-config.ts';
import type { ProficiencyCache } from '../character/proficiency-cache.ts';
import { lifeThreatPolicy } from '../character/runtime.ts';
import { countingSink, type GolemMetrics, OUTCOME_STATUS_LABELS } from '../metrics.ts';
import { composeEars } from '../mind-link/compose-ears.ts';
import { RecentEvents } from '../mind-link/recent-events.ts';
import { SnapshotRevision } from '../mind-link/revision.ts';
import { MindLinkServer, type RequestServer } from '../mind-link/server.ts';
import { heardSoundEvent } from '../perception/heard-sound-event.ts';
import { HurtReporter } from '../perception/hurt.ts';
import { hurtLogLine } from '../perception/hurt-log.ts';
import { hurtWorldEvent, watchHurts } from '../perception/hurt-trigger.ts';
import { createPerception } from '../perception/index.ts';
import { watchSounds } from '../perception/sounds.ts';
import { viewTextFromBot } from '../perception/view/view-from-bot.ts';
import { buildSnapshot } from '../snapshot.ts';
import { BotEars } from '../voice/ears.ts';
import { SpeechEvents } from '../voice/speech-event.ts';
import { BotVoice } from '../voice/voice.ts';
import { watchWorldTicks, worldAge } from '../world-clock.ts';
import { ACTION_ERROR_EVENT, actionErrorAttributes } from './action-error-event.ts';
import type { AdamConfig } from './adam-config.ts';

/** The two span calls the Body makes. A tracer from the telemetry SDK satisfies this structurally. */
export interface ActionSpan {
  setAttribute(key: string, value: string): unknown;
  /** A failed action adds one `action_error` event; absent on a span that cannot take events. */
  addEvent?(name: string, attributes?: Record<string, string | number | boolean>): unknown;
  end(): void;
}
export interface ActionTracer {
  startSpan(name: string): ActionSpan;
}

/** The span name for one body action (T-07). */
export const ACTION_SPAN_NAME = 'geldar.body.action';
/** Spans open at once; an action that starts past this is not traced. */
const MAX_OPEN_ACTION_SPANS = 256;

/**
 * Wraps a record sink so each action gets one span, from its first record to its terminal result.
 * The span carries only `action_id` and `outcome` (a closed status label): never thought, chat,
 * speech or prompt text. Every record still reaches `inner`, and a tracer failure is swallowed here.
 */
export function actionSpanSink(
  inner: RecordSink,
  tracer: ActionTracer,
  log: (line: string) => void = () => undefined,
): RecordSink {
  const open = new Map<string, ActionSpan>();
  let capLogged = false;
  /** Sets the outcome and ends the span; the entry is removed by the caller before this runs. */
  const finish = (span: ActionSpan, outcome: string, result?: ActionRecord['result']): void => {
    try {
      span.setAttribute('outcome', outcome);
      // The failure text goes to the span only, scrubbed; an event failure never skips `end()`.
      const attributes = result ? actionErrorAttributes(result) : null;
      if (attributes) span.addEvent?.(ACTION_ERROR_EVENT, attributes);
    } finally {
      span.end();
    }
  };
  const observe = (record: ActionRecord): void => {
    const id = record.action_id;
    const result = record.result ?? null;
    let span = open.get(id);
    if (span === undefined) {
      // A running action holds a slot, so at the cap the oldest open span is ended to make room. A
      // terminal-only record is started and ended at once, so it needs no slot and never evicts.
      if (result === null && open.size >= MAX_OPEN_ACTION_SPANS) {
        const oldest = open.entries().next();
        if (!oldest.done) {
          const [oldestId, oldestSpan] = oldest.value;
          open.delete(oldestId);
          if (!capLogged) {
            capLogged = true;
            log(`action spans: ${MAX_OPEN_ACTION_SPANS} open; the oldest is ended as other`);
          }
          finish(oldestSpan, 'other');
        }
      }
      span = tracer.startSpan(ACTION_SPAN_NAME);
      try {
        span.setAttribute('action_id', id);
      } catch (error) {
        span.end();
        throw error;
      }
      if (result === null) open.set(id, span);
    }
    if (result !== null) {
      // The entry goes before the span ends, so a failure below never leaves it open.
      open.delete(id);
      const status = String(result.status);
      const outcome = (OUTCOME_STATUS_LABELS as readonly string[]).includes(status)
        ? status
        : 'other';
      finish(span, outcome, result);
    }
  };
  return {
    intentChanged: (change) => inner.intentChanged(change),
    actionChanged: (record) => {
      try {
        observe(record);
      } catch {
        // A span failure never reaches the Body.
      }
      inner.actionChanged(record);
    },
    receipt: (receipt) => inner.receipt(receipt),
    reflexFired: (record) => inner.reflexFired(record),
    wake: (request) => inner.wake(request),
    actionOutcome: (payload, tick) => inner.actionOutcome?.(payload, tick),
  };
}

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
      view: async (size) => viewTextFromBot(bot, size),
      tick,
      publisher,
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
    detachChunks();
    hurts?.close();
    detachEars();
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
      if (onHealth !== undefined) bot.off('health', onHealth);
      detachHurts();
      detachChunks();
      hurts?.close();
      detachEars();
      owners?.stop();
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
