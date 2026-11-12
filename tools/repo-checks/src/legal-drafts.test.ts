import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// tools/repo-checks/src -> the repository root.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LEGAL = join(ROOT, 'docs', 'legal');
const CONTACT = 'abuse@sandboxservers.games';
const STAMP = /Version \d+, effective \d{4}-\d{2}-\d{2}/;
const UNFILLED_CONTACT = '<CONTACT ADDRESS>';
// Any angle-bracket placeholder such as <OPERATOR NAME> or <APPEALS PROCESS: to be set by the owner>.
const PLACEHOLDER = /<[A-Z][A-Z ]+(?::|>)/;
const PLACEHOLDER_PROBLEM = 'no angle-bracket placeholder such as <OPERATOR NAME>';

/** What a legal text must carry before it may ship (decision 0155). An empty list means it passes. */
const problems = (text: string): string[] => {
  const found: string[] = [];
  if (!STAMP.test(text)) found.push('a "Version N, effective YYYY-MM-DD" line');
  if (!text.includes(CONTACT)) found.push(`the contact address ${CONTACT}`);
  if (text.includes(UNFILLED_CONTACT)) found.push('no unfilled <CONTACT ADDRESS> placeholder');
  if (PLACEHOLDER.test(text)) found.push(PLACEHOLDER_PROBLEM);
  if (/DRAFT for owner review/i.test(text)) found.push('no DRAFT marker');
  return found;
};

describe('docs/legal texts (C7-08, decision 0155)', () => {
  const files = readdirSync(LEGAL).filter((name) => name.endsWith('.md'));

  it('has the three texts: terms, privacy and acceptable use', () => {
    expect(files.sort()).toEqual(['acceptable-use.md', 'privacy.md', 'terms.md']);
  });

  it.each(files)('%s carries the version stamp and the contact address', (name) => {
    const text = readFileSync(join(LEGAL, name), 'utf8');
    expect(problems(text)).toEqual([]);
  });

  it('fails a text with no version stamp (the old DRAFT marker)', () => {
    const old = `# Terms\n\nDRAFT for owner review, not approved, not legal advice.\n\nContact: ${CONTACT}`;
    expect(problems(old)).toContain('a "Version N, effective YYYY-MM-DD" line');
    expect(problems(old)).toContain('no DRAFT marker');
  });

  it('fails a text with no contact address, or an unfilled one', () => {
    const stamped = '# Terms\n\nVersion 2, effective 2027-01-01, approved by the owner.\n\n';
    expect(problems(stamped)).toEqual([`the contact address ${CONTACT}`]);
    expect(problems(`${stamped}Contact: <CONTACT ADDRESS>`)).toEqual([
      `the contact address ${CONTACT}`,
      'no unfilled <CONTACT ADDRESS> placeholder',
      PLACEHOLDER_PROBLEM,
    ]);
  });

  it('fails a text that still carries an angle-bracket placeholder', () => {
    const stamped = `# Terms\n\nVersion 1, effective 2026-11-11, approved by the owner.\n\nContact: ${CONTACT}\n\n`;
    expect(problems(`${stamped}Age: <MINIMUM AGE>`)).toEqual([PLACEHOLDER_PROBLEM]);
    expect(problems(`${stamped}Appeals: <APPEALS PROCESS: to be set by the owner>`)).toEqual([
      PLACEHOLDER_PROBLEM,
    ]);
  });

  it('passes a stamped text with the contact address', () => {
    const good = `# Terms\n\nVersion 1, effective 2026-11-11, approved by the owner.\n\nContact: ${CONTACT}`;
    expect(problems(good)).toEqual([]);
  });
});
