import { definePresentHandler } from './types.ts';

/** The fixed death line. `cause` is one of the mapper's phrases, never world text. */
export function deathText(cause: string | undefined): string {
  return `You died. ${cause ?? 'Something killed you'}. You wake at the spawn with nothing.`;
}

export const deathPresenter = definePresentHandler('death', (e, base) => [
  { ...base, type: 'death', text: deathText(e.cause) },
]);
