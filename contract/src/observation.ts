/**
 * Agent-visible sentences for an observation (AN-24, decision 0343). Proposed: the wording is
 * unapproved (OD-E) and only AN-28a calls this, after AN-28b and AN-28c are switched on. The
 * sentence never reads an actor, so a name never reaches the agent through it.
 */

import { markedWords } from './agent-text.ts';

const ITEM = /^[a-z_]{1,64}$/;
const BLOCK = /^[a-z_]{1,64}$/;

/** A count the gift schema accepts: an integer from 1 to 2304. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2304;
}

/** The fields the sentence reads. Anything else in an observation is ignored here. */
export interface ObservationSentenceInput {
  kind: unknown;
  item?: unknown;
  count?: unknown;
  block?: unknown;
}

/** The generic sentence, also the fallback when a built sentence would carry a marker word. */
const GENERIC = 'Something happened.';

/** One sentence per observation kind; anything unrecognised gives the generic sentence. */
export function observationSentence(input: ObservationSentenceInput): string {
  let sentence = GENERIC;
  if (
    input.kind === 'gift_received' &&
    isCount(input.count) &&
    typeof input.item === 'string' &&
    ITEM.test(input.item)
  ) {
    sentence = `You received ${input.count} ${input.item.replace(/_/g, ' ')}.`;
  } else if (
    input.kind === 'property_broken' &&
    typeof input.block === 'string' &&
    BLOCK.test(input.block)
  ) {
    sentence = `Someone broke one of your blocks (${input.block.replace(/_/g, ' ')}).`;
  }
  return markedWords(sentence).length > 0 ? GENERIC : sentence;
}
