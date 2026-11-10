/**
 * The persona lint (decision 0068): a sovereign player's persona must not tell the character that
 * humans or observers watch it, that it is software, or what the shard, harness, colo or credits
 * are. The marker words come from @geldar/contract, the same list the agent-text scans use, and
 * Minecraft-the-game phrases (the Observer block, the Echo Shard, the end credits) are not marks.
 */
import { markedWords } from '@geldar/contract';

/** A persona that says humans or observers watch the character. */
const WATCHED: readonly RegExp[] = [
  /\b(?:being|are|is|were|was|been)\s+(?:watched|observed|monitored|recorded)\b/i,
  /\b(?:humans?|observers?|viewers?|audiences?|spectators?|watchers?|makers?|operators?|researchers?|testers?|scientists?)\b[^.\n!?]{0,30}?\b(?:watch(?:es|ing)?|observ(?:es|ing)?|monitor(?:s|ing)?|record(?:s|ing)?|read(?:s|ing)?|follow(?:s|ing)?|see(?:s|ing)?)\s+(?:you|your|everything you|what you|all you)\b/i,
];

/** A persona that says the character is software, a model or a simulation. */
const SOFTWARE =
  /\b(?:AI|LLMs?|GPT|artificial intelligences?|language models?|models?|simulations?|simulated|simulating|chatbots?|bots?|software|algorithms?)\b/i;

/** The meta names: the harness, the shard, the colo and the credits, as whole words. */
const META = /^(?:harness(?:es)?|shards?|colos?|credits?)$/i;

export type PersonaMark = 'watched' | 'software' | 'meta';

/** The marks a persona text carries; an empty list when it is clean. */
export function personaMarks(text: string): PersonaMark[] {
  const marks: PersonaMark[] = [];
  if (WATCHED.some((pattern) => pattern.test(text))) marks.push('watched');
  if (SOFTWARE.test(text)) marks.push('software');
  if (markedWords(text).some((word) => META.test(word))) marks.push('meta');
  return marks;
}

const WHAT: Record<PersonaMark, string> = {
  watched: 'says that humans or observers watch the character',
  software: 'says that the character is an AI, a model or a simulation',
  meta: 'names the harness, shard, colo or credits',
};

/** The refusal or warning text for marks. It names the kinds of mark, never the persona's words. */
export function markText(marks: readonly PersonaMark[]): string {
  return marks.map((mark) => WHAT[mark]).join('; ');
}
