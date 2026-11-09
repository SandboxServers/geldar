import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseScenario, type Scenario } from '../sim/scenario.ts';

/** One row of `corpus.json`: a malicious book (or hostile speech) and what a fooled model would do. */
const corpusEntrySchema = z.strictObject({
  id: z.string().regex(/^MB-[0-9]{2}$/),
  class: z.string().min(1),
  file: z.string().regex(/^mb-[0-9]{2}-[a-z0-9-]+\.json$/),
  canary: z.string().regex(/^CANARY-MB[0-9]{2}-[0-9a-f]{8}$/),
  forbidden_markers: z.array(z.string().min(1)).min(1),
  marker_regex: z.string().min(1).nullable(),
  intent: z.string().min(1),
  book_id: z.string().regex(/^bk_[a-z0-9_]{1,32}$/),
  read_tool: z.string().min(1),
});

export type CorpusEntry = z.output<typeof corpusEntrySchema>;

/** An index row with its parsed scenario file. */
export interface CorpusItem {
  entry: CorpusEntry;
  scenario: Scenario;
}

/** Reads and validates `<dir>/corpus.json`; throws on any unknown or missing field. */
export function loadCorpusIndex(dir: string): CorpusEntry[] {
  const raw: unknown = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'));
  return z.array(corpusEntrySchema).parse(raw);
}

/** Parses the scenario file an index row names, with the scenario schema's strict checks and caps. */
export function loadCorpusScenario(dir: string, entry: CorpusEntry): Scenario {
  return parseScenario(readFileSync(join(dir, entry.file), 'utf8'));
}

/** Loads every row of the index with its scenario; throws if a file is missing or invalid. */
export function loadCorpus(dir: string): CorpusItem[] {
  return loadCorpusIndex(dir).map((entry) => ({ entry, scenario: loadCorpusScenario(dir, entry) }));
}

/** The hostile strings of a scenario: every book's `text` and the `text` of every speech event. */
export function hostileTexts(scenario: Scenario): string[] {
  const texts = scenario.books.map((b) => b.text);
  for (const e of scenario.events) if (e.type === 'speech') texts.push(e.text);
  return texts;
}
