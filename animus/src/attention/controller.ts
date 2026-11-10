/**
 * The attention controller of one life (spec 5.3.2, decision 0047). It turns the event stream into
 * wake decisions: it classifies speech, coalesces, orders by priority, holds a wake while a thought
 * is in flight, spaces wakes at least `min_wakeup_spacing_s` apart (deferring, never dropping), fires
 * a fallback wake for an intent that runs too long unthought, and records every suppression.
 */
import type {
  AttentionController,
  Journal,
  MindEvent,
  ReflectionDue,
  SuppressionReason,
  ThoughtOutcome,
  WakeDecision,
} from '../ports/index.ts';
import { type CommitmentLookup, classifySpeech, type SpeechIdentity } from './classify.ts';
import { type Candidate, ConversationDigest, type DigestEntry, PendingWakes } from './coalesce.ts';
import {
  type CandidateReason,
  isAddressed,
  isFiller,
  isSpacingExempt,
  priorityOf,
  rankOf,
} from './policy.ts';
import { type Clock, type Scheduler, systemTiming } from './timing.ts';

/** What the controller needs to know about one life. */
export interface AttentionOptions {
  lifeId: string;
  /** The names the agent answers to. */
  identity: SpeechIdentity;
  /** The `attention` block of the config. */
  config: { minWakeupSpacingS: number; fallbackWakeupTicks: number; overheardToDigest: boolean };
  /** World ticks per second (the shard's `tick_rate`); turns the fallback ticks into time. */
  tickRate: number;
  /** Where suppressions are recorded. */
  journal: Journal;
  /** Whether a speaker is a counterparty in an open commitment; false for everyone when absent. */
  isCounterparty?: CommitmentLookup;
  clock?: Clock;
  scheduler?: Scheduler;
  /**
   * How long to wait, after an intent ends, for the Body's own wake before deciding there was none
   * (the Body publishes the intent state first and the wake just after). Default 250 ms.
   */
  idleSettleMs?: number;
  /**
   * With no intent running and no thought in flight, the Mind is woken as `idle` after this long
   * (after a hold or a say-only thought nothing else would wake it). Default 60 s.
   */
  idleWatchdogMs?: number;
}

/** The terminal intent states. */
const ENDED = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** The attention controller (P0-27). */
export class Attention implements AttentionController {
  private readonly decisions = new Set<(d: WakeDecision) => void>();
  private readonly reflections = new Set<(d: ReflectionDue) => void>();
  private readonly pending = new PendingWakes();
  private readonly digest = new ConversationDigest();
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly isCounterparty: CommitmentLookup;
  private readonly idleSettleMs: number;
  private readonly idleWatchdogMs: number;
  private readonly wokenIntents = new Set<string>();
  private inFlight = false;
  private lastWakeMs: number | null = null;
  /** The newest tick an addressed wake has been decided on; a later copy of it is a duplicate. */
  private lastAddressedTick: number | null = null;
  private activeIntent: string | null = null;
  /** The agent died: this life's controller stays quiet, so no idle watchdog is armed again. */
  private ended = false;
  private cancelSpacing: (() => void) | null = null;
  private cancelFallback: (() => void) | null = null;
  private cancelIdle: (() => void) | null = null;
  private readonly cancelSettle = new Set<() => void>();

  private readonly options: AttentionOptions;

  constructor(options: AttentionOptions) {
    this.options = options;
    this.clock = options.clock ?? systemTiming.clock;
    this.scheduler = options.scheduler ?? systemTiming.scheduler;
    this.isCounterparty = options.isCounterparty ?? (() => false);
    this.idleSettleMs = options.idleSettleMs ?? 250;
    this.idleWatchdogMs = options.idleWatchdogMs ?? 60_000;
  }

  onDecision(callback: (decision: WakeDecision) => void): () => void {
    this.decisions.add(callback);
    return () => this.decisions.delete(callback);
  }

  onReflectionDue(callback: (due: ReflectionDue) => void): () => void {
    this.reflections.add(callback);
    return () => this.reflections.delete(callback);
  }

  /** The conversation digest as counts and last lines per speaker, for the prompt builder. */
  digestSummary(): DigestEntry[] {
    return this.digest.summary();
  }

  /** The Mind has started: its first wake (`mind_start`, exempt from the spacing). */
  start(): void {
    this.addCandidate('mind_start', null, []);
    this.evaluate();
  }

  thoughtStarted(): void {
    this.inFlight = true;
    this.disarmFallback();
    this.disarmIdle();
  }

  thoughtSettled(_outcome: ThoughtOutcome): void {
    this.inFlight = false;
    // Idle and fallback wakes were for a thought that has now happened; they are stale.
    this.pending.retain((c) => !isFiller(c.reason));
    for (const c of this.pending.ranked()) c.recorded = false;
    if (this.activeIntent !== null) this.armFallback(this.activeIntent);
    this.evaluate();
    if (!this.inFlight && this.activeIntent === null) this.armIdle();
  }

  /** Stops every timer; a stopped controller emits nothing more. */
  stop(): void {
    this.cancelSpacing?.();
    this.cancelSpacing = null;
    this.disarmFallback();
    this.disarmIdle();
    for (const cancel of this.cancelSettle) cancel();
    this.cancelSettle.clear();
  }

  onEvent(event: MindEvent): void {
    try {
      if (event.lifeId !== this.options.lifeId) return;
      this.handle(event);
    } catch {
      // The port promises that onEvent never throws; a bad event is dropped.
    }
  }

  private handle(event: MindEvent): void {
    switch (event.type) {
      case 'death':
        this.clearState();
        return;
      case 'sleep':
        this.emitReflection({ lifeId: event.lifeId, day: event.day, event });
        return;
      case 'speech':
        this.handleSpeech(event);
        return;
      case 'wake':
        this.handleWake(event);
        return;
      case 'intent':
        this.handleIntent(event);
        return;
      default:
        // Actions, plan results, reflexes and damage reach the Mind through the Body's own wakes.
        return;
    }
  }

  private handleSpeech(event: MindEvent & { type: 'speech' }): void {
    if (event.payload.own) return;
    const { from, text } = event.payload;
    const kind = classifySpeech(from, text, this.options.identity, this.isCounterparty);
    if (kind === 'overheard') {
      if (this.options.config.overheardToDigest) this.digest.add(event);
      this.record([event.type], 'digested', this.activeIntent);
      return;
    }
    const reason: CandidateReason =
      kind === 'addressed'
        ? 'speech_addressed'
        : kind === 'about_me'
          ? 'speech_about_me'
          : 'speech_about_my_commitments';
    this.addCandidate(reason, this.activeIntent, [event]);
    this.evaluate();
  }

  private handleWake(event: MindEvent & { type: 'wake' }): void {
    const { reason, intent_id: intentId } = event.payload;
    if (intentId !== null) {
      if (this.wokenIntents.size >= 64) this.wokenIntents.clear();
      this.wokenIntents.add(intentId);
    }
    if (rankOf(reason) === null) {
      // The contract schema admits only the Body's listed reasons, so this is a Body newer than
      // the Mind: it cannot be ranked, so the intent carries on and the wake is only recorded.
      this.record(['wake'], 'intent_running', intentId);
      return;
    }
    this.addCandidate(reason as CandidateReason, intentId, [event]);
    this.evaluate();
  }

  private handleIntent(event: MindEvent & { type: 'intent' }): void {
    const { intent_id: id, state } = event.payload;
    if (ENDED.has(state)) {
      if (this.activeIntent === id) {
        this.activeIntent = null;
        this.disarmFallback();
      }
      this.settleIdle(id, event);
      return;
    }
    if (this.activeIntent !== id) {
      this.activeIntent = id;
      this.disarmIdle();
      this.armFallback(id);
    }
  }

  /** With nothing running and no thought in flight, wake `idle` after the watchdog period. */
  private armIdle(): void {
    this.disarmIdle();
    if (this.ended) return;
    this.cancelIdle = this.scheduler.after(this.idleWatchdogMs, () => {
      this.cancelIdle = null;
      if (this.inFlight || this.activeIntent !== null) return;
      this.addCandidate('idle', null, []);
      this.evaluate();
    });
  }

  private disarmIdle(): void {
    this.cancelIdle?.();
    this.cancelIdle = null;
  }

  /** After the settle window, an ended intent with no Body wake and no successor means `idle`. */
  private settleIdle(intentId: string, event: MindEvent): void {
    const cancel = this.scheduler.after(this.idleSettleMs, () => {
      this.cancelSettle.delete(cancel);
      if (this.wokenIntents.has(intentId) || this.activeIntent !== null) return;
      this.addCandidate('idle', intentId, [event]);
      this.evaluate();
    });
    this.cancelSettle.add(cancel);
  }

  private armFallback(intentId: string): void {
    this.disarmFallback();
    const ms = (this.options.config.fallbackWakeupTicks * 1000) / this.options.tickRate;
    this.cancelFallback = this.scheduler.after(ms, () => {
      this.cancelFallback = null;
      if (this.activeIntent !== intentId) return;
      this.addCandidate('fallback', intentId, []);
      this.evaluate();
    });
  }

  private disarmFallback(): void {
    this.cancelFallback?.();
    this.cancelFallback = null;
  }

  private addCandidate(
    reason: CandidateReason,
    intentId: string | null,
    events: MindEvent[],
  ): void {
    // The other copy of an addressed line that a thought has already been woken for: no second thought.
    if (isAddressed(reason) && this.lastAddressedTick !== null) {
      if (events.length > 0 && events.every((e) => e.tick <= (this.lastAddressedTick ?? -1))) {
        this.record(
          [...new Set(events.map((e) => e.type))],
          'duplicate',
          intentId ?? this.activeIntent,
        );
        return;
      }
    }
    const { candidate, merged } = this.pending.add(reason, intentId, events);
    if (merged) this.recordCandidate(candidate, 'duplicate');
  }

  /** Decides what to do with the pending set: emit, hold behind a thought, or defer for spacing. */
  private evaluate(): void {
    if (this.pending.size === 0) return;
    const ranked = this.pending.ranked();
    if (this.inFlight) {
      for (const c of ranked) if (!c.recorded) this.recordCandidate(c, 'coalesced_in_flight', true);
      return;
    }
    const spacingMs = this.options.config.minWakeupSpacingS * 1000;
    const now = this.clock.nowMs();
    const exempt = ranked.some((c) => isSpacingExempt(c.reason));
    if (!exempt && this.lastWakeMs !== null && now < this.lastWakeMs + spacingMs) {
      for (const c of ranked) if (!c.recorded) this.recordCandidate(c, 'min_spacing', true);
      this.cancelSpacing ??= this.scheduler.after(this.lastWakeMs + spacingMs - now, () => {
        this.cancelSpacing = null;
        this.evaluate();
      });
      return;
    }
    this.emit(ranked[0]);
  }

  private emit(best: Candidate | undefined): void {
    if (!best) return;
    const all = this.pending.take();
    const seen = new Set<string>();
    const events = all
      .flatMap((c) => c.events)
      .filter((e) => !seen.has(e.eventId) && seen.add(e.eventId))
      .sort((a, b) => a.tick - b.tick);
    const decision: WakeDecision = {
      reason: best.reason,
      events,
      digestSummary: this.digest.summary(),
      digest: this.digest.take(),
      priority: priorityOf(best.rank),
    };
    this.lastWakeMs = this.clock.nowMs();
    if (isAddressed(best.reason)) {
      this.lastAddressedTick = Math.max(...events.map((e) => e.tick));
    }
    this.inFlight = true;
    this.cancelSpacing?.();
    this.cancelSpacing = null;
    this.disarmFallback();
    this.disarmIdle();
    for (const callback of [...this.decisions]) {
      try {
        callback(decision);
      } catch {
        // A failing subscriber must not stop the others or the controller.
      }
    }
  }

  private emitReflection(due: ReflectionDue): void {
    for (const callback of [...this.reflections]) {
      try {
        callback(due);
      } catch {
        // As above.
      }
    }
  }

  /** A death clears everything the old life was waiting on. */
  private clearState(): void {
    this.ended = true;
    this.pending.take();
    this.digest.clear();
    this.activeIntent = null;
    this.lastAddressedTick = null;
    this.wokenIntents.clear();
    this.stop();
  }

  private recordCandidate(c: Candidate, reason: SuppressionReason, mark = false): void {
    if (mark) c.recorded = true;
    const types = [...new Set(c.events.map((e) => e.type))];
    this.record(types, reason, c.intentId ?? this.activeIntent);
  }

  private record(eventTypes: string[], reason: SuppressionReason, intentId: string | null): void {
    const at = new Date(this.clock.nowMs()).toISOString();
    this.options.journal
      .recordSuppressed({ lifeId: this.options.lifeId, at, eventTypes, reason, intentId })
      .catch(() => {
        // A journal failure must not stop attention; the suppression is lost, the Mind carries on.
      });
  }
}
