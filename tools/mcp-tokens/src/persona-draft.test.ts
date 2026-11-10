import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPersona, personaFiles } from './persona-draft.ts';
import { REPO_ROOT } from './secret-files.ts';

const DRAFT = join(REPO_ROOT, 'docs/analysis/phase0/worknotes/ranger-personas-draft.md');

const SAMPLE = [
  '# Rangers',
  '',
  '## Jason: the Red Ranger',
  '',
  '- **Identity:** Jason Lee Scott, brave and fair.',
  '- **Quirk:** Jason counts off the group.',
  '- **Goals:** keep everyone alive.',
  '',
  '## Zack: the Black Ranger',
  '',
  '- **Identity:** Zack Taylor, a joker.',
  '- **Quirk:** Zack dances after each task.',
  '- **Goals:** keep spirits up.',
  '',
].join('\n');

describe('persona draft', () => {
  it('finds the approved persona by name, by life id and by title', async () => {
    const draft = await readFile(DRAFT, 'utf8');
    const byName = findPersona(draft, 'jason');
    expect(byName.name).toBe('Jason');
    expect(byName.identity).toContain('Jason Lee Scott');
    expect(byName.quirk).toContain('karate drills');
    expect(byName.goals).toContain('keep all five friends together');
    expect(findPersona(draft, 'ag_jason_01')).toEqual(byName);
    expect(findPersona(draft, 'Red Ranger')).toEqual(byName);
  });

  it('resolves all six rangers in the approved draft', async () => {
    const draft = await readFile(DRAFT, 'utf8');
    const names = ['jason', 'zack', 'billy', 'trini', 'kimberly', 'tommy'];
    expect(names.map((name) => findPersona(draft, name).name)).toEqual([
      'Jason',
      'Zack',
      'Billy',
      'Trini',
      'Kimberly',
      'Tommy',
    ]);
  });

  it('refuses a name the draft does not have', () => {
    expect(() => findPersona(SAMPLE, 'wanda')).toThrow(/no persona named wanda/);
    expect(() => findPersona(SAMPLE, 'ag_wanda_01')).toThrow(/no persona named ag_wanda_01/);
  });

  it('refuses a block that lacks a field', () => {
    const broken = SAMPLE.replace('- **Quirk:** Zack dances after each task.\n', '');
    expect(() => findPersona(broken, 'zack')).toThrow(/Black Ranger block has no quirk/);
  });

  it('writes the identity with the quirk under its heading, and the goals, each ending in LF', () => {
    const files = personaFiles(findPersona(SAMPLE, 'zack'));
    expect(files.identity).toBe(
      'Zack Taylor, a joker.\n\n## Quirk\n\nZack dances after each task.\n',
    );
    expect(files.goals).toBe('keep spirits up.\n');
  });
});
