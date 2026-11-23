import type { BookReply, PlanAck, PlanMessage, Snapshot } from '@geldar/contract';
import {
  bookSubject,
  planCheckSubject,
  surveySubject,
  validateBookReply,
  validateSeeResult,
  validateToolResult,
  validateViewResult,
  viewImageSubject,
  viewSubject,
} from '@geldar/contract';
import {
  type ChunkStream,
  NatsBodyLink,
  REQUEST_TIMEOUT_MS,
  type RequestTransport,
} from '@geldar/player-core/src/link/nats-body-link.ts';
import type { BodyGateway } from './ports.ts';
import { BodyUnavailable } from './ports.ts';
import type { SeeRead } from './tools/see.ts';
import type { ViewRead } from './tools/view.ts';

/**
 * Message names the building packets (BLD-S3b) reserve on the gateway. The survey and plan_check methods
 * send their messages; plan_progress arrives as a Body event.
 */
export const SURVEY_MESSAGE = 'survey';
export const PLAN_CHECK_MESSAGE = 'plan_check';
export const PLAN_PROGRESS_EVENT = 'plan_progress';

/** How long a `book` request waits for the Body's reply (the packet's 5 s). */
export const BOOK_TIMEOUT_MS = 5_000;

/** How long a `view` request waits for the Body's reply (the packet's 5 s). */
const VIEW_TIMEOUT_MS = 5_000;

/** How long a `survey` request waits for the Body's reply (the packet's 5 s). */
const SURVEY_TIMEOUT_MS = 5_000;

/**
 * How long a `plan_check` may go without a chunk (a progress report or the final reply) before it is
 * stalled. There is no cap on the plan's size (decision 0423): a long walk that keeps reporting is not cut off.
 */
export const PLAN_CHECK_IDLE_MS = 5_000;

/** The request a requester that gave up sends so the Body stops its walk; the Body answers it as invalid input. */
const PLAN_CHECK_CANCEL = JSON.stringify({ cancel: true });

/** True for a progress chunk (an object with a `progress` key). Any other chunk is the final reply. */
function isProgressChunk(text: string): boolean {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null && 'progress' in value;
  } catch {
    return false;
  }
}

/** The next chunk of a stream; rejects as stalled when none arrives within `ms`. */
function nextChunk(stream: ChunkStream, ms: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`plan check stalled: no progress or reply for ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([stream.next(), idle]).finally(() => clearTimeout(timer));
}

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
  private readonly checks = new Map<string, number>();
  private checkSeq = 0;

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

  /**
   * The Body's survey of a box (BLD-38e). The Body answers `{ text, truncated }`; a refusal such as
   * `{"error":"not_available"}` (the building flag is off) or any reply the contract does not accept
   * is a failure, so it rejects with `BodyUnavailable` and the tool never returns it as data. The Body's
   * `box_too_large` refusal (a box over its cell cap) comes back as data; the tool turns it into an error.
   */
  survey(lifeId: string, request: { box: unknown; layers?: number }): Promise<unknown> {
    return this.guard(lifeId, 'survey', async (): Promise<unknown> => {
      const text = await this.transport.request(
        surveySubject(this.shard, lifeId),
        JSON.stringify(request),
        SURVEY_TIMEOUT_MS,
      );
      const reply = JSON.parse(text) as unknown;
      if (
        typeof reply === 'object' &&
        reply !== null &&
        (reply as { error?: unknown }).error === 'box_too_large'
      )
        return reply;
      if (!validateToolResult('survey', reply).ok)
        throw new Error('survey reply failed validation');
      return reply;
    });
  }

  /**
   * The Body's dry run of a plan (BLD-22b). The Body streams progress chunks on the request's reply inbox;
   * each one resets the idle timer, and the first other chunk is the final reply. A plan with no chunk for
   * `PLAN_CHECK_IDLE_MS` is stalled: the gateway cancels the Body's walk and rejects. The Body's `plan_too_large`
   * refusal comes back as data; any other reply the contract does not accept (the flag-off `not_available` included)
   * rejects with `BodyUnavailable`.
   */
  planCheck(lifeId: string, request: { plan: unknown }): Promise<unknown> {
    return this.guard(lifeId, 'plan_check', async (): Promise<unknown> => {
      const subject = planCheckSubject(this.shard, lifeId);
      const token = this.nextCheck(lifeId);
      const text = await this.readCheck(subject, JSON.stringify(request), lifeId, token);
      const reply = JSON.parse(text) as unknown;
      if (
        typeof reply === 'object' &&
        reply !== null &&
        (reply as { error?: unknown }).error === 'plan_too_large'
      )
        return reply;
      if (!validateToolResult('plan_check', reply).ok)
        throw new Error('plan_check reply failed validation');
      return reply;
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

  /** Marks `lifeId`'s newest plan_check; returns its token so a failed one is cancelled only if still newest. */
  private nextCheck(lifeId: string): number {
    this.checkSeq += 1;
    this.checks.set(lifeId, this.checkSeq);
    return this.checkSeq;
  }

  /**
   * Reads one plan_check's chunks until the final reply. A stall, or any failure, closes the stream and, when
   * this is still the life's newest plan_check, sends the Body a cancel so its walk stops.
   */
  private async readCheck(subject: string, body: string, lifeId: string, token: number) {
    const stream = this.openStream(subject, body);
    try {
      for (;;) {
        const chunk = await nextChunk(stream, PLAN_CHECK_IDLE_MS);
        if (chunk === null) throw new Error('plan check ended without a reply');
        if (!isProgressChunk(chunk)) return chunk;
      }
    } catch (cause) {
      if (this.checks.get(lifeId) === token) {
        this.transport
          .request(subject, PLAN_CHECK_CANCEL, PLAN_CHECK_IDLE_MS)
          .catch(() => undefined);
      }
      throw cause;
    } finally {
      stream.close();
    }
  }

  /** The chunk stream of a request; a transport without streaming gets its one reply as the only chunk. */
  private openStream(subject: string, body: string): ChunkStream {
    if (this.transport.stream !== undefined) return this.transport.stream(subject, body);
    let pending: Promise<string> | null = this.transport.request(subject, body, PLAN_CHECK_IDLE_MS);
    return {
      next: () => {
        const first = pending;
        pending = null;
        return first ?? Promise.resolve(null);
      },
      close: () => undefined,
    };
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
