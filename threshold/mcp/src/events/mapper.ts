import type { SpeechIdentity } from '@geldar/animus/src/attention/classify.ts';
import type { MindEvent } from '@geldar/animus/src/ports/body.ts';
import type { SimEvent } from '@geldar/mcp-mock';
import { isAddressedLine } from './speech.ts';

/** What the mapper remembers about a life's running intent between events. */
export interface RunState {
  /** The running intent's `wake_on`, or null when none runs or it names none. */
  wakeOn: string[] | null;
  /** When the running intent was accepted, in epoch milliseconds, or null. */
  startedMs: number | null;
  /**
   * The id of the last intent this life saw end. The Body follows an intent's end with a wake for the
   * same intent; that wake is no second end. Undefined until an intent ends.
   */
  lastEndedId?: string | undefined;
}

/** The per-life state the mapper reads and writes. */
export interface MapContext {
  /** Who the agent is, for classifying the speech it hears. */
  identity: SpeechIdentity;
  /** The running intent per life, keyed by life id. */
  runs: Map<string, RunState>;
}

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const NEW_AGENT = /^new_agent_within_(\d+)$/;
const DAMAGE_WAKES = new Set(['unexpected_damage', 'reflex_danger']);
/** The Body's detail for an intent that reached its limits (the intent event's detail is plain text). */
const LIMIT_DETAIL = /^max_(world_ticks|block_operations)\b/;

/**
 * Maps one Mind event to the player-facing events it becomes (spec 5.15.3, the mapping table).
 * Returns none for events the player does not see. `seq` is the stream sequence of the message.
 * Only fixed fields are copied: no event carries the text of the Body's detail or world text.
 */
export function mapMindEvent(event: MindEvent, seq: number, ctx: MapContext): SimEvent[] {
  const atMs = Date.parse(event.at);
  const run = ctx.runs.get(event.lifeId) ?? { wakeOn: null, startedMs: null };
  const base = { seq, tick: event.tick, atMs: Number.isNaN(atMs) ? 0 : atMs, wakeOn: run.wakeOn };
  switch (event.type) {
    case 'speech': {
      const p = event.payload;
      if (p.own) return [];
      const addressed = isAddressedLine(p.from, p.text, ctx.identity);
      return [{ ...base, kind: 'speech', addressed, from: p.from, text: p.text }];
    }
    case 'damage':
      return [{ ...base, kind: 'damage', amount: amountOf(event.payload) }];
    case 'death':
      return [{ ...base, kind: 'death', cause: deathCause(event.payload.cause) }];
    case 'reflex_fired': {
      // The only reflex entry the player hears is "Your body ate on its own", so only a reflex that
      // really ate is one. Every other reflex firing, and any eat that failed or was abandoned,
      // is the Body's own business and is not a news item (the first live run heard it falsely).
      const p = event.payload as { name?: unknown; result?: unknown };
      return p.name === 'eat' && p.result === 'handled' ? [{ ...base, kind: 'reflex' }] : [];
    }
    case 'sleep':
      // A plugin sleep is no meal either: the wake and day entries already tell the player.
      return [];
    case 'intent': {
      const p = event.payload;
      if (p.state === 'accepted') {
        ctx.runs.set(event.lifeId, {
          wakeOn: p.wake_on ?? null,
          startedMs: base.atMs,
          lastEndedId: run.lastEndedId,
        });
        return [];
      }
      if (!TERMINAL_STATES.has(p.state)) return [];
      const repeat = run.lastEndedId !== undefined && run.lastEndedId === p.intent_id;
      ctx.runs.set(event.lifeId, { wakeOn: null, startedMs: null, lastEndedId: p.intent_id });
      if (repeat) return [];
      const outcome = endOutcome(p.state, p.detail);
      const reason = outcome === 'failed' ? failureReason(p.detail) : undefined;
      return [{ ...base, kind: 'intent_finished', outcome, ...(reason ? { reason } : {}) }];
    }
    case 'plan_result': {
      // The internal entry is what `say` reads for its confirmation. No player view shows it.
      const p = event.payload;
      const internal: SimEvent = {
        ...base,
        kind: 'plan_result',
        thought_id: p.thought_id,
        said: p.said,
      };
      if (p.intent !== 'none' || p.actions.length === 0) return [internal];
      return [
        internal,
        {
          ...base,
          kind: 'intent_finished',
          outcome: p.failed_at === null ? 'completed' : 'failed',
        },
      ];
    }
    case 'wake':
      return mapWake(
        event.payload.reason,
        event.payload.intent_id ?? null,
        base,
        event.lifeId,
        ctx,
      );
    default:
      return [];
  }
}

/**
 * The player's outcome of an intent that ended in `state`. The contract's wake reasons are the only
 * ends the player can be woken with: a limit ends the run as intent_run_too_long, any other failure as
 * precondition_failed. The contract has no reason for a cancelled or interrupted intent, so both wake as
 * a failure: the agent still hears that its intent is over.
 */
function endOutcome(
  state: string,
  detail: string | undefined,
): 'completed' | 'failed' | 'limit_reached' {
  if (state === 'completed') return 'completed';
  if (state === 'failed' && LIMIT_DETAIL.test(detail ?? '')) return 'limit_reached';
  return 'failed';
}

/** Item names the Body's detail lists: lowercase words only, so nothing else gets through. */
const ITEM_LIST = /^[a-z_]+(?:, [a-z_]+){0,7}$/;

/**
 * A plain world fact for why an intent failed, rebuilt from the Body's detail with fixed templates
 * (decision 0068: no system words, no free text). Only item names that pass `ITEM_LIST` are quoted.
 * Undefined when the detail is not one of the known shapes: the player then hears the bare failure.
 */
export function failureReason(detail: string | undefined): string | undefined {
  const text = detail ?? '';
  const missing = /^missing_materials: missing (.+)$/.exec(text);
  if (missing?.[1] && ITEM_LIST.test(missing[1])) {
    return `you lack ${missing[1].replaceAll('_', ' ')}`;
  }
  if (text.startsWith('missing_station')) return 'no crafting table within reach';
  if (text.startsWith('blocked: no movement')) return 'you could not move and may be stuck';
  if (text.startsWith('blocked: unstick')) return 'no way out was found without risking a fall';
  if (text.startsWith('blocked')) return 'the way was blocked';
  if (text.startsWith('not_found: no bed')) return 'no bed within reach';
  if (text.startsWith('not_possible: would drop the bot')) {
    return 'that would drop you from where you stand';
  }
  if (text.startsWith('not_found')) return 'what you looked for was not found';
  if (text.startsWith('not_possible')) return 'that was not possible right now';
  if (text.startsWith('out_of_reach') || text.startsWith('too_far')) {
    return 'too far from the block';
  }
  return undefined;
}

function mapWake(
  reason: string,
  intentId: string | null,
  base: { seq: number; tick: number; atMs: number; wakeOn: string[] | null },
  lifeId: string,
  ctx: MapContext,
): SimEvent[] {
  if (DAMAGE_WAKES.has(reason)) return [{ ...base, kind: 'damage', amount: 0 }];
  // A restarted Body with nothing to resume: the player never had an intent, so no intent ended.
  if (reason === 'no_plan' && intentId === null) return [{ ...base, kind: 'wake' }];
  if (reason === 'no_plan') {
    ctx.runs.set(lifeId, { wakeOn: null, startedMs: null });
    return [{ ...base, kind: 'intent_finished', outcome: 'failed' }];
  }
  if (reason === 'limit_reached') {
    // The intent's own terminal event normally reported this end: the same intent is no second end.
    const run = ctx.runs.get(lifeId);
    if (intentId !== null && run?.lastEndedId === intentId) return [];
    ctx.runs.set(lifeId, { wakeOn: null, startedMs: null, lastEndedId: intentId ?? undefined });
    return [{ ...base, kind: 'intent_finished', outcome: 'limit_reached' }];
  }
  const near = NEW_AGENT.exec(reason);
  // An agent coming close is only news while a running intent lists it in wake_on.
  if (near !== null && base.wakeOn !== null) {
    return [{ ...base, kind: 'agent_approached', distance: Number(near[1]) }];
  }
  return [];
}

/** Bukkit damage causes, as the plugin exports them, to fixed phrases. Anything else is the last entry. */
const DEATH_CAUSES: Readonly<Record<string, string>> = {
  ENTITY_ATTACK: 'Something struck you down',
  ENTITY_SWEEP_ATTACK: 'Something struck you down',
  PROJECTILE: 'Something shot you',
  FALL: 'You fell too far',
  DROWNING: 'You drowned',
  STARVATION: 'You starved',
  FIRE: 'You burned',
  FIRE_TICK: 'You burned',
  LAVA: 'You fell into lava',
  SUFFOCATION: 'You suffocated',
  VOID: 'You fell out of the world',
  ENTITY_EXPLOSION: 'Something exploded beside you',
  BLOCK_EXPLOSION: 'Something exploded beside you',
  POISON: 'You were poisoned',
  MAGIC: 'You were poisoned',
  WITHER: 'You withered away',
  FREEZE: 'You froze',
};
const UNKNOWN_DEATH = 'Something killed you';

/** The fixed phrase for a plugin death cause; the raw value is never copied through. */
export function deathCause(cause: unknown): string {
  return (typeof cause === 'string' ? DEATH_CAUSES[cause] : undefined) ?? UNKNOWN_DEATH;
}

function amountOf(payload: Record<string, unknown>): number {
  const amount = payload.amount;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
}
