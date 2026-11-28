import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STANDARD_SHEET } from '@geldar/psyche';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from '../config.ts';
import { parseAdamConfig } from './adam-config.ts';

// CHAR-BLOCK: the Colo's character block is on (sheet mode, no rolls, no proficiency yet). The real file is parsed,
// so reverting the block to a comment or to mode off fails here.
const FILE = join(repoRoot(), 'shards', 'colo-mind.yaml');

describe('shards/colo-mind.yaml character block (CHAR-BLOCK)', () => {
  const doc = parse(readFileSync(FILE, 'utf8')) as {
    character?: unknown;
    mind: { agent: Record<string, unknown> };
  };

  it('is uncommented: mode sheet, rolls false, proficiency disabled, and nothing else', () => {
    expect(doc.character).toEqual({ mode: 'sheet', rolls: false, proficiency: { enabled: false } });
  });

  // parseAdamConfig types `character` as optional; this block always sets it, so a missing one fails the test.
  function parsedCharacter() {
    const character = parseAdamConfig(doc, () => undefined).character;
    expect(character).toBeDefined();
    if (!character) throw new Error('shards/colo-mind.yaml must parse to a character');
    return character;
  }

  it('parses to sheet mode with no rolls and no proficiency', () => {
    const character = parsedCharacter();
    expect(character.config.mode).toBe('sheet');
    expect(character.config.rolls).toBe(false);
    expect(character.config.proficiency.enabled).toBe(false);
  });

  it('stores no sheet in the file, so each life takes the standard sheet unless the database has one', () => {
    expect(doc.mind.agent.character_sheet).toBeUndefined();
    const character = parsedCharacter();
    expect(character.source).toBe('standard');
    expect(character.sheet).toBe(STANDARD_SHEET);
  });
});
