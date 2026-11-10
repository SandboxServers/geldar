import type { JournalResult } from '@geldar/contract';
import type { JournalStore } from '../ports.ts';
import type { ToolCall } from './look.ts';

/** The most characters one journal line keeps (the `JournalStore` cap). */
export const JOURNAL_LINE_LIMIT = 4000;

export interface JournalDeps {
  journal: JournalStore;
  now: () => number;
}

/**
 * `journal`: mirrors one line of the player's own journal. A longer line keeps its first
 * `JOURNAL_LINE_LIMIT` characters, and `mirrored_chars` says how many were kept. Free.
 */
export async function journalTool(
  deps: JournalDeps,
  call: ToolCall,
  input: { text: string },
): Promise<JournalResult> {
  const text = input.text.slice(0, JOURNAL_LINE_LIMIT);
  await deps.journal.append(call.lifeId, text, deps.now());
  return { ok: true, mirrored_chars: text.length };
}
