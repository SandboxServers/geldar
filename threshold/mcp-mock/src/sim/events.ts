import type { WakeEvent } from './wake.ts';

/** One thing that happened to the player: a wake event plus what later tools need to rebuild it. */
export interface SimEvent extends WakeEvent {
  /** The game tick at which it happened. */
  tick: number;
  /** For speech: who spoke. */
  from?: string;
  /** For speech: who was addressed, or null for everyone. */
  to?: string | null;
  /** The neighbour's words (speech) or rule (proposal). Never copied into a `McpPlayerEvent`. */
  text?: string;
  /** For damage: how much. */
  amount?: number;
  /** For agent_approached: who came; for reflex: the item eaten. */
  name?: string;
  /** For proposal: the proposal id. */
  id?: string;
  /** For action and action_failed: true when the event is for an intent (a program), not an action. */
  intent?: boolean;
  /** For plan_result: the thought it answers. Internal: no player-facing view shows it. */
  thought_id?: string;
  /** For plan_result: whether the thought's say text was spoken. Internal, as thought_id. */
  said?: boolean;
}

/** How many events the log keeps. */
const CAPACITY = 1000;

/** The per-player event log: the last 1000 events, numbered from 1. */
export class EventLog {
  private events: SimEvent[] = [];
  private next = 1;

  /** Stores the event under the next seq and returns it. The oldest event drops out past 1000. */
  append(e: Omit<SimEvent, 'seq'>): SimEvent {
    const stored: SimEvent = { ...e, seq: this.next++ };
    this.events.push(stored);
    if (this.events.length > CAPACITY) this.events.shift();
    return stored;
  }

  /** The seq of the newest event, 0 when none was ever appended. */
  lastSeq(): number {
    return this.next - 1;
  }

  /** The seq of the oldest retained event; the seq the next event will get when the log is empty. */
  firstSeq(): number {
    return this.events[0]?.seq ?? this.next;
  }

  /**
   * The events with a seq greater than `seq`, without consuming them. `dropped` counts the events
   * after `seq` that already left the log.
   */
  since(seq: number): { events: SimEvent[]; dropped: number } {
    const dropped = Math.max(0, this.firstSeq() - 1 - Math.max(0, seq));
    return { events: this.events.filter((e) => e.seq > seq), dropped };
  }
}

/** The opaque cursor for a seq: `c_<seq>`. */
export function encodeCursor(seq: number): string {
  return `c_${seq}`;
}

/** The seq inside a cursor, or null if the text is not `c_` plus 1 to 12 digits. */
export function decodeCursor(cursor: string): number | null {
  return /^c_[0-9]{1,12}$/.test(cursor) ? Number(cursor.slice(2)) : null;
}
