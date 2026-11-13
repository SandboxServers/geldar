// The supervisor's control transport (C7-03b1, decision 0152 item 3). It answers `geldar.<shard>.ctl.body.>`
// requests by calling the one handler in service.ts and replying to the request's inbox. Transport only: the
// policy stays in service.ts, and nothing here throws into the process.
import { ctlBodyWildcard } from '@geldar/contract';
import type { Supervisor } from './service.ts';

/** One request as the wire delivers it: the body bytes, and the inbox the reply goes to when there is one. */
export interface CtlMsg {
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
  handlerFailed: number;
  replyFailed: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Answers one request. Never rejects: every failure is counted and, where it can be, answered. */
async function answer(
  wire: CtlWire,
  msg: CtlMsg,
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

/**
 * Serves the control subjects of one shard until the subscription ends. Each request is answered on its own,
 * so a slow start does not hold up a status query. The returned promise settles once every answer has settled.
 */
export async function serveCtl(opts: {
  wire: CtlWire;
  shard: string;
  supervisor: Supervisor;
  stats: CtlStats;
}): Promise<void> {
  const pending = new Set<Promise<void>>();
  for await (const msg of opts.wire.subscribe(ctlBodyWildcard(opts.shard))) {
    const job: Promise<void> = answer(opts.wire, msg, opts.supervisor, opts.stats).finally(() =>
      pending.delete(job),
    );
    pending.add(job);
  }
  await Promise.all(pending);
}
