import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// tools/repo-checks/src -> the repository root.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LEGAL = join(ROOT, 'docs', 'legal');
const MARKER = 'DRAFT for owner review, not approved, not legal advice';

describe('docs/legal drafts (C7-08)', () => {
  const files = readdirSync(LEGAL).filter((name) => name.endsWith('.md'));

  it('has the three drafts: terms, privacy and acceptable use', () => {
    expect(files.sort()).toEqual(['acceptable-use-draft.md', 'privacy-draft.md', 'terms-draft.md']);
  });

  it.each(files)('%s carries the DRAFT marker and never claims approval', (name) => {
    const text = readFileSync(join(LEGAL, name), 'utf8');
    expect(text).toContain(MARKER);
    expect(text.replace(/not approved/gi, '')).not.toMatch(/approved/i);
  });
});
