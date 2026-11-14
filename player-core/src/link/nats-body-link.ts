/**
 * The Mind's end of the Body channel (spec 5.3.2, decision 0025): asks the Body for snapshots and
 * hands it plans over core NATS request/reply. Every reply is checked against the contract; one
 * that fails is a typed `BodyLinkError`, never a value the Mind could trust.
 */
import {
  type PlanAck,
  type PlanMessage,
  planSubject,
  type Snapshot,
  snapshotSubject,
  validatePlanAck,
  validateSnapshot,
} from '@geldar/contract';
import { type NatsConnection, NoRespondersError, TimeoutError } from '@nats-io/transport-node';
import { type BodyLink, BodyLinkError } from '../ports/index.ts';

/** How long a request waits for the Body's reply (spec 5.3.2: the Body's ack is due within 2 s). */
export const REQUEST_TIMEOUT_MS = 5_000;

/** Longest `reason` of a snapshot request (the port's contract). */
const REASON_LIMIT = 64;

/**
 * Sends one request and returns the reply body. Rejects with a `BodyLinkError` of code `timeout`
 * or `unavailable`; the link maps nothing else.
 */
export interface RequestTransport {
  request(subject: string, body: string, timeoutMs: number): Promise<string>;
}

/** A `RequestTransport` over a NATS connection. */
export function natsRequestTransport(nc: NatsConnection): RequestTransport {
  return {
    async request(subject, body, timeoutMs) {
      try {
        const reply = await nc.request(subject, body, { timeout: timeoutMs });
        return reply.string();
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error;
        if (cause instanceof TimeoutError) {
          throw new BodyLinkError('timeout', `no reply on ${subject} in ${timeoutMs} ms`, {
            cause: error,
          });
        }
        if (cause instanceof NoRespondersError) {
          throw new BodyLinkError('unavailable', `nobody serves ${subject}`, { cause: error });
        }
        throw new BodyLinkError('unavailable', `request on ${subject} failed: ${String(error)}`, {
          cause: error,
        });
      }
    },
  };
}

/** What a `NatsBodyLink` is built from. */
export interface NatsBodyLinkOptions {
  transport: RequestTransport;
  shard: string;
  /** The life whose Body this link talks to. */
  lifeId: string;
  /** Reply window in ms; default `REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** The `BodyLink` over NATS request/reply. */
export class NatsBodyLink implements BodyLink {
  private readonly opts: NatsBodyLinkOptions;
  private readonly snapshotTo: string;
  private readonly planTo: string;

  constructor(options: NatsBodyLinkOptions) {
    this.opts = options;
    this.snapshotTo = snapshotSubject(options.shard, options.lifeId);
    this.planTo = planSubject(options.shard, options.lifeId);
  }

  async requestSnapshot(reason: string): Promise<Snapshot> {
    const body = JSON.stringify({
      life_id: this.opts.lifeId,
      reason: reason.slice(0, REASON_LIMIT),
    });
    const text = await this.send(this.snapshotTo, body);
    const verdict = validateSnapshot(parseReply(text, this.snapshotTo));
    if (!verdict.ok) throw invalid(this.snapshotTo, verdict.errors);
    if (verdict.value.agent_id !== this.opts.lifeId) {
      throw invalid(this.snapshotTo, [
        `snapshot is for ${verdict.value.agent_id}, asked for ${this.opts.lifeId}`,
      ]);
    }
    return verdict.value;
  }

  async submitPlan(plan: PlanMessage): Promise<PlanAck> {
    const text = await this.send(this.planTo, JSON.stringify(plan));
    const verdict = validatePlanAck(parseReply(text, this.planTo));
    if (!verdict.ok) throw invalid(this.planTo, verdict.errors);
    if (verdict.value.thought_id !== plan.thought_id) {
      throw invalid(this.planTo, [
        `ack is for ${verdict.value.thought_id}, sent ${plan.thought_id}`,
      ]);
    }
    return verdict.value;
  }

  private async send(subject: string, body: string): Promise<string> {
    try {
      return await this.opts.transport.request(
        subject,
        body,
        this.opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof BodyLinkError) throw error;
      throw new BodyLinkError('unavailable', `request on ${subject} failed: ${String(error)}`, {
        cause: error,
      });
    }
  }
}

function parseReply(text: string, subject: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new BodyLinkError('invalid_reply', `reply on ${subject} is not JSON`, { cause: error });
  }
}

function invalid(subject: string, errors: string[]): BodyLinkError {
  return new BodyLinkError('invalid_reply', `reply on ${subject}: ${errors.join('; ')}`);
}
