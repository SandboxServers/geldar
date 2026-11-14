import { classifySpeech, type SpeechIdentity } from '@geldar/player-core/src/attention/classify.ts';

/**
 * Whether a line of speech is addressed to the agent (spec 5.3.2). The agent has no open
 * commitments in the sovereign path yet, so nothing counts as a counterparty; every other line
 * is overheard or a mention, and only the addressed ones wake a `wait`.
 */
export function isAddressedLine(speaker: string, text: string, identity: SpeechIdentity): boolean {
  return classifySpeech(speaker, text, identity, () => false) === 'addressed';
}
