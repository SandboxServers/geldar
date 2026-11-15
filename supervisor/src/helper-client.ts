// The supervisor's body runtime over the host body helper (C7-03c3, decision 0260). The supervisor holds no Docker
// socket: it sends the helper's verbs as NATS requests on `geldar.<shard>.helper.body.<verb>`, with the verb, the
// roster name and the owner, and nothing else. The helper checks the roster, the global cap and the name.
//
// Deadline: each request is bounded here by `timeoutMs` (default 20 s). The helper's own run deadline is 120 s, so
// a reply that comes after this bound is dropped (the request has already settled) and the caller gets the
// `timeout` kind. No request is retried: one attempt is one request, and the register's retry is the next attempt.
// A timed-out start leaves no row, so it does not count; the helper may still land it (its own 120 s deadline
// removes what it made), so the register's retry must read `status` first.
//
// No responders, a closed connection or an unreadable reply is the `unavailable` or `failed` kind. Every kind
// carries a fixed message: the raw error text never reaches the register.
export const HELPER_TIMEOUT_MS = 20_000;

// The helper's stable refusal strings (body-helper/src/service.ts: ALREADY_RUNNING, OTHER_OWNER_BODY and
// NOT_YOUR_BODY). They are matched here and nowhere else; the raw text is never copied out of this module.
export const HELPER_REFUSAL_TEXT = {
  alreadyRunning: 'already running',
  otherOwnerBody: "name in use by another owner's body",
  notYourBody: 'not your body',
} as const;

/** Which of the helper's named refusals a `refused` reply carried, or null for any other refusal. */
export type HelperReason = 'already_running' | 'other_owner_body' | 'not_your_body' | null;

/** A body as the helper reports it: the owner the helper holds for it (its label), the name, and whether it runs. */
export interface HelperBody {
  ownerId: string;
  playerName: string;
  running: boolean;
}

/** The body runtime the service uses: the helper's verbs, every call carrying the owner and the roster name. */
export interface HelperRuntime {
  inspect(ownerId: string, playerName: string): Promise<HelperBody | null>;
  start(spec: { ownerId: string; playerName: string }): Promise<void>;
  stop(ownerId: string, playerName: string): Promise<void>;
}

export type HelperFailureKind =
  | 'refused'
  | 'not_running'
  | 'capacity'
  | 'timeout'
  | 'unavailable'
  | 'failed';

/**
 * A helper refusal or failure. Callers switch on `kind`; the message is fixed text. `reason` tells a `refused`
 * apart by the helper's stable string (see HELPER_REFUSAL_TEXT); every other refusal has reason null.
 */
export class HelperFailure extends Error {
  readonly kind: HelperFailureKind;
  readonly reason: HelperReason;
  constructor(kind: HelperFailureKind, reason: HelperReason = null) {
    super(`body helper ${kind}`);
    this.name = 'HelperFailure';
    this.kind = kind;
    this.reason = reason;
  }
}

/** Sends one NATS request and resolves with the reply bytes. Rejects when nothing answers or the link fails. */
export type HelperRequest = (subject: string, payload: Uint8Array) => Promise<Uint8Array>;

export interface HelperClientOptions {
  shard: string;
  request: HelperRequest;
  timeoutMs?: number;
}

interface HelperReply {
  ok?: unknown;
  code?: unknown;
  error?: unknown;
  state?: unknown;
  owner?: unknown;
}

// The helper's named refusal for a reply's error text, or null. Any other text is never inspected further.
function reasonOf(text: unknown): HelperReason {
  if (text === HELPER_REFUSAL_TEXT.alreadyRunning) return 'already_running';
  if (text === HELPER_REFUSAL_TEXT.otherOwnerBody) return 'other_owner_body';
  if (text === HELPER_REFUSAL_TEXT.notYourBody) return 'not_your_body';
  return null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The helper's reply codes, mapped to the kinds the service understands. Any other code is `failed`.
const KINDS = new Map<string, HelperFailureKind>([
  ['refused', 'refused'],
  ['not_running', 'not_running'],
  ['capacity', 'capacity'],
  ['timeout', 'timeout'],
  ['failed', 'failed'],
]);

async function call(
  opts: HelperClientOptions,
  verb: 'start' | 'stop' | 'status',
  owner: string,
  name: string,
): Promise<HelperReply> {
  const timeoutMs = opts.timeoutMs ?? HELPER_TIMEOUT_MS;
  const subject = `geldar.${opts.shard}.helper.body.${verb}`;
  const payload = encoder.encode(JSON.stringify({ verb, name, owner }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HelperFailure('timeout')), timeoutMs);
  });
  let bytes: Uint8Array;
  try {
    bytes = await Promise.race([opts.request(subject, payload), deadline]);
  } catch (error) {
    if (error instanceof HelperFailure) throw error;
    // No responders, a closed connection: the body helper is not reachable. The raw error is dropped.
    throw new HelperFailure('unavailable');
  } finally {
    clearTimeout(timer);
  }
  let reply: HelperReply;
  try {
    reply = JSON.parse(decoder.decode(bytes)) as HelperReply;
  } catch {
    throw new HelperFailure('failed');
  }
  if (typeof reply !== 'object' || reply === null) throw new HelperFailure('failed');
  if (reply.ok === true) return reply;
  const kind = typeof reply.code === 'string' ? KINDS.get(reply.code) : undefined;
  throw new HelperFailure(kind ?? 'failed', reasonOf(reply.error));
}

/**
 * True when a NATS request failed on its own timeout. The pinned @nats-io/nats-core names that error class
 * `TimeoutError` (lib/errors.js); the match is exact, so another error whose name only contains "timeout" is not one.
 */
export function isNatsTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/** The part of a NATS connection the helper request uses. */
export interface NatsRequester {
  request(
    subject: string,
    data: Uint8Array,
    opts: { timeout: number },
  ): Promise<{ data: Uint8Array }>;
}

/**
 * The HelperRequest over a NATS connection. The library timeout is passed as a backstop; call() races its own
 * deadline, so the caller sees the `timeout` kind either way. A library TimeoutError becomes `timeout` here; any
 * other rejection is rethrown unchanged, and call() maps it to `unavailable`.
 */
export function natsHelperRequest(
  nc: NatsRequester,
  timeoutMs: number = HELPER_TIMEOUT_MS,
): HelperRequest {
  return async (subject, payload) => {
    try {
      const reply = await nc.request(subject, payload, { timeout: timeoutMs });
      return reply.data;
    } catch (error) {
      if (isNatsTimeout(error)) throw new HelperFailure('timeout');
      throw error;
    }
  };
}

/**
 * The body runtime served by the body helper. The owner is sent with every verb: the helper refuses a name
 * the roster does not give that owner (`refused`), which the service reports as `unknown`.
 */
export function createHelperRuntime(opts: HelperClientOptions): HelperRuntime {
  return {
    async inspect(ownerId: string, playerName: string): Promise<HelperBody | null> {
      const reply = await call(opts, 'status', ownerId, playerName);
      if (reply.state === 'absent') return null;
      // The owner is the label owner the helper holds, not the caller: the service checks it against the caller.
      if (typeof reply.owner !== 'string') throw new HelperFailure('failed');
      if (reply.state !== 'running' && reply.state !== 'stopped') throw new HelperFailure('failed');
      return { ownerId: reply.owner, playerName, running: reply.state === 'running' };
    },
    async start(spec: { ownerId: string; playerName: string }): Promise<void> {
      await call(opts, 'start', spec.ownerId, spec.playerName);
    },
    async stop(ownerId: string, playerName: string): Promise<void> {
      try {
        await call(opts, 'stop', ownerId, playerName);
      } catch (error) {
        // Nothing to stop is the state the caller wanted.
        if (error instanceof HelperFailure && error.kind === 'not_running') return;
        throw error;
      }
    },
  };
}
