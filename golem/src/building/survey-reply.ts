// The Body's answer to a `survey` request (BLD-38e). The contract box (two corners, `from` and `to`)
// becomes the seen map's inclusive box, and the map's survey is the reply: `{ text, truncated }` and
// nothing else. Pure: the NATS responder that serves it waits for the survey subject in the contract.
import { validateToolInput } from '@geldar/contract';
import type { SurveyBox, SurveyReply } from './seen/survey.ts';

/** One corner of the contract box, in block coordinates. */
interface Corner {
  x: number;
  y: number;
  z: number;
}

/** The seen-map read the responder asks: the wiring's `survey`. */
export interface SurveyAsk {
  survey(box: SurveyBox, nowTick: number): SurveyReply;
}

/**
 * The Mind-link server's `survey` option for a Body whose seen wiring exists (the building flag is on):
 * each request is answered from that map at the tick `now` returns.
 */
export function surveyFrom(seen: SurveyAsk, now: () => number): (request: unknown) => unknown {
  return (request) => answerSurvey(seen, request, now(), true);
}

/** The survey reply, or a refusal: the building flag is off, or the request is outside the contract. */
export type SurveyAnswer = SurveyReply | { error: 'invalid_input' | 'not_available' };

/** The inclusive box that two corners span, whichever order they came in. */
function boxOf(from: Corner, to: Corner): SurveyBox {
  return {
    min: { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) },
    max: { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) },
  };
}

/**
 * Answers a survey request from the life's seen map at `nowTick`. `building` is the shard's
 * body_actions.building flag: off, every request is `not_available` and the map is not asked. `layers`
 * counts y-layers upward from the box's lower y (the box's max y is clamped to that). Never throws.
 */
export function answerSurvey(
  seen: SurveyAsk,
  request: unknown,
  nowTick: number,
  building: boolean,
): SurveyAnswer {
  if (!building) return { error: 'not_available' };
  if (!validateToolInput('survey', request).ok) return { error: 'invalid_input' };
  const { box, layers } = request as { box: { from: Corner; to: Corner }; layers?: number };
  const bounds = boxOf(box.from, box.to);
  if (layers !== undefined) bounds.max.y = Math.min(bounds.max.y, bounds.min.y + layers - 1);
  const reply = seen.survey(bounds, nowTick);
  return { text: reply.text, truncated: reply.truncated };
}
