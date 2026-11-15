/**
 * The `heard_muffled` notices the plugin sends on `geldar.<shard>.body.<lifeId>.hearing` (MH-4, decision 0199
 * steps 6 and 8). The notice carries a direction (a compass point, `overhead` or `below`) and a band, and no
 * coordinates, speaker or words. Shape: contract/schemas/heard-muffled-event.schema.json.
 *
 * Lifetime rule (chosen here; the card left it open): a notice is kept from its arrival until the next `take()`,
 * which the snapshot calls once when it renders. `take()` returns the pending notices and clears them, so each
 * notice is rendered in at most one snapshot. The pending list holds at most `PENDING_LIMIT` notices; a notice
 * that arrives past that is dropped and counted, so a Body that never takes cannot grow without limit.
 *
 * Every payload is validated with `validateHeardMuffledPayload`, which rejects x, y, z, speaker, words and every
 * other key. A payload that is not JSON or fails the schema is dropped and counted; its content is never logged.
 * With no plugin deployed nothing arrives and the inbox stays empty. A subscription that cannot be made is logged
 * and the inbox stays empty; nothing throws.
 */
import {
  type HeardMuffledPayload,
  hearingSubject,
  validateHeardMuffledPayload,
} from '@geldar/contract';

/** Most notices held between two snapshots. */
export const PENDING_LIMIT = 64;

/** The part of a NATS connection this module needs: a core subscribe with a callback, as the block owner client uses. */
export interface HearingTransport {
  subscribe(
    subject: string,
    opts: { callback: (err: unknown, msg: { data: Uint8Array }) => void },
  ): { unsubscribe(): void };
}

/** The notices that arrived since the last `take()`, and a count of the payloads that were refused. */
export class HeardMuffledInbox {
  private pending: HeardMuffledPayload[] = [];
  private refused = 0;
  private overflowed = 0;

  /** Validates one raw payload (already parsed) and keeps it when it passes. Returns whether it was kept. */
  receive(raw: unknown): boolean {
    if (!validateHeardMuffledPayload(raw)) {
      this.refused += 1;
      return false;
    }
    if (this.pending.length >= PENDING_LIMIT) {
      this.overflowed += 1;
      return false;
    }
    const payload = raw as HeardMuffledPayload;
    this.pending.push({ kind: payload.kind, direction: payload.direction, band: payload.band });
    return true;
  }

  /** Receives one message body (UTF-8 JSON). Bytes that do not parse are refused like any invalid payload. */
  receiveBytes(data: Uint8Array): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(data));
    } catch {
      this.refused += 1;
      return false;
    }
    return this.receive(parsed);
  }

  /** The notices pending since the last take, oldest first. Clears them. Empty when none arrived. */
  take(): HeardMuffledPayload[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Payloads refused by validation or parsing since this inbox was made. */
  get refusedCount(): number {
    return this.refused;
  }

  /** Valid notices dropped because `PENDING_LIMIT` were already waiting. */
  get overflowCount(): number {
    return this.overflowed;
  }
}

export interface HeardMuffledWatch {
  inbox: HeardMuffledInbox;
  /** Stops receiving. Safe to call twice; a notice that arrives afterwards is not kept. */
  stop(): void;
}

/**
 * Subscribes the Body to its hearing subject and feeds every message into a new inbox. With no transport (the
 * Body has no NATS connection in this run) or when the subscribe fails, the inbox stays empty and the failure is
 * logged once; the call never throws.
 */
export function watchHeardMuffled(options: {
  transport: HearingTransport | undefined;
  shard: string;
  lifeId: string;
  log: (line: string) => void;
}): HeardMuffledWatch {
  const inbox = new HeardMuffledInbox();
  const noop: HeardMuffledWatch = { inbox, stop: () => undefined };
  if (options.transport === undefined) return noop;
  let subject: string;
  try {
    subject = hearingSubject(options.shard, options.lifeId);
  } catch (error) {
    options.log(`heard_muffled not subscribed: ${String(error)}`);
    return noop;
  }
  let closed = false;
  let subscription: { unsubscribe(): void } | undefined;
  try {
    subscription = options.transport.subscribe(subject, {
      callback: (err, msg) => {
        if (closed) return;
        if (err) {
          options.log(`heard_muffled subscription error: ${String(err)}`);
          return;
        }
        const before = inbox.refusedCount;
        inbox.receiveBytes(msg.data);
        if (inbox.refusedCount > before) options.log('heard_muffled refused: invalid payload');
      },
    });
  } catch (error) {
    options.log(`heard_muffled not subscribed: ${String(error)}`);
  }
  return {
    inbox,
    stop: () => {
      if (closed) return;
      closed = true;
      try {
        subscription?.unsubscribe();
      } catch (error) {
        options.log(`heard_muffled unsubscribe failed: ${String(error)}`);
      }
    },
  };
}
