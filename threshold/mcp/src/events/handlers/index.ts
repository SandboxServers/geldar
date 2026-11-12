import { actionOutcomeHandler } from './action-outcome.ts';
import { damageHandler } from './damage.ts';
import { deathHandler } from './death.ts';
import { intentHandler } from './intent.ts';
import { planResultHandler } from './plan-result.ts';
import { reflexFiredHandler } from './reflex-fired.ts';
import { speechHandler } from './speech.ts';
import type { MindHandler } from './types.ts';
import { wakeHandler } from './wake.ts';

/**
 * The Mind event handlers, tried in this order (deterministic). One Mind event type has one handler.
 * A new event type adds one handler file and one line at the END of this list (append only). A Mind
 * event type with no handler maps to no player events, as the old switch's default did.
 */
export const MIND_HANDLERS: readonly MindHandler[] = [
  speechHandler,
  damageHandler,
  deathHandler,
  reflexFiredHandler,
  intentHandler,
  planResultHandler,
  actionOutcomeHandler,
  wakeHandler,
];
