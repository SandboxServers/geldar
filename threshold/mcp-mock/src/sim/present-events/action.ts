import type { McpPlayerEvent } from '@geldar/contract';
import { playerOutcomeText } from '@geldar/contract';
import type { SimEvent } from '../events.ts';
import type { PresentBase, SimEventOf } from './types.ts';
import { definePresentHandler } from './types.ts';

function actionLine(
  e: SimEventOf<'action' | 'action_failed'>,
  base: PresentBase,
): McpPlayerEvent[] {
  return [
    {
      ...base,
      type: e.kind,
      text: playerOutcomeText({
        verb: e.name,
        ok: e.kind === 'action',
        reason: e.reason,
        intent: e.intent,
      }),
    },
  ];
}

export const actionPresenter = definePresentHandler('action', actionLine);
export const actionFailedPresenter = definePresentHandler('action_failed', actionLine);
