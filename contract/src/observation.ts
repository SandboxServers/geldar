/**
 * Agent-visible sentences for an observation (AN-24, decisions 0343, 0391 and 0450). The actor is
 * named only when the agent could know who did it (`basis` present) and the name is a Minecraft
 * name with no marker word; otherwise the sentence says Someone. No id or UUID is ever shown.
 */

import { markedWords } from './agent-text.ts';

const ITEM = /^[a-z_]{1,64}$/;
const BLOCK = /^[a-z_]{1,64}$/;
const ACTOR_NAME = /^[A-Za-z0-9_]{3,16}$/;
const BASES = ['seen', 'spoke', 'signed'];

/** A count the gift schema accepts: an integer from 1 to 2304. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2304;
}

/** `an` before a vowel letter (an iron golem, an evoker), `a` otherwise (a creeper). */
function articleFor(noun: string): 'a' | 'an' {
  return /^[aeiou]/.test(noun) ? 'an' : 'a';
}

/** The actor fields the sentence reads: the name and how the agent could know it. */
export interface ObservationSentenceActor {
  name?: unknown;
  basis?: unknown;
}

/** The fields the sentence reads. Anything else in an observation is ignored here. */
export interface ObservationSentenceInput {
  kind: unknown;
  item?: unknown;
  count?: unknown;
  block?: unknown;
  target?: unknown;
  actor?: ObservationSentenceActor | null | undefined;
}

/** The generic sentence, also the fallback when a built sentence would carry a marker word. */
const GENERIC = 'Something happened.';

/** The subject used when the actor may not be named. */
const SOMEONE = 'Someone';

/** A life id as a name: `ag_` and a short handle, then a count of two or more digits. */
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;

/**
 * The actor's name the sentence and the player line may show: a Minecraft name with a valid basis,
 * no digit, no life-id shape and no marker word; else undefined. A non-object actor counts as absent.
 * Without a basis the actor is never named (decision 0450, item 1), and agents never see ids or
 * numbers beyond the count (decision 0450).
 */
export function observedActorName(actor: unknown): string | undefined {
  if (typeof actor !== 'object' || actor === null) return undefined;
  const { name, basis } = actor as ObservationSentenceActor;
  if (typeof name !== 'string' || typeof basis !== 'string') return undefined;
  if (!BASES.includes(basis) || !ACTOR_NAME.test(name)) return undefined;
  if (LIFE_ID.test(name) || /[0-9]/.test(name)) return undefined;
  return markedWords(name).length === 0 ? name : undefined;
}

/** One sentence per observation kind; anything unrecognised gives the generic sentence. */
export function observationSentence(input: ObservationSentenceInput): string {
  const who = observedActorName(input.actor) ?? SOMEONE;
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
    sentence = `${who} broke your ${input.block.replace(/_/g, ' ')}.`;
  } else if (
    input.kind === 'fight_seen' &&
    typeof input.target === 'string' &&
    BLOCK.test(input.target)
  ) {
    const mob = input.target.replace(/_/g, ' ');
    sentence = `${who} fought ${articleFor(mob)} ${mob} nearby.`;
  } else if (
    input.kind === 'container_taken' &&
    isCount(input.count) &&
    typeof input.item === 'string' &&
    ITEM.test(input.item)
  ) {
    sentence = `${who} took ${input.count} ${input.item.replace(/_/g, ' ')} from your container.`;
  }
  return markedWords(sentence).length > 0 ? GENERIC : sentence;
}
