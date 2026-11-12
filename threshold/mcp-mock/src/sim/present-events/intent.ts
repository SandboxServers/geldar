import { definePresentHandler } from './types.ts';

function intentText(outcome: string | undefined): string {
  if (outcome === 'failed') return 'Your intent failed: precondition_failed.';
  if (outcome === 'limit_reached') return 'Your intent ran out of time.';
  return 'Your intent finished.';
}

export const intentPresenter = definePresentHandler('intent_finished', (e, base) => [
  { ...base, type: 'intent_finished', text: intentText(e.outcome) },
]);
