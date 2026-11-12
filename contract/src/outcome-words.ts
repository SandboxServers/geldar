/**
 * Fixed wording for action outcome events (C5-02 outcome events, Proposed). The Body builds the
 * `message` and `why` of an `action_outcome` payload with these, and the MCP server rebuilds the
 * player's text from the verb and reason code alone, so nothing the world or an agent wrote is ever
 * quoted. Every function returns fixed text; an unknown reason or verb falls back to a generic line.
 */

/** Plain-words clause for each action failure reason code. */
const REASON_PHRASE: Readonly<Record<string, string>> = {
  invalid_args: 'that was not asked for in a way the body could use',
  timeout: 'it took too long',
  blocked: 'the way was blocked',
  not_found: 'what you looked for was not found',
  out_of_reach: 'it was out of reach',
  missing_materials: 'you lack the materials',
  missing_station: 'there is no crafting table within reach',
  not_possible: 'that was not possible right now',
  interrupted: 'something interrupted it',
  unsupported: 'the body cannot do that',
  busy: 'another action is still running; wait for it to finish before you send the next one',
  no_effect: 'it changed nothing',
  internal: 'something went wrong inside the body',
};

/** Intent failure wording, keyed by program then reason. Programs without an entry use the reason phrase. */
const INTENT_WHY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  travel: {
    blocked: 'You could not get there: the way was blocked.',
    not_found: 'You could not get there: the place was not found.',
    timeout: 'You could not get there in time.',
  },
  gather: {
    not_found: 'You found none of what you wanted to gather nearby.',
    blocked: 'You could not reach what you wanted to gather.',
    out_of_reach: 'What you wanted to gather was out of reach.',
  },
  craft: {
    missing_materials: 'You lack the materials to craft that.',
    missing_station: 'There is no crafting table within reach.',
    not_found: 'You do not know how to craft that.',
    not_possible: 'You cannot make that right now.',
    blocked: 'The way to the furnace was blocked.',
  },
  rest: {
    not_found: 'There is no bed within reach to rest in.',
    not_possible: 'You cannot rest right now.',
    blocked: 'The way to the bed was blocked.',
  },
  flee: {
    blocked: 'You could not run: the way was blocked.',
    not_possible: 'There was nowhere safe to run.',
  },
  build: {
    missing_materials: 'You lack the blocks to finish the build.',
    not_possible: 'That build was not possible where you stand.',
    blocked: 'The build site was blocked.',
  },
  follow: {
    not_found: 'The one you were following is out of sight.',
    blocked: 'You lost the one you were following: the way was blocked.',
  },
};

/** The reason codes the schema allows. */
export const OUTCOME_REASONS: readonly string[] = Object.keys(REASON_PHRASE);

/** Whether `reason` is a code the outcome event may carry. */
export function isOutcomeReason(reason: unknown): reason is string {
  return typeof reason === 'string' && Object.hasOwn(REASON_PHRASE, reason);
}

/** The event's `message` for an action that ended: 'Your <verb> failed: <reason>.' or 'Your <verb> worked.'. */
export function outcomeMessage(verb: string, ok: boolean, reason?: string): string {
  const name = verb.replaceAll('_', ' ');
  if (ok) return `Your ${name} worked.`;
  const phrase = isOutcomeReason(reason) ? REASON_PHRASE[reason] : 'it did not complete';
  return `Your ${name} failed: ${phrase}.`;
}

/** The plain-words `why` of an intent that failed, a fixed template keyed by program and reason. */
export function intentWhy(program: string, reason: string | undefined): string {
  const own = isOutcomeReason(reason) ? INTENT_WHY[program]?.[reason] : undefined;
  if (own) return own;
  const phrase = isOutcomeReason(reason) ? REASON_PHRASE[reason] : 'it did not complete';
  return `Your plan stopped: ${phrase}.`;
}

/** The hurt sources the Body may report (PX-1, the `hurt` event). Any other source reads as `other`. */
const HURT_SOURCE_SENTENCE: Readonly<Record<string, string>> = {
  melee: 'Something hit you',
  arrow: 'An arrow hit you',
  explosion: 'Something exploded near you',
  fall: 'You fell',
  fire: 'You are burning',
  lava: 'You are burning',
  drowning: 'You are drowning',
  starvation: 'You are starving',
  other: 'You were hurt',
};
/** Sources that have an attacker, so a bearing may follow them. */
const HURT_ATTACK_SOURCES: readonly string[] = ['melee', 'arrow', 'explosion', 'other'];
const HURT_BEARING: Readonly<Record<string, string>> = {
  front: 'from the front',
  left: 'from the left',
  right: 'from the right',
  behind: 'from behind',
};

/**
 * The player's text for a `hurt` event: 'An arrow hit you from behind. You lost 3 health.' Built from the
 * source code, the bearing code and the amount alone. A bearing is used only for attack sources; an
 * unknown source reads as 'other'; a missing or zero amount leaves out the loss clause.
 */
export function hurtSentence(input: {
  source: unknown;
  bearing?: unknown;
  amount?: unknown;
}): string {
  const source =
    typeof input.source === 'string' && Object.hasOwn(HURT_SOURCE_SENTENCE, input.source)
      ? input.source
      : 'other';
  const usesBearing =
    typeof input.bearing === 'string' &&
    Object.hasOwn(HURT_BEARING, input.bearing) &&
    HURT_ATTACK_SOURCES.includes(source);
  const lead = usesBearing
    ? `${HURT_SOURCE_SENTENCE[source]} ${HURT_BEARING[input.bearing as string]}`
    : (HURT_SOURCE_SENTENCE[source] ?? 'You were hurt');
  const amount = input.amount;
  const lost =
    typeof amount === 'number' && Number.isInteger(amount) && amount > 0
      ? ` You lost ${amount} health.`
      : '';
  return `${lead}.${lost}`;
}

const VERB = /^[a-z][a-zA-Z0-9_]{0,31}$/;

/**
 * The player's text for an `action` or `action_failed` entry. Rebuilt from the verb and reason code
 * alone: a verb that is not a plain identifier reads as 'action', a reason that is not a known code
 * reads as a generic failure, so no world or agent text can ride in on an outcome event.
 */
export function playerOutcomeText(input: {
  verb: string | undefined;
  ok: boolean;
  reason?: string | undefined;
  intent?: boolean | undefined;
}): string {
  const verb = input.verb !== undefined && VERB.test(input.verb) ? input.verb : 'action';
  if (input.ok || input.intent !== true) return outcomeMessage(verb, input.ok, input.reason);
  return intentWhy(verb, input.reason);
}

/** The word for each heard sound kind (PX-4, PROVISIONAL vocabulary 0143). Any other kind reads as 'a sound'. */
const HEARD_SOUND_WORD: Readonly<Record<string, string>> = {
  hiss: 'hissing',
  bow: 'a bow being drawn',
  groan: 'a groan',
  growl: 'a growl',
  explosion: 'an explosion',
  thunder: 'thunder',
  digging: 'digging',
};
/** The lead-in for each distance band. */
const HEARD_BAND_LEAD: Readonly<Record<string, string>> = {
  near: 'close to',
  mid: 'to',
  far: 'far off to',
};
/** The words for each compass point. */
const HEARD_DIR_WORD: Readonly<Record<string, string>> = {
  n: 'north',
  ne: 'northeast',
  e: 'east',
  se: 'southeast',
  s: 'south',
  sw: 'southwest',
  w: 'west',
  nw: 'northwest',
};

function lookup(table: Readonly<Record<string, string>>, key: unknown): string | undefined {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * The player's sentence for a heard sound: 'You hear hissing close to the north.' Built from the sound kind,
 * the distance band and the compass point alone, so no coordinates ever reach the player. When the band or
 * the point is unknown the sentence keeps only the sound: 'You hear hissing.'
 */
export function heardSoundSentence(input: { sound: unknown; dir: unknown; band: unknown }): string {
  const word = lookup(HEARD_SOUND_WORD, input.sound) ?? 'a sound';
  const lead = lookup(HEARD_BAND_LEAD, input.band);
  const dir = lookup(HEARD_DIR_WORD, input.dir);
  if (lead === undefined || dir === undefined) return `You hear ${word}.`;
  return `You hear ${word} ${lead} the ${dir}.`;
}
