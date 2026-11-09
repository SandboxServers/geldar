/** The wake policy (spec 5.3.2): pure and deterministic, no clock, no I/O, no model. */

export type WakeReason =
  | 'directly_addressed'
  | 'goal_completed'
  | 'precondition_failed'
  | 'unexpected_damage'
  | 'new_agent_nearby'
  | 'proposal'
  | 'day_night'
  | 'intent_run_too_long'
  | 'timeout';

export interface WakeEvent {
  seq: number;
  atMs: number;
  kind:
    | 'speech'
    | 'damage'
    | 'agent_approached'
    | 'proposal'
    | 'day_night'
    | 'intent_finished'
    | 'reflex';
  addressed?: boolean;
  distance?: number;
  outcome?: 'completed' | 'failed' | 'limit_reached';
  failure?: 'precondition_failed';
  /** The running intent's `wake_on` when the event happened; null if no intent was running. */
  wakeOn: string[] | null;
}

export interface WakeConfig {
  minSpacingMs: number;
  intentRunTooLongMs: number;
}

export interface SuppressedWake {
  seq: number;
  kind: string;
  reason: 'overheard_chatter' | 'not_in_wake_on' | 'not_in_interests' | 'min_spacing' | 'reflex';
  atMs: number;
}

export interface WakeDecision {
  wake: { reason: WakeReason; seqs: number[] } | null;
  suppressed: SuppressedWake[];
  recheckAtMs: number | null;
}

export interface WakeInput {
  events: WakeEvent[];
  intentStartedMs: number | null;
  interests: readonly string[];
  nowMs: number;
  lastWakeMs: number | null;
  config: WakeConfig;
  alreadySuppressed: ReadonlySet<number>;
}

/** Highest first. */
const PRIORITY: readonly WakeReason[] = [
  'directly_addressed',
  'precondition_failed',
  'goal_completed',
  'unexpected_damage',
  'intent_run_too_long',
  'new_agent_nearby',
  'proposal',
  'day_night',
];

interface Candidate {
  event: WakeEvent;
  reason: WakeReason;
}

function finishReason(e: WakeEvent): WakeReason {
  if (e.outcome === 'limit_reached') return 'intent_run_too_long';
  if (e.outcome === 'failed') return 'precondition_failed';
  return 'goal_completed';
}

/** Does the running intent's `wake_on` list let this event through? */
function passesWakeOn(e: WakeEvent): boolean {
  const wakeOn = e.wakeOn;
  if (wakeOn === null) return true;
  switch (e.kind) {
    case 'speech':
      return wakeOn.includes('directly_addressed');
    case 'damage':
      return wakeOn.includes('unexpected_damage');
    case 'agent_approached':
      return wakeOn.some((entry) => {
        const m = /^new_agent_within_(\d+)$/.exec(entry);
        return m !== null && e.distance !== undefined && e.distance <= Number(m[1]);
      });
    default:
      return false;
  }
}

function reasonOf(e: WakeEvent): WakeReason {
  switch (e.kind) {
    case 'speech':
      return 'directly_addressed';
    case 'damage':
      return 'unexpected_damage';
    case 'agent_approached':
      return 'new_agent_nearby';
    case 'proposal':
      return 'proposal';
    default:
      return 'day_night';
  }
}

const INTEREST_OF: Record<string, string> = {
  speech: 'directly_addressed',
  damage: 'damage',
  agent_approached: 'agent_approached',
  proposal: 'proposal',
  day_night: 'day_night',
};

/** Decides whether the agent wakes now, what was suppressed and when to look again. */
export function evaluateWake(i: WakeInput): WakeDecision {
  const suppressed: SuppressedWake[] = [];
  const note = (e: WakeEvent, reason: SuppressedWake['reason']): void => {
    if (!i.alreadySuppressed.has(e.seq))
      suppressed.push({ seq: e.seq, kind: e.kind, reason, atMs: e.atMs });
  };

  const survivors: Candidate[] = [];
  for (const e of i.events) {
    if (e.kind === 'reflex') {
      note(e, 'reflex');
    } else if (e.kind === 'speech' && e.addressed !== true) {
      note(e, 'overheard_chatter');
    } else if (e.kind === 'intent_finished') {
      survivors.push({ event: e, reason: finishReason(e) });
    } else if (!passesWakeOn(e)) {
      note(e, 'not_in_wake_on');
    } else if (!i.interests.includes(INTEREST_OF[e.kind] ?? '')) {
      note(e, 'not_in_interests');
    } else {
      survivors.push({ event: e, reason: reasonOf(e) });
    }
  }

  let recheckAtMs: number | null = null;
  if (survivors.length > 0) {
    const finished = survivors.some((c) => c.event.kind === 'intent_finished');
    if (i.lastWakeMs !== null && i.nowMs - i.lastWakeMs < i.config.minSpacingMs && !finished) {
      for (const c of survivors) note(c.event, 'min_spacing');
      recheckAtMs = i.lastWakeMs + i.config.minSpacingMs;
    } else {
      const reasons = new Set(survivors.map((c) => c.reason));
      const reason = PRIORITY.find((r) => reasons.has(r)) ?? 'timeout';
      return {
        wake: { reason, seqs: survivors.map((c) => c.event.seq) },
        suppressed,
        recheckAtMs: null,
      };
    }
  }

  if (i.intentStartedMs !== null) {
    const dueMs = Math.max(i.intentStartedMs, i.lastWakeMs ?? 0) + i.config.intentRunTooLongMs;
    if (i.nowMs >= dueMs) {
      return { wake: { reason: 'intent_run_too_long', seqs: [] }, suppressed, recheckAtMs: null };
    }
    recheckAtMs = recheckAtMs === null ? dueMs : Math.min(recheckAtMs, dueMs);
  }
  return { wake: null, suppressed, recheckAtMs };
}
