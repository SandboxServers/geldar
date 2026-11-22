import { BUILDING_REFUSAL } from '../building/names.ts';
import { failed } from './outcome.ts';
import type { ActionHandler } from './registry.ts';

/** The break verb handler. Refused with the neutral message while the flag is off; a stub throws when on. */
export function breakHandler(enabled: boolean): ActionHandler<'break'> {
  return {
    kind: 'break',
    timeoutMs: 30_000,
    run: async (_ctx, _action) => {
      if (enabled) throw new Error('not_implemented: break');
      return failed('not_possible', BUILDING_REFUSAL);
    },
  };
}

/** The handler as the registry holds it by default: the flag is off. */
export const breakAction = breakHandler(false);
