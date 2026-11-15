/**
 * The `heard_muffled` notices the plugin sends on `geldar.<shard>.body.<lifeId>.hearing` (MH-4, decision 0199
 * steps 6 and 8). The notice carries a direction (a compass point, `overhead` or `below`) and a band, and no
 * coordinates, speaker or words. Shape: contract/schemas/heard-muffled-event.schema.json.
 *
 * Collapse on arrival: the inbox holds one entry per direction code (ten at most), the nearest band heard in that
 * direction within the window. A far notice cannot push out a near one, because there is no list to fill.
 *
 * Window rule: an entry is visible in every snapshot for `MUFFLED_WINDOW_MS` after the arrival that last set or
 * refreshed it, and the edge itself is visible. An arrival in a direction is judged against the entry still
 * visible at that moment:
 *   - a NEARER band replaces the entry and restarts the clock;
 *   - an EQUAL band keeps the band and restarts the clock, so a continuing voice stays visible;
 *   - a FARTHER band changes nothing: neither the band nor the clock.
 * An arrival after the entry's window has ended just sets a new entry. Reading does not consume it: several
 * threshold tools request a snapshot, and a notice must not vanish inside a call that never shows it. `peek()`
 * returns the visible entries and drops the expired ones without a log line or a count; nothing is acknowledged.
 *
 * Every payload is validated with `validateHeardMuffledPayload`, which rejects x, y, z, speaker, words and every
 * other key. A payload that is not JSON or fails the schema is refused; its content is never logged. Refusals share
 * one log line at most every `DROP_LOG_INTERVAL_MS`, with a running count. A subscription error is logged on each
 * call, outside that limiter, with its detail capped and stripped of newlines. With no plugin deployed nothing
 * arrives and the inbox stays empty. A subscription that cannot be made is logged and the inbox stays empty;
 * nothing throws.
 */
import {
  type HeardMuffledPayload,
  hearingSubject,
  validateHeardMuffledPayload,
} from '@geldar/contract';
import { BAND_ORDER, DIRECTION_ORDER } from './muffled.ts';

/** How long a notice stays visible in snapshots after the arrival that last set or refreshed it, in milliseconds. */
export const MUFFLED_WINDOW_MS = 20_000;

/** The refusal line is written at most once per this many milliseconds. */
export const DROP_LOG_INTERVAL_MS = 60_000;

/** The longest subscription error detail written to the log. */
const SUBSCRIPTION_DETAIL_MAX = 200;

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
  /** Where the log lines go. Absent: nothing is logged. */
  log?: (line: string) => void;
}

interface Entry {
  notice: HeardMuffledPayload;
  at: number;
}

const bandRank = (band: string): number => BAND_ORDER.indexOf(band);

/** The muffled notices heard within the window: one per direction, at its nearest band. */
export class HeardMuffledInbox {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private refused = 0;
  private lastRefusalLine: number | undefined;

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
    // A farther band than the visible entry changes nothing. Nearer or equal replaces it and restarts the clock.
    if (
      kept !== undefined &&
      at - kept.at <= MUFFLED_WINDOW_MS &&
      bandRank(payload.band) > bandRank(kept.notice.band)
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
   * The notices visible now, nearest band first, then in direction order. Reading clears nothing: the same notice
   * is returned again until its window ends. Entries older than `MUFFLED_WINDOW_MS` are dropped first, silently.
   */
  peek(): HeardMuffledPayload[] {
    const now = this.now();
    for (const [direction, entry] of this.entries) {
      if (now - entry.at > MUFFLED_WINDOW_MS) this.entries.delete(direction);
    }
    return [...this.entries.values()]
      .sort(
        (a, b) =>
          bandRank(a.notice.band) - bandRank(b.notice.band) ||
          DIRECTION_ORDER.indexOf(a.notice.direction) - DIRECTION_ORDER.indexOf(b.notice.direction),
      )
      .map((entry) => ({ ...entry.notice }));
  }

  /** Logs a subscription error: one line per call, outside the refusal limiter, with no counts. */
  reportSubscriptionError(detail: string): void {
    const text = detail.replace(/[\r\n]/g, '').slice(0, SUBSCRIPTION_DETAIL_MAX);
    this.log(`heard_muffled subscription error: ${text}`);
  }

  /** Payloads refused by validation or parsing since this inbox was made. */
  get refusedCount(): number {
    return this.refused;
  }

  private refuse(): false {
    this.refused += 1;
    this.noteRefusal();
    return false;
  }

  /** One refusal line at most every `DROP_LOG_INTERVAL_MS`, with the running count. Never a payload. */
  private noteRefusal(): void {
    const now = this.now();
    if (this.lastRefusalLine !== undefined && now - this.lastRefusalLine < DROP_LOG_INTERVAL_MS)
      return;
    this.lastRefusalLine = now;
    this.log(`heard_muffled dropped: refused ${this.refused} (running count)`);
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
          inbox.reportSubscriptionError(String(err));
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
