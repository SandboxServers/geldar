// Alignment label for operators and Glass only. Nothing renders it to an agent: the agent-facing text never carries labels or numbers.
import type { Score } from './types.ts';

function lawLetter(law: Score): 'L' | 'T' | 'C' {
  if (law >= 4) return 'L';
  if (law === 3) return 'T';
  return 'C';
}

function goodLetter(good: Score): 'G' | 'N' | 'E' {
  if (good >= 4) return 'G';
  if (good === 3) return 'N';
  return 'E';
}

/** Two letters: law (L, T or C) then good (G, N or E). Scores 4 and 5 are the high side, 1 and 2 the low side. */
export function alignmentLabel(law: Score, good: Score): string {
  return `${lawLetter(law)}${goodLetter(good)}`;
}
