/**
 * The Body's end of the Body-Mind channel (spec 5.2, 5.3.2, decision 0025): answers the Mind's
 * snapshot requests and plans over core NATS request/reply, on the two subjects of one life.
 * It owns no world knowledge: the snapshot comes from the injected builder and the `Senses`
 * interfaces, the plan runs in the executor, and speech goes through the `Voice`.
 */
import {
  type PlanAck,
  type PlanMessage,
  type PlanResultPayload,
  planSubject,
  type Snapshot,
  snapshotSubject,
  validatePlanAck,
  validatePlanMessage,
  validatePlanResultPayload,
  validateSnapshot,
  validateSnapshotRequest,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import type { NatsConnection } from '@nats-io/transport-node';
import type { IntentExecutor, PlanEnvelope, SubmitResult } from '../body/executor.ts';
import type { EventPublisher } from '../body/records-nats.ts';
import { eventIdFor } from '../body/records-nats.ts';
import { checkValidity, type Rejection } from '../body/validity.ts';
import type { SnapshotOptions } from '../snapshot.ts';
import type { SnapshotRevision } from './revision.ts';
import type { Ears, Perception, Voice } from './senses.ts';

/** The Mind waits at most this long for a plan's ack (spec 5.3.2). */
export const PLAN_ACK_DEADLINE_MS = 2_000;

/** How many answered thought ids the server remembers, so a redelivered plan gets its old ack. */
const REMEMBERED_ACKS = 1024;

/** Minecraft ticks in one world day. */
const TICKS_PER_DAY = 24_000;

/** Longest rejection detail the contract allows. */
const DETAIL_LIMIT = 256;

const THOUGHT_ID = /^th_[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Where requests arrive: `serve` calls `handler` for each message on `subject`; `reply` sends the
 * answer (it may be called once, or not at all). Returns the function that stops serving.
 */
export interface RequestServer {
  serve(
    subject: string,
    handler: (data: string, reply: (body: string) => void) => Promise<void>,
  ): () => void;
}

/** A `RequestServer` over a NATS connection (core request/reply, no JetStream). */
export function natsRequestServer(nc: NatsConnection): RequestServer {
  return {
    serve(subject, handler) {
      const sub = nc.subscribe(subject);
      void (async () => {
        for await (const msg of sub) {
          handler(msg.string(), (body) => msg.respond(body)).catch((error: unknown) => {
            console.warn(`mind-link: handler for ${subject} failed: ${String(error)}`);
          });
        }
      })();
      return () => sub.unsubscribe();
    },
  };
}

/** The part of the executor the server uses. */
export type PlanExecutor = Pick<IntentExecutor, 'submit' | 'intentId' | 'intentState'>;

/** What a `MindLinkServer` is built from. */
export interface MindLinkServerOptions {
  shard: string;
  /** The life this Body plays; only its two subjects are served. */
  lifeId: string;
  bodyGeneration: number;
  revision: SnapshotRevision;
  server: RequestServer;
  executor: PlanExecutor;
  perception: Perception;
  ears: Ears;
  voice: Voice;
  /** Builds the snapshot from the bot's state plus the options; throws on an invalid one. */
  buildSnapshot: (options: SnapshotOptions) => Snapshot;
  /** World age now. */
  tick: () => number;
  /** Where `plan_result` events go (JetStream in production). */
  publisher: EventPublisher;
  budgetRemainingThoughts?: () => number;
  daysSinceSleep?: () => number;
  now?: () => Date;
  log?: (line: string) => void;
}

/** The server: `start` serves the two subjects, `stop` stops serving and waits for running plans. */
export class MindLinkServer {
  private readonly opts: MindLinkServerOptions;
  private readonly acks = new Map<string, PlanAck>();
  private readonly running = new Set<Promise<void>>();
  private readonly stops: Array<() => void> = [];
  private lastIntent: { goal: string; program: string } | null = null;

  constructor(options: MindLinkServerOptions) {
    this.opts = options;
  }

  /** Starts serving. A second call is a no-op. */
  start(): void {
    if (this.stops.length > 0) return;
    const { server, shard, lifeId } = this.opts;
    this.stops.push(
      server.serve(snapshotSubject(shard, lifeId), (data, reply) =>
        Promise.resolve(this.onSnapshotRequest(data, reply)),
      ),
      server.serve(planSubject(shard, lifeId), (data, reply) =>
        Promise.resolve(this.onPlan(data, reply)),
      ),
    );
  }

  /** Stops serving and resolves once the plans already accepted have finished. */
  async stop(): Promise<void> {
    for (const stop of this.stops.splice(0)) stop();
    await this.idle();
  }

  /** Resolves when no accepted plan is still running. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private log(line: string): void {
    (this.opts.log ?? console.warn)(`mind-link: ${line}`);
  }

  private onSnapshotRequest(data: string, reply: (body: string) => void): void {
    const request = validateSnapshotRequest(parse(data));
    if (!request.ok) {
      this.log(`snapshot request refused: ${request.errors.join('; ')}`);
      return;
    }
    if (request.value.life_id !== this.opts.lifeId) {
      this.log(`snapshot request for ${request.value.life_id}, serving ${this.opts.lifeId}`);
      return;
    }
    const revision = this.opts.revision.next();
    let snapshot: Snapshot;
    try {
      snapshot = this.opts.buildSnapshot({
        lifeId: this.opts.lifeId,
        shard: this.opts.shard,
        revision,
        bodyGeneration: this.opts.bodyGeneration,
        ...(this.opts.budgetRemainingThoughts
          ? { budgetRemainingThoughts: this.opts.budgetRemainingThoughts() }
          : {}),
        ...(this.opts.daysSinceSleep ? { daysSinceSleep: this.opts.daysSinceSleep() } : {}),
        heard: this.opts.ears.heard(),
        events: this.opts.ears.drainEvents(),
        surroundings: this.opts.perception.surroundings(),
        unlockedRecipes: this.opts.perception.unlockedRecipes(),
        currentPlan: this.currentPlan(),
      });
    } catch (error) {
      this.log(`snapshot not built: ${String(error)}`);
      return;
    }
    const verdict = validateSnapshot(snapshot);
    if (!verdict.ok) {
      this.log(`snapshot invalid: ${verdict.errors.join('; ')}`);
      return;
    }
    reply(JSON.stringify(snapshot));
  }

  /** What the agent is doing now: the intent the last accepted plan started, while it runs. */
  private currentPlan(): Snapshot['current_plan'] {
    const state = this.opts.executor.intentState;
    if (state === null || this.lastIntent === null) return null;
    return { goal: this.lastIntent.goal, action: this.lastIntent.program, status: state };
  }

  private onPlan(data: string, reply: (body: string) => void): void {
    const raw = parse(data);
    const verdict = validatePlanMessage(raw);
    if (!verdict.ok) {
      const id = (raw as { thought_id?: unknown } | null)?.thought_id;
      if (typeof id === 'string' && THOUGHT_ID.test(id)) {
        this.answer(reply, id, {
          reason: 'invalid_plan',
          detail: verdict.errors.join('; '),
        });
      } else {
        this.log(`plan with no usable thought id refused: ${verdict.errors.join('; ')}`);
      }
      return;
    }
    const plan = verdict.value;
    const known = this.acks.get(plan.thought_id);
    if (known !== undefined) {
      reply(JSON.stringify(known));
      return;
    }
    const rejection = checkValidity(
      {
        lifeId: plan.life_id,
        bodyGeneration: plan.body_generation,
        snapshotRevision: plan.snapshot_revision,
        expiresTick: plan.expires_tick,
      },
      {
        lifeId: this.opts.lifeId,
        bodyGeneration: this.opts.bodyGeneration,
        currentRevision: this.opts.revision.current,
        tick: this.opts.tick(),
      },
    );
    const sent = this.answer(reply, plan.thought_id, rejection);
    if (rejection !== null || !sent) return;
    const run = this.run(plan).catch((error: unknown) => {
      this.log(`plan ${plan.thought_id} failed: ${String(error)}`);
    });
    this.running.add(run);
    void run.finally(() => this.running.delete(run));
  }

  /** Builds, stores and sends the ack. False when the ack itself is invalid (nothing is sent). */
  private answer(
    reply: (body: string) => void,
    thoughtId: string,
    rejection: Rejection | null,
  ): boolean {
    const ack: PlanAck = {
      thought_id: thoughtId,
      accepted: rejection === null,
      rejection:
        rejection === null
          ? null
          : { reason: rejection.reason, detail: rejection.detail.slice(0, DETAIL_LIMIT) },
    };
    const verdict = validatePlanAck(ack);
    if (!verdict.ok) {
      this.log(`ack invalid: ${verdict.errors.join('; ')}`);
      return false;
    }
    this.acks.set(thoughtId, ack);
    if (this.acks.size > REMEMBERED_ACKS) {
      const oldest = this.acks.keys().next().value;
      if (oldest !== undefined) this.acks.delete(oldest);
    }
    reply(JSON.stringify(ack));
    return true;
  }

  /** After the ack: runs the plan, speaks if it was not refused, then reports the result. */
  private async run(plan: PlanMessage): Promise<void> {
    const envelope: PlanEnvelope = {
      lifeId: plan.life_id,
      bodyGeneration: plan.body_generation,
      snapshotRevision: plan.snapshot_revision,
      expiresTick: plan.expires_tick,
      sourceSnapshotId: plan.source_snapshot_id,
      actionIds: plan.action_ids,
      ...(plan.intent_id !== undefined ? { intentId: plan.intent_id } : {}),
    };
    const result = await this.opts.executor.submit(plan.thought, envelope);
    if (result.intent === 'started' && plan.thought.intent) {
      this.lastIntent = { goal: plan.thought.intent.goal, program: plan.thought.intent.program };
    }
    let said = false;
    const text = plan.thought.say;
    if (result.rejection === null && typeof text === 'string' && text.trim() !== '') {
      const outcome = await this.opts.voice.say(text);
      said = outcome.status === 'said';
    }
    await this.publishResult(plan.thought_id, result, said);
  }

  private async publishResult(
    thoughtId: string,
    result: SubmitResult,
    said: boolean,
  ): Promise<void> {
    const payload = {
      thought_id: thoughtId,
      intent: result.intent,
      failed_at: result.failedAt,
      actions: result.actions.map(({ record }) => ({
        action_id: record.action_id,
        state: record.state,
        ...reasonOf(record.result),
      })),
      said,
    } as PlanResultPayload;
    const checked = validatePlanResultPayload(payload);
    if (!checked.ok) {
      this.log(`plan_result invalid: ${checked.errors.join('; ')}`);
      return;
    }
    const tick = this.opts.tick();
    const event: WorldEvent = {
      source_event_id: eventIdFor(`plan_result:${thoughtId}`),
      at: (this.opts.now?.() ?? new Date()).toISOString(),
      shard: this.opts.shard,
      world_day: Math.floor(tick / TICKS_PER_DAY),
      world_tick: tick,
      type: 'plan_result',
      agent_id: this.opts.lifeId,
      payload: { ...payload },
    };
    const verdict = validateWorldEvent(event);
    if (!verdict.ok) {
      this.log(`plan_result event invalid: ${verdict.errors.join('; ')}`);
      return;
    }
    try {
      await this.opts.publisher.publish(
        `geldar.${this.opts.shard}.plan_result`,
        JSON.stringify(event),
        event.source_event_id,
      );
    } catch (error) {
      this.log(`plan_result ${thoughtId} not published: ${String(error)}`);
    }
  }
}

/** The `reason` field of a plan result action: the failure reason of the stored result, when it has one. */
function reasonOf(result: { [k: string]: unknown } | null): { reason?: string } {
  const reason = result?.reason;
  return typeof reason === 'string' ? { reason: reason.slice(0, DETAIL_LIMIT) } : {};
}

/** JSON.parse that yields `undefined` for text that is not JSON, so validation reports it. */
function parse(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}
