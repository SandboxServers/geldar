// The register's side of body control (C7-03b1, decision 0152 item 3): one request to
// `geldar.<shard>.ctl.body.<op>` and the parsed reply. Every failure to get an answer is BodyUnavailable;
// C7-04 maps it to HTTP 503 with `{"error":"body_unavailable"}`. The route itself is not in this card.
import { ctlBodySubject } from '@geldar/contract';

/** The request side of a NATS connection: one request, answered or rejected (timeout, no responders, closed). */
export interface CtlConnection {
  request(
    subject: string,
    data: Uint8Array,
    opts: { timeout: number },
  ): Promise<{ data: Uint8Array }>;
}

/** The body could not be reached: a timeout, no responders, or a disconnect during the request. */
export class BodyUnavailable extends Error {
  constructor() {
    super('body_unavailable');
    this.name = 'BodyUnavailable';
  }
}

/** The reply arrived but is not a supervisor reply. Distinct from BodyUnavailable on purpose. */
export class MalformedReply extends Error {
  constructor() {
    super('malformed_reply');
    this.name = 'MalformedReply';
  }
}

export interface CtlReply {
  ok: boolean;
  code: string;
}

function parseReply(data: Uint8Array): CtlReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new MalformedReply();
  }
  const r = parsed as { ok?: unknown; code?: unknown } | null;
  if (
    typeof r !== 'object' ||
    r === null ||
    typeof r.ok !== 'boolean' ||
    typeof r.code !== 'string'
  )
    throw new MalformedReply();
  return r as CtlReply;
}

/**
 * Sends `body` (JSON, with its `op`, `ownerId` and `playerName`) to the control subject of `op` and returns the
 * parsed reply. A timer bounds the wait and is cleared on every path, so a disconnect leaves no pending timer.
 */
export async function requestBodyOp(
  conn: CtlConnection,
  op: string,
  shard: string,
  body: unknown,
  { timeoutMs }: { timeoutMs: number },
): Promise<CtlReply> {
  // The contract builder rejects a bad shard or op before anything is sent.
  const subject = ctlBodySubject(shard, op);
  const data = new TextEncoder().encode(JSON.stringify(body));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BodyUnavailable()), timeoutMs);
  });
  let msg: { data: Uint8Array };
  try {
    msg = await Promise.race([conn.request(subject, data, { timeout: timeoutMs }), timeout]);
  } catch {
    throw new BodyUnavailable();
  } finally {
    clearTimeout(timer);
  }
  return parseReply(msg.data);
}

/** The HTTP answer for a body that could not be reached (C7-04 uses it). Null for any other error. */
export function bodyUnavailableResponse(
  error: unknown,
): { status: 503; body: { error: 'body_unavailable' } } | null {
  return error instanceof BodyUnavailable
    ? { status: 503, body: { error: 'body_unavailable' } }
    : null;
}
