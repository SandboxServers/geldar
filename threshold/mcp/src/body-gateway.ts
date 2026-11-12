import {
  NatsBodyLink,
  REQUEST_TIMEOUT_MS,
  type RequestTransport,
} from '@geldar/animus/src/link/nats-body-link.ts';
import type { BookReply, PlanAck, PlanMessage, Snapshot } from '@geldar/contract';
import {
  bookSubject,
  validateBookReply,
  validateSeeResult,
  validateViewResult,
  viewImageSubject,
  viewSubject,
} from '@geldar/contract';
import type { BodyGateway } from './ports.ts';
import { BodyUnavailable } from './ports.ts';
import type { SeeRead } from './tools/see.ts';
import type { ViewRead } from './tools/view.ts';

/** How long a `book` request waits for the Body's reply (the packet's 5 s). */
export const BOOK_TIMEOUT_MS = 5_000;

/** How long a `view` request waits for the Body's reply (the packet's 5 s). */
const VIEW_TIMEOUT_MS = 5_000;

/** How long a `see` request waits for the Body's picture (the packet's 5 s). */
const SEE_TIMEOUT_MS = 5_000;

/** True for the Body's own `{"error":"unavailable"}` reply to a view request. */
function isUnavailable(reply: unknown): boolean {
  return (
    typeof reply === 'object' &&
    reply !== null &&
    (reply as { error?: unknown }).error === 'unavailable'
  );
}

/** The Body's typed refusal to a picture request, or null when the reply is not one. */
function refusalOf(reply: unknown): { error: 'view_unavailable'; detail: string } | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const { error, detail } = reply as { error?: unknown; detail?: unknown };
  if (error !== 'view_unavailable' || typeof detail !== 'string') return null;
  return { error, detail };
}

/** Why a snapshot is asked for; the Body logs it, so it names the caller, not the world. */
const SNAPSHOT_REASON = 'mcp_request';

/** What the NATS gateway is built from. */
export interface NatsBodyGatewayOptions {
  /** Request/reply over the NATS connection (`natsRequestTransport` in production). */
  transport: RequestTransport;
  /** The shard whose Bodies answer; a token the contract's subjects accept. */
  shard: string;
  /** Reply window for a snapshot or a plan, in ms; the animus link's default when unset. */
  timeoutMs?: number;
}

/**
 * The `BodyGateway` over NATS. Each life has one animus `NatsBodyLink` for its snapshot and its
 * plan; the book request goes to the life's book subject. The gateway asks only the three subjects
 * the contract builds (snapshot, plan, book) and takes the life id from the caller, which the
 * server reads from Postgres, never from a client. Every reply is untrusted: it is parsed and
 * validated before use, and any failure rejects with `BodyUnavailable`.
 */
export class NatsBodyGateway implements BodyGateway {
  private readonly transport: RequestTransport;
  private readonly shard: string;
  private readonly timeoutMs: number;
  private readonly links = new Map<string, NatsBodyLink>();

  constructor(options: NatsBodyGatewayOptions) {
    this.transport = options.transport;
    this.shard = options.shard;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  snapshot(lifeId: string): Promise<Snapshot> {
    return this.guard(lifeId, 'snapshot', () =>
      this.linkFor(lifeId).requestSnapshot(SNAPSHOT_REASON),
    );
  }

  submitPlan(lifeId: string, plan: PlanMessage): Promise<PlanAck> {
    return this.guard(lifeId, 'plan', () => this.linkFor(lifeId).submitPlan(plan));
  }

  book(lifeId: string): Promise<BookReply> {
    return this.guard(lifeId, 'book', async () => {
      const subject = bookSubject(this.shard, lifeId);
      const body = JSON.stringify({ life_id: lifeId });
      const text = await this.transport.request(subject, body, BOOK_TIMEOUT_MS);
      const verdict = validateBookReply(JSON.parse(text) as unknown);
      if (!verdict.ok) throw new Error('book reply failed validation');
      return verdict.value;
    });
  }

  /** The Body's text viewport; the Body's own `unavailable` reply comes back as data, the rest as failure. */
  view(lifeId: string, size: { cols?: number; rows?: number }): Promise<ViewRead> {
    return this.guard(lifeId, 'view', async (): Promise<ViewRead> => {
      const body = JSON.stringify(size);
      const text = await this.transport.request(
        viewSubject(this.shard, lifeId),
        body,
        VIEW_TIMEOUT_MS,
      );
      const reply = JSON.parse(text) as unknown;
      if (isUnavailable(reply)) return { error: 'unavailable' };
      const verdict = validateViewResult(reply);
      if (!verdict.ok) throw new Error('view reply failed validation');
      return { text: verdict.value.text };
    });
  }

  /** The Body's picture from where its body looks; its typed refusal comes back as data, the rest as failure. */
  see(lifeId: string, size: { width?: number; height?: number }): Promise<SeeRead> {
    return this.guard(lifeId, 'see', async (): Promise<SeeRead> => {
      const text = await this.transport.request(
        viewImageSubject(this.shard, lifeId),
        JSON.stringify(size),
        SEE_TIMEOUT_MS,
      );
      const reply = JSON.parse(text) as unknown;
      const refusal = refusalOf(reply);
      if (refusal !== null) return refusal;
      const verdict = validateSeeResult(reply);
      if (!verdict.ok) throw new Error('see reply failed validation');
      return { png: verdict.value.png };
    });
  }

  /** Runs one request; every failure, a timeout or an invalid reply included, is unavailability. */
  private async guard<T>(lifeId: string, what: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (cause) {
      throw new BodyUnavailable(`the Body did not answer the ${what} request for ${lifeId}`, {
        cause,
      });
    }
  }

  private linkFor(lifeId: string): NatsBodyLink {
    let link = this.links.get(lifeId);
    if (link === undefined) {
      link = new NatsBodyLink({
        transport: this.transport,
        shard: this.shard,
        lifeId,
        timeoutMs: this.timeoutMs,
      });
      this.links.set(lifeId, link);
    }
    return link;
  }
}
