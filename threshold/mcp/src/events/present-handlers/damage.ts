import { definePresentHandler } from './types.ts';

/**
 * The line says what hit the player (the mapper's fixed sentence), never the amount. A damage event with
 * no amount says nothing.
 */
export const damagePresenter = definePresentHandler('damage', (e, base) => {
  if (typeof e.amount === 'number' && e.amount > 0) {
    const actor = e.actor !== undefined ? { actor: { name: e.actor } } : {};
    return [{ ...base, type: 'damage', text: e.cause ?? 'You were hurt.', ...actor }];
  }
  return [];
});
