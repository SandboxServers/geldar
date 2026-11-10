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

const MARK_ORDER: readonly PersonaMark[] = ['watched', 'software', 'meta'];

/** One marked match: its mark, the 1-based line it starts on, and the matched text. */
export interface PersonaHit {
  mark: PersonaMark;
  line: number;
  matched: string;
}

function globalCopy(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
}

/** Every marked match in a persona text, in line order. The same patterns as personaMarks. */
export function personaHits(text: string): PersonaHit[] {
  const hits: PersonaHit[] = [];
  const lineAt = (index: number): number => text.slice(0, index).split('\n').length;
  for (const pattern of WATCHED) {
    for (const found of text.matchAll(globalCopy(pattern))) {
      hits.push({ mark: 'watched', line: lineAt(found.index ?? 0), matched: found[0] });
    }
  }
  for (const found of text.matchAll(globalCopy(SOFTWARE))) {
    hits.push({ mark: 'software', line: lineAt(found.index ?? 0), matched: found[0] });
  }
  text.split('\n').forEach((line, index) => {
    for (const word of markedWords(line)) {
      if (META.test(word)) hits.push({ mark: 'meta', line: index + 1, matched: word });
    }
  });
  return hits.sort((a, b) => a.line - b.line);
}

/** The marks a persona text carries; an empty list when it is clean. */
export function personaMarks(text: string): PersonaMark[] {
  const found = new Set(personaHits(text).map((hit) => hit.mark));
  return MARK_ORDER.filter((mark) => found.has(mark));
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
