import { definePresentHandler } from './types.ts';

export const agentApproachedPresenter = definePresentHandler('agent_approached', (e, base) => [
  { ...base, type: 'agent_approached', text: `Someone came within ${e.distance ?? 0} blocks.` },
]);

export const proposalPresenter = definePresentHandler('proposal', (_e, base) => [
  { ...base, type: 'proposal', text: 'A proposal was put forward.' },
]);

export const dayNightPresenter = definePresentHandler('day_night', (e, base) => [
  { ...base, type: 'day_night', text: e.name === 'dusk' ? 'Dusk.' : 'Dawn.' },
]);

export const wakePresenter = definePresentHandler('wake', (_e, base) => [
  { ...base, type: 'wake', text: 'You wake with nothing underway.' },
]);
