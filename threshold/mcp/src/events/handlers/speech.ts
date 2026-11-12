import { isAddressedLine } from '../speech.ts';
import { defineMindHandler } from './types.ts';

/** A heard line, addressed to the agent or overheard. The agent's own lines are no news. */
export const speechHandler = defineMindHandler('speech', (event, base, ctx) => {
  const p = event.payload;
  if (p.own) return [];
  const addressed = isAddressedLine(p.from, p.text, ctx.identity);
  return [{ ...base, kind: 'speech', addressed, from: p.from, text: p.text }];
});
