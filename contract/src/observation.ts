/**
 * Agent-visible sentences for an observation (AN-24, decisions 0343 and 0391). Approval of the
 * wording does not activate any observations. The sentence never reads the actor's name.
 */

import { markedWords } from './agent-text.ts';

const ITEM = /^[a-z_]{1,64}$/;
const BLOCK = /^[a-z_]{1,64}$/;

/** A count the gift schema accepts: an integer from 1 to 2304. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2304;
}

/** `an` before a vowel sound's spelling (an iron golem, an evoker), `a` otherwise (a creeper). */
function articleFor(noun: string): 'a' | 'an' {
  return /^[aeiou]/.test(noun) ? 'an' : 'a';
}

/** The fields the sentence reads. Anything else in an observation is ignored here. */
export interface ObservationSentenceInput {
  kind: unknown;
  item?: unknown;
  count?: unknown;
  block?: unknown;
  target?: unknown;
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
    sentence = `Someone broke your ${input.block.replace(/_/g, ' ')}.`;
  } else if (
    input.kind === 'fight_seen' &&
    typeof input.target === 'string' &&
    BLOCK.test(input.target)
  ) {
    const mob = input.target.replace(/_/g, ' ');
    sentence = `Someone fought ${articleFor(mob)} ${mob} nearby.`;
  } else if (
    input.kind === 'container_taken' &&
    isCount(input.count) &&
    typeof input.item === 'string' &&
    ITEM.test(input.item)
  ) {
    sentence = `Someone took ${input.count} ${input.item.replace(/_/g, ' ')} from your container.`;
  }
  return markedWords(sentence).length > 0 ? GENERIC : sentence;
}
