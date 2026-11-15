/**
 * The `heard_muffled` notices the plugin sends on `geldar.<shard>.body.<lifeId>.hearing` (MH-4, decision 0199
 * steps 6 and 8). The notice carries a direction (a compass point, `overhead` or `below`) and a band, and no
 * coordinates, speaker or words. Shape: contract/schemas/heard-muffled-event.schema.json.
 *
 * Collapse on arrival: the inbox holds one entry per direction code (ten at most), the nearest band heard in that
 * direction within the window. A far notice cannot push out a near one, because there is no list to fill.
 *
 * Window rule: an entry is visible in every snapshot for `MUFFLED_WINDOW_MS` after the arrival that set its band,
 * and no longer. Reading does not consume it: several threshold tools request a snapshot, and a notice must not
 * vanish inside a call that never shows it. A later arrival in the same direction at an equal or farther band does
 * not restart the clock; a nearer arrival replaces the entry and restarts it. `peek()` returns the visible entries
 * and drops the expired ones; nothing is acknowledged.
 *
 * Every payload is validated with `validateHeardMuffledPayload`, which rejects x, y, z, speaker, words and every
 * other key. A payload that is not JSON or fails the schema is refused; its content is never logged. Refusals,
 * stale drops and subscription errors share one log line at most every `DROP_LOG_INTERVAL_MS`, with running counts.
 * With no plugin deployed nothing arrives and the inbox stays empty. A subscription that cannot be made is logged
 * and the inbox stays empty; nothing throws.
 */
import {
  type HeardMuffledPayload,
  hearingSubject,
  validateHeardMuffledPayload,
} from '@geldar/contract';
import { BAND_ORDER, DIRECTION_ORDER } from './muffled.ts';

/** How long a notice stays visible in snapshots after the arrival that set its band, in milliseconds. */
export const MUFFLED_WINDOW_MS = 20_000;

/** The drop line (refusals, stale drops and subscription errors) is written at most once per this many milliseconds. */
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
    // A visible entry that already holds this band or a nearer one: the arrival changes nothing, the clock keeps running.
    if (
      kept !== undefined &&
      at - kept.at <= MUFFLED_WINDOW_MS &&
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
   * The notices visible now, nearest band first, then in direction order. Reading clears nothing: the same notice
   * is returned again until its window ends. Entries older than `MUFFLED_WINDOW_MS` are dropped first and counted
   * as stale.
   */
  peek(): HeardMuffledPayload[] {
    const now = this.now();
    for (const [direction, entry] of this.entries) {
      if (now - entry.at <= MUFFLED_WINDOW_MS) continue;
      this.entries.delete(direction);
      this.stale += 1;
      this.noteDrop();
    }
    return [...this.entries.values()]
      .sort(
        (a, b) =>
          bandRank(a.notice.band) - bandRank(b.notice.band) ||
          DIRECTION_ORDER.indexOf(a.notice.direction) - DIRECTION_ORDER.indexOf(b.notice.direction),
      )
      .map((entry) => ({ ...entry.notice }));
  }

  /** Logs a subscription error through the same limiter as the drops. The detail must carry no payload. */
  reportSubscriptionError(detail: string): void {
    this.noteDrop(`subscription error (${detail})`);
  }

  /** Payloads refused by validation or parsing since this inbox was made. */
  get refusedCount(): number {
    return this.refused;
  }

  /** Visible notices dropped because their window ended. */
  get staleCount(): number {
    return this.stale;
  }

  private refuse(): false {
    this.refused += 1;
    this.noteDrop();
    return false;
  }

  /** One line at most every `DROP_LOG_INTERVAL_MS`, with the running counts. Never a payload. */
  private noteDrop(what = 'dropped'): void {
    const now = this.now();
    if (this.lastDropLine !== undefined && now - this.lastDropLine < DROP_LOG_INTERVAL_MS) return;
    this.lastDropLine = now;
    this.log(
      `heard_muffled ${what}: refused ${this.refused}, stale ${this.stale} (running counts)`,
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
