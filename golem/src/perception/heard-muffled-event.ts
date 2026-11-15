/**
 * The `heard_muffled` notices the plugin sends on `geldar.<shard>.body.<lifeId>.hearing` (MH-4, decision 0199
 * steps 6 and 8). The notice carries a direction (a compass point, `overhead` or `below`) and a band, and no
 * coordinates, speaker or words. Shape: contract/schemas/heard-muffled-event.schema.json.
 *
 * Collapse on arrival: the inbox holds one entry per direction code (ten at most), the nearest band heard in that
 * direction since the last take. A far notice cannot push out a near one, because there is no list to fill.
 *
 * Lifetime rule: an entry is renderable for `NOTICE_TTL_MS` after the arrival that set its band. A later arrival in
 * the same direction that is not nearer leaves the entry alone. An older entry is dropped the next time `peek()`
 * runs. `peek()` returns the renderable entries without clearing them; its `ack()` clears exactly the entries it
 * returned, so a notice that arrives between the peek and the ack is kept. `take()` is a peek followed by an ack.
 *
 * Every payload is validated with `validateHeardMuffledPayload`, which rejects x, y, z, speaker, words and every
 * other key. A payload that is not JSON or fails the schema is refused; its content is never logged. Refusals and
 * stale drops share one log line at most every `DROP_LOG_INTERVAL_MS`, with running counts. With no plugin deployed
 * nothing arrives and the inbox stays empty. A subscription that cannot be made is logged and the inbox stays empty;
 * nothing throws.
 */
import {
  type HeardMuffledPayload,
  hearingSubject,
  validateHeardMuffledPayload,
} from '@geldar/contract';
import { BAND_ORDER, DIRECTION_ORDER } from './muffled.ts';

/** How long a notice stays renderable after the arrival that set its band, in milliseconds. */
export const NOTICE_TTL_MS = 60_000;

/** The drop line (refusals and stale drops) is written at most once per this many milliseconds. */
export const DROP_LOG_INTERVAL_MS = 60_000;

/** The part of a NATS connection this module needs: a core subscribe with a callback, as the block owner client uses. */
export interface HearingTransport {
  subscribe(
    subject: string,
    opts: { callback: (err: unknown, msg: { data: Uint8Array }) => void },
  ): { unsubscribe(): void };
}

export interface HeardMuffledInboxOptions {
  /** Milliseconds, as `Date.now` returns them. Replaced in tests. */
  now?: () => number;
  /** Where the drop line goes. Absent: nothing is logged. */
  log?: (line: string) => void;
}

/** The notices a peek returned, and the ack that clears exactly those entries. */
export interface PeekedNotices {
  /** Renderable notices, nearest band first, then in direction order. */
  readonly notices: HeardMuffledPayload[];
  /** Clears the entries this peek returned. Idempotent. Entries that arrived since the peek are kept. */
  ack(): void;
}

interface Entry {
  notice: HeardMuffledPayload;
  at: number;
}

const bandRank = (band: string): number => BAND_ORDER.indexOf(band);

/** The muffled notices heard since the last take: one per direction, at its nearest band. */
export class HeardMuffledInbox {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private refused = 0;
  private stale = 0;
  private lastDropLine: number | undefined;

  constructor(options: HeardMuffledInboxOptions = {}) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
  }

  /** Validates one raw payload (already parsed) and keeps it when it passes. Returns whether it was accepted. */
  receive(raw: unknown): boolean {
    if (!validateHeardMuffledPayload(raw)) return this.refuse();
    const payload = raw as HeardMuffledPayload;
    const at = this.now();
    const kept = this.entries.get(payload.direction);
    // A renderable entry that already holds this band or a nearer one: the arrival changes nothing.
    if (
      kept !== undefined &&
      at - kept.at <= NOTICE_TTL_MS &&
      bandRank(payload.band) >= bandRank(kept.notice.band)
    ) {
      return true;
    }
    this.entries.set(payload.direction, {
      notice: { kind: payload.kind, direction: payload.direction, band: payload.band },
      at,
    });
    return true;
  }

  /** Receives one message body (UTF-8 JSON). Bytes that do not parse are refused like any invalid payload. */
  receiveBytes(data: Uint8Array): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(data));
    } catch {
      return this.refuse();
    }
    return this.receive(parsed);
  }

  /**
   * The renderable notices, without clearing them. Entries older than `NOTICE_TTL_MS` are dropped first and counted
   * as stale. The returned `ack()` clears exactly the entries returned here.
   */
  peek(): PeekedNotices {
    const now = this.now();
    for (const [direction, entry] of this.entries) {
      if (now - entry.at <= NOTICE_TTL_MS) continue;
      this.entries.delete(direction);
      this.stale += 1;
      this.noteDrop();
    }
    const taken = [...this.entries.values()].sort(
      (a, b) =>
        bandRank(a.notice.band) - bandRank(b.notice.band) ||
        DIRECTION_ORDER.indexOf(a.notice.direction) - DIRECTION_ORDER.indexOf(b.notice.direction),
    );
    let acked = false;
    return {
      notices: taken.map((entry) => ({ ...entry.notice })),
      ack: () => {
        if (acked) return;
        acked = true;
        for (const entry of taken) {
          if (this.entries.get(entry.notice.direction) === entry) {
            this.entries.delete(entry.notice.direction);
          }
        }
      },
    };
  }

  /** The notices renderable now, nearest first, and cleared. Empty when none are. */
  take(): HeardMuffledPayload[] {
    const peeked = this.peek();
    peeked.ack();
    return peeked.notices;
  }

  /** Payloads refused by validation or parsing since this inbox was made. */
  get refusedCount(): number {
    return this.refused;
  }

  /** Renderable notices dropped because they were older than `NOTICE_TTL_MS`. */
  get staleCount(): number {
    return this.stale;
  }

  private refuse(): false {
    this.refused += 1;
    this.noteDrop();
    return false;
  }

  /** One line at most every `DROP_LOG_INTERVAL_MS`, with the running counts. Never a payload. */
  private noteDrop(): void {
    const now = this.now();
    if (this.lastDropLine !== undefined && now - this.lastDropLine < DROP_LOG_INTERVAL_MS) return;
    this.lastDropLine = now;
    this.log(
      `heard_muffled dropped: refused ${this.refused}, stale ${this.stale} (running counts)`,
    );
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
  now?: () => number;
}): HeardMuffledWatch {
  const inbox = new HeardMuffledInbox({ now: options.now ?? Date.now, log: options.log });
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
        inbox.receiveBytes(msg.data);
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
