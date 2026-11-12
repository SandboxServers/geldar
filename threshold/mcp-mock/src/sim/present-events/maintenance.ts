import { definePresentHandler } from './types.ts';

/** A maintenance notice becomes one world line: its fixed sentence, already built by the mapper. */
export const maintenancePresenter = definePresentHandler('maintenance', (e, base) => [
  { ...base, type: 'day_night', text: e.text ?? '' },
]);
