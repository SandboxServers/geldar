// The supervisor's control transport (C7-03b1, decision 0152 item 3). It answers `geldar.<shard>.ctl.body.>`
// requests by calling the one handler in service.ts and replying to the request's inbox. Transport only: the
// policy stays in service.ts, and nothing here throws into the process.
import { ctlBodyWildcard } from '@geldar/contract';
import type { Supervisor } from './service.ts';

/** One request as the wire delivers it: the subject it was published to, the body bytes, and the inbox the reply goes to when there is one. */
export interface CtlMsg {
  subject: string;
  data: Uint8Array;
  reply?: string;
}

/** What the responder needs from a NATS connection: a stream of requests on a subject, and a way to answer one. */
export interface CtlWire {
  subscribe(subject: string): AsyncIterable<CtlMsg>;
  respond(inbox: string, data: Uint8Array): Promise<void>;
}

/** Counts of requests the responder did not answer through the handler. Fixed names only, no request content. */
export interface CtlStats {
  dropped: number;
  invalid: number;
  busy: number;
  handlerFailed: number;
  replyFailed: number;
  subscribeFailed: number;
}

/** Handler calls the responder runs at once. A request past this is answered `busy`, and the handler is not called. */
export const CTL_IN_FLIGHT_CAP = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Whether the subject is the one the body's op names: `geldar.<shard>.ctl.body.<op>` for the body's `op`. */
function subjectMatches(prefix: string, subject: string, request: unknown): boolean {
  const op =
    typeof request === 'object' && request !== null ? (request as { op?: unknown }).op : undefined;
  return typeof op === 'string' && subject === `${prefix}${op}`;
}

/** Answers one request. Never rejects: every failure is counted and, where it can be, answered. */
async function answer(
  wire: CtlWire,
  msg: CtlMsg,
  prefix: string,
  supervisor: Supervisor,
  stats: CtlStats,
): Promise<void> {
  // A request with no inbox has nowhere to go: drop it before the handler runs.
  if (!msg.reply) {
    stats.dropped++;
    return;
  }
  let reply: unknown;
  let request: unknown;
  try {
    request = JSON.parse(decoder.decode(msg.data));
  } catch {
    // Not audited: the handler takes a parsed request only, so a body that is not JSON never reaches it.
    stats.invalid++;
    reply = { ok: false, code: 'invalid' };
  }
  if (reply === undefined && !subjectMatches(prefix, msg.subject, request)) {
    stats.invalid++;
    reply = { ok: false, code: 'invalid' };
  }
  if (reply === undefined) {
    try {
      reply = await supervisor.handle(request);
    } catch {
      stats.handlerFailed++;
      reply = { ok: false, code: 'error' };
    }
  }
  try {
    await wire.respond(msg.reply, encoder.encode(JSON.stringify(reply)));
  } catch {
    // The connection closed mid-request: the owner's retry is answered by the handler's own idempotence.
    stats.replyFailed++;
  }
}

/** Answers a request the responder has no room for. The handler is not called. */
async function answerBusy(wire: CtlWire, inbox: string, stats: CtlStats): Promise<void> {
  stats.busy++;
  try {
    await wire.respond(inbox, encoder.encode(JSON.stringify({ ok: false, code: 'busy' })));
  } catch {
    stats.replyFailed++;
  }
}

/**
 * Serves the control subjects of one shard until the subscription ends. Each request is answered on its own,
 * so a slow start does not hold up a status query, up to CTL_IN_FLIGHT_CAP at once. A subscription that throws
 * is counted and ends the loop; the returned promise settles once every answer has settled, and never rejects.
 */
export async function serveCtl(opts: {
  wire: CtlWire;
  shard: string;
  supervisor: Supervisor;
  stats: CtlStats;
}): Promise<void> {
  const pending = new Set<Promise<void>>();
  const wildcard = ctlBodyWildcard(opts.shard);
  const prefix = wildcard.slice(0, -1);
  let inFlight = 0;
  try {
    for await (const msg of opts.wire.subscribe(wildcard)) {
      if (msg.reply && inFlight >= CTL_IN_FLIGHT_CAP) {
        const refusal: Promise<void> = answerBusy(opts.wire, msg.reply, opts.stats).finally(() =>
          pending.delete(refusal),
        );
        pending.add(refusal);
        continue;
      }
      inFlight++;
      const job: Promise<void> = answer(
        opts.wire,
        msg,
        prefix,
        opts.supervisor,
        opts.stats,
      ).finally(() => {
        inFlight--;
        pending.delete(job);
      });
      pending.add(job);
    }
  } catch {
    opts.stats.subscribeFailed++;
  }
  await Promise.all(pending);
}
