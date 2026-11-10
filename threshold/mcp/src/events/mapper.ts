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
    case 'death':
      return [{ ...base, kind: 'damage', amount: amountOf(event.payload) }];
    case 'sleep':
    case 'reflex_fired':
      return [{ ...base, kind: 'reflex' }];
    case 'intent': {
      const p = event.payload;
      if (p.state === 'accepted') {
        ctx.runs.set(event.lifeId, { wakeOn: p.wake_on ?? null, startedMs: base.atMs });
        return [];
      }
      if (!TERMINAL_STATES.has(p.state)) return [];
      ctx.runs.set(event.lifeId, { wakeOn: null, startedMs: null });
      return [
        {
          ...base,
          kind: 'intent_finished',
          outcome: p.state === 'completed' ? 'completed' : 'failed',
        },
      ];
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
      return mapWake(event.payload.reason, base, event.lifeId, ctx);
    default:
      return [];
  }
}

function mapWake(
  reason: string,
  base: { seq: number; tick: number; atMs: number; wakeOn: string[] | null },
  lifeId: string,
  ctx: MapContext,
): SimEvent[] {
  if (DAMAGE_WAKES.has(reason)) return [{ ...base, kind: 'damage', amount: 0 }];
  if (reason === 'no_plan') {
    ctx.runs.set(lifeId, { wakeOn: null, startedMs: null });
    return [{ ...base, kind: 'intent_finished', outcome: 'failed' }];
  }
  const near = NEW_AGENT.exec(reason);
  // An agent coming close is only news while a running intent lists it in wake_on.
  if (near !== null && base.wakeOn !== null) {
    return [{ ...base, kind: 'agent_approached', distance: Number(near[1]) }];
  }
  return [];
}

function amountOf(payload: Record<string, unknown>): number {
  const amount = payload.amount;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
}
