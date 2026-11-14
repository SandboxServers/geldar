// The helper's NATS listener (C7-03c1). It answers the four exact subjects `geldar.<shard>.helper.body.<verb>`
// (the `helper` user's Sub, 0260) by calling the one handler in service.ts, and replies on the request's inbox.
// Transport only: the policy stays in service.ts. Nothing here throws into the process, and each refusal has a
// fixed reason string. The request body is never logged.
import type { RequestHandler } from './service.ts';

/** The verbs the helper serves: one subject each. Nothing else is subscribed. */
export const HELPER_VERBS = ['start', 'stop', 'status', 'logtail'] as const;
/** The largest request body the listener reads. A verb request is a few dozen bytes. */
export const HELPER_REQUEST_MAX_BYTES = 1024;
/** Handler calls the listener runs at once. A request past this is answered `busy` and the handler is not called. */
export const HELPER_IN_FLIGHT_CAP = 4;

export const REASON_TOO_LARGE = 'request too large';
export const REASON_MALFORMED = 'malformed json';
export const REASON_SUBJECT = 'verb does not match subject';
export const REASON_BUSY = 'busy';

/** The four exact subjects for one shard. */
export function helperSubjects(shard: string): string[] {
  return HELPER_VERBS.map((verb) => `geldar.${shard}.helper.body.${verb}`);
}

export interface HelperMsg {
  subject: string;
  data: Uint8Array;
  reply?: string;
}

/** What the listener needs from a NATS connection: a stream of requests on one subject, and a way to answer. */
export interface HelperWire {
  subscribe(subject: string): AsyncIterable<HelperMsg>;
  respond(inbox: string, data: Uint8Array): Promise<void>;
}

/** Counts of requests the listener did not answer through the handler. Fixed names only, no request content. */
export interface HelperStats {
  dropped: number;
  tooLarge: number;
  malformed: number;
  subjectMismatch: number;
  busy: number;
  handlerFailed: number;
  replyFailed: number;
}

export function newHelperStats(): HelperStats {
  return {
    dropped: 0,
    tooLarge: 0,
    malformed: 0,
    subjectMismatch: 0,
    busy: 0,
    handlerFailed: 0,
    replyFailed: 0,
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function refusal(error: string): { ok: false; code: 'refused'; error: string } {
  return { ok: false, code: 'refused', error };
}

async function reply(wire: HelperWire, inbox: string, body: unknown, stats: HelperStats) {
  try {
    await wire.respond(inbox, encoder.encode(JSON.stringify(body)));
  } catch {
    // The connection closed mid-request: the caller's retry is a fresh request.
    stats.replyFailed++;
  }
}

/** Answers one request. Never rejects: every failure is counted and, where it can be, answered. */
async function answer(
  wire: HelperWire,
  msg: HelperMsg,
  prefix: string,
  handle: RequestHandler,
  stats: HelperStats,
): Promise<void> {
  // A request with no inbox has nowhere to go: drop it before anything runs.
  if (!msg.reply) {
    stats.dropped++;
    return;
  }
  const inbox = msg.reply;
  if (msg.data.byteLength > HELPER_REQUEST_MAX_BYTES) {
    stats.tooLarge++;
    return reply(wire, inbox, refusal(REASON_TOO_LARGE), stats);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(msg.data)) as unknown;
  } catch {
    stats.malformed++;
    return reply(wire, inbox, refusal(REASON_MALFORMED), stats);
  }
  const verb =
    typeof parsed === 'object' && parsed !== null ? (parsed as { verb?: unknown }).verb : undefined;
  if (typeof verb !== 'string' || msg.subject !== `${prefix}${verb}`) {
    stats.subjectMismatch++;
    return reply(wire, inbox, refusal(REASON_SUBJECT), stats);
  }
  let result: unknown;
  try {
    result = await handle(parsed);
  } catch {
    stats.handlerFailed++;
    result = { ok: false, code: 'failed', error: 'helper error' };
  }
  return reply(wire, inbox, result, stats);
}

/**
 * Serves the four helper subjects of one shard until the subscriptions end. Each request is answered on its own,
 * up to HELPER_IN_FLIGHT_CAP at once; the request past that is answered `busy`. The returned promise settles
 * once every answer has settled, and never rejects.
 */
export async function serveHelper(opts: {
  wire: HelperWire;
  shard: string;
  handle: RequestHandler;
  stats: HelperStats;
}): Promise<void> {
  const pending = new Set<Promise<void>>();
  let inFlight = 0;
  const prefix = `geldar.${opts.shard}.helper.body.`;
  const serveSubject = async (subject: string) => {
    try {
      for await (const msg of opts.wire.subscribe(subject)) {
        if (inFlight >= HELPER_IN_FLIGHT_CAP) {
          opts.stats.busy++;
          if (msg.reply) {
            const refused: Promise<void> = reply(
              opts.wire,
              msg.reply,
              refusal(REASON_BUSY),
              opts.stats,
            ).finally(() => pending.delete(refused));
            pending.add(refused);
          }
          continue;
        }
        inFlight++;
        const job: Promise<void> = answer(opts.wire, msg, prefix, opts.handle, opts.stats).finally(
          () => {
            inFlight--;
            pending.delete(job);
          },
        );
        pending.add(job);
      }
    } catch {
      // A subscription that throws ends its own loop; the others keep serving.
      opts.stats.dropped++;
    }
  };
  await Promise.all(helperSubjects(opts.shard).map(serveSubject));
  await Promise.all([...pending]);
}
