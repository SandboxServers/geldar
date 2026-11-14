/** Speech classification (spec 5.3.2): addressed, about me, about my commitments, or overheard. */

/** The class of one line of speech heard by the agent. */
export type SpeechClass = 'addressed' | 'about_me' | 'about_my_commitments' | 'overheard';

/** Who the agent is, for matching the words of a line. */
export interface SpeechIdentity {
  /** The agent's name. */
  name: string;
  /** The agent's in-world username. */
  username: string;
}

/** Whether `speaker` is a counterparty in one of the agent's open commitments. */
export type CommitmentLookup = (speaker: string) => boolean;

const WORD = String.raw`[\p{L}\p{N}_]`;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** One regex per spelling: the spelling as a whole word, with the text before and after captured. */
function wholeWord(spelling: string): RegExp {
  return new RegExp(`(?<!${WORD})${escapeRegex(spelling)}(?!${WORD})`, 'giu');
}

/**
 * Whether the line speaks to the agent: a spelling of the name as a whole word that opens the line,
 * closes it, is set off by a comma or colon, or follows an `@`. A whole word elsewhere in the line
 * ("I saw Adam at the lake") is a mention, not an address.
 */
function isAddressed(text: string, spelling: string): boolean {
  for (const match of text.matchAll(wholeWord(spelling))) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text.slice(0, start).trimEnd();
    const after = text.slice(end).trimStart();
    const opens = before === '' || /^(hey|hi|hello|oi|ok|okay|yo)[\s,!.]*$/iu.test(before);
    const closes = /^[\s?!.]*$/u.test(after);
    const setOff = /^[,:]/u.test(after) || /[,:]$/u.test(before) || text[start - 1] === '@';
    if (opens || closes || setOff) return true;
  }
  return false;
}

/** The spellings the agent answers to, without empty ones. */
function spellings(identity: SpeechIdentity): string[] {
  return [identity.name, identity.username].filter((s) => s.trim() !== '');
}

/**
 * Classifies one line. `addressed` beats `about_me` beats `about_my_commitments`; whatever is left is
 * `overheard`, which only feeds the conversation digest.
 */
export function classifySpeech(
  speaker: string,
  text: string,
  identity: SpeechIdentity,
  isCounterparty: CommitmentLookup,
): SpeechClass {
  const names = spellings(identity);
  if (names.some((n) => isAddressed(text, n))) return 'addressed';
  if (names.some((n) => wholeWord(n).test(text))) return 'about_me';
  if (isCounterparty(speaker)) return 'about_my_commitments';
  return 'overheard';
}
