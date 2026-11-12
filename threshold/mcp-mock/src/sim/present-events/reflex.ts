import { definePresentHandler } from './types.ts';

/** The mock's reflex line is one fixed sentence; the threshold names the reflex. */
export const reflexPresenter = definePresentHandler('reflex', (_e, base) => [
  { ...base, type: 'reflex', text: 'Your body ate on its own.' },
]);
