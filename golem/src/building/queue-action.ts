import { failed } from '../actions/outcome.ts';
import type { ActionHandler } from '../actions/registry.ts';
import { BUILDING_REFUSAL } from './names.ts';

/** The plan verb handler. Refused with the neutral message while the flag is off; a stub throws when on. */
export function planHandler(enabled: boolean): ActionHandler<'plan'> {
  return {
    kind: 'plan',
    timeoutMs: 30_000,
    run: async (_ctx, _action) => {
      if (enabled) throw new Error('not_implemented: plan');
      return failed('not_possible', BUILDING_REFUSAL);
    },
  };
}

/** The handler as the registry holds it by default: the flag is off. */
export const planAction = planHandler(false);
