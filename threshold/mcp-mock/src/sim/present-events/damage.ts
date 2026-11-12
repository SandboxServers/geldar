import { definePresentHandler } from './types.ts';

export const damagePresenter = definePresentHandler('damage', (e, base) => [
  { ...base, type: 'damage', text: e.cause ?? 'You were hurt.' },
]);
