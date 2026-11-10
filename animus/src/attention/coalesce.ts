/**
 * Coalescing (spec 5.3.2): overheard speech folds into a per-speaker digest, and the wake candidates
 * that arrive before a decision merge into one pending set.
 */
import type { DigestEntry, MindEvent } from '../ports/index.ts';
import { type CandidateReason, isAddressed, rankOf } from './policy.ts';

export type { DigestEntry };

/** How many lines per speaker the digest keeps. */
const DIGEST_LINES = 3;

/** The overheard chatter since the last decision, kept as a count and the last lines per speaker. */
export class ConversationDigest {
  private readonly lines = new Map<string, { count: number; events: MindEvent[] }>();

  /** Folds in one overheard line. */
  add(event: MindEvent & { type: 'speech' }): void {
    const speaker = event.payload.from;
    const entry = this.lines.get(speaker) ?? { count: 0, events: [] };
    entry.count += 1;
    entry.events.push(event);
    if (entry.events.length > DIGEST_LINES) entry.events.shift();
    this.lines.set(speaker, entry);
  }

  /** Whether nothing has been folded in. */
  get empty(): boolean {
    return this.lines.size === 0;
  }

  /** The digest as counts and lines, in the order the speakers first spoke. */
  summary(): DigestEntry[] {
    return [...this.lines].map(([speaker, e]) => ({
      speaker,
      count: e.count,
      lastLines: e.events.map((ev) => (ev.type === 'speech' ? ev.payload.text : '')),
    }));
  }

  /** The kept events, oldest first, and empties the digest. */
  take(): MindEvent[] {
    const events = [...this.lines.values()].flatMap((e) => e.events);
    this.lines.clear();
    return events.sort((a, b) => a.tick - b.tick);
  }

  /** Forgets everything (the agent died). */
  clear(): void {
    this.lines.clear();
  }
}

/** A wake that has been seen and not yet decided. */
export interface Candidate {
  reason: CandidateReason;
  /** The policy rank of the reason; lower wins. */
  rank: number;
  /** The intent it concerns, or null. */
  intentId: string | null;
  events: MindEvent[];
  /** Whether a deferral or hold of this candidate is already in the journal. */
  recorded: boolean;
}

/** The pending candidates of one life. */
export class PendingWakes {
  private items: Candidate[] = [];

  /**
   * Adds a candidate. When one with the same reason and intent is pending, the events merge into it
   * and the result says so (`merged`), so the caller can record the duplicate. The two addressed
   * reasons are one wake: a pending one of either kind takes the other's events.
   */
  add(
    reason: CandidateReason,
    intentId: string | null,
    events: MindEvent[],
  ): { candidate: Candidate; merged: boolean } {
    const same =
      this.items.find((c) => c.reason === reason && c.intentId === intentId) ??
      (isAddressed(reason) ? this.items.find((c) => isAddressed(c.reason)) : undefined);
    if (same) {
      same.events.push(...events);
      return { candidate: same, merged: true };
    }
    const candidate: Candidate = {
      reason,
      rank: rankOf(reason) ?? Number.MAX_SAFE_INTEGER,
      intentId,
      events: [...events],
      recorded: false,
    };
    this.items.push(candidate);
    return { candidate, merged: false };
  }

  get size(): number {
    return this.items.length;
  }

  /** Whether a candidate with this reason is pending. */
  has(reason: CandidateReason): boolean {
    return this.items.some((c) => c.reason === reason);
  }

  /** Drops the candidates with this reason (an idle candidate that is no longer true). */
  drop(reason: CandidateReason): void {
    this.items = this.items.filter((c) => c.reason !== reason);
  }

  /** Keeps only the candidates the predicate accepts; the rest are dropped without a record. */
  retain(keep: (c: Candidate) => boolean): void {
    this.items = this.items.filter(keep);
  }

  /** The pending candidates, most urgent first; arrival order breaks ties. */
  ranked(): Candidate[] {
    return [...this.items].sort((a, b) => a.rank - b.rank);
  }

  /** Empties the set and returns what was in it, in arrival order. */
  take(): Candidate[] {
    const all = this.items;
    this.items = [];
    return all;
  }
}
