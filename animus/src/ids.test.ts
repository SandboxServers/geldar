import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type IdPrefix, newId } from './ids.ts';

const COMMON = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../contract/schemas/common.schema.json'), 'utf8'),
) as { $defs: Record<string, { pattern?: string }> };

/** Which `common.schema.json` definition governs each prefix. */
const DEFS: Record<IdPrefix, string> = {
  th: 'ThoughtId',
  in: 'IntentId',
  ac: 'ActionId',
  jb: 'JobId',
};

describe('newId', () => {
  for (const prefix of ['th', 'in', 'ac', 'jb'] as const) {
    it(`matches the contract pattern for ${prefix}_`, () => {
      const pattern = COMMON.$defs[DEFS[prefix]]?.pattern;
      expect(pattern).toBeDefined();
      for (let i = 0; i < 50; i++) expect(newId(prefix)).toMatch(new RegExp(pattern ?? '^$'));
    });
  }

  it('makes distinct ids that sort in creation order', () => {
    const ids = Array.from({ length: 500 }, () => newId('th'));
    expect(new Set(ids).size).toBe(500);
    expect([...ids].sort()).toEqual(ids);
  });
});
