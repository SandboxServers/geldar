import type { McpPlayerEvent } from '@geldar/contract';
import type { SimEvent } from '@geldar/mcp-mock';
import { actionFailedPresenter, actionPresenter } from './action.ts';
import { damagePresenter } from './damage.ts';
import { deathPresenter } from './death.ts';
import { heardSoundPresenter } from './heard-sound.ts';
import { intentPresenter } from './intent.ts';
import { reflexPresenter } from './reflex.ts';
import { speechPresenter } from './speech.ts';
import type { PresentCall, PresentHandler } from './types.ts';
import {
  agentApproachedPresenter,
  dayNightPresenter,
  proposalPresenter,
  wakePresenter,
} from './world-lines.ts';

/**
 * The presenters, tried in this order (deterministic). One sim event kind has one presenter. A new kind
 * adds one presenter file and one line at the END of this list (append only). A kind with no presenter
 * gives no player line.
 */
export const PRESENT_HANDLERS: readonly PresentHandler[] = [
  speechPresenter,
  damagePresenter,
  deathPresenter,
  agentApproachedPresenter,
  proposalPresenter,
  dayNightPresenter,
  intentPresenter,
  actionPresenter,
  actionFailedPresenter,
  reflexPresenter,
  wakePresenter,
  heardSoundPresenter,
];

/**
 * Presents `events` with `handlers`: each event takes the first handler of its kind, in event order.
 * The per-call state (overheard digest, reflex folding) lives in one `PresentCall` for the whole list.
 */
export function presentEvents(
  handlers: readonly PresentHandler[],
  events: SimEvent[],
): McpPlayerEvent[] {
  const overheard = events.filter((e) => e.kind === 'speech' && !e.addressed);
  const call: PresentCall = {
    overheard,
    lastOverheard: overheard[overheard.length - 1],
    lastReflex: null,
  };
  const out: McpPlayerEvent[] = [];
  for (const e of events) {
    const handler = handlers.find((h) => h.kind === e.kind);
    if (handler !== undefined) out.push(...handler.present(e, { seq: e.seq, tick: e.tick }, call));
  }
  return out;
}
