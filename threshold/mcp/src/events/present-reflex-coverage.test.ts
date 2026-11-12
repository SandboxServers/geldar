import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markedWords } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../config.ts';
import { reflexText } from './present.ts';
import { REFLEX_LINE_NAMES } from './present-handlers/reflex.ts';

const BODY = join(repoRoot(), 'golem', 'src', 'body');

/** Reflex names registered in the Body config (REFLEX_NAMES). */
function configNames(): string[] {
  const src = readFileSync(join(BODY, 'reflex-config.ts'), 'utf8');
  const block = /REFLEX_NAMES = \[([^\]]*)\]/.exec(src)?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

/** Reflex names the reflex modules declare (`name: '...'` in a non-test reflex file). */
function declaredNames(): string[] {
  const dir = join(BODY, 'reflexes');
  const names: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || /\.(test|fakes)\.ts$/.test(file)) continue;
    const src = readFileSync(join(dir, file), 'utf8');
    for (const m of src.matchAll(/^ {2,4}name: '([a-z_]+)',$/gm)) names.push(m[1] as string);
  }
  return names;
}

describe('every reflex the Body can fire has a line', () => {
  it('reads a non-empty list from the Body config', () => {
    expect(configNames().length).toBeGreaterThanOrEqual(9);
  });

  it.each(configNames())('config reflex %s has a line and is not printed as unknown', (name) => {
    expect(REFLEX_LINE_NAMES).toContain(name);
    expect(reflexText(name, 'handled')).toMatch(new RegExp(`^Reflex ${name}: .+\\.$`));
  });

  it('every reflex module name is in the config', () => {
    for (const name of declaredNames()) expect(configNames()).toContain(name);
  });

  it('has no line for a reflex the Body does not have', () => {
    for (const name of REFLEX_LINE_NAMES) expect(configNames()).toContain(name);
  });

  it('every line passes the agent-visible-text scan', () => {
    for (const name of REFLEX_LINE_NAMES) {
      expect(markedWords(reflexText(name, 'failed'))).toEqual([]);
      expect(reflexText(name, 'handled')).not.toMatch(/-?\d/);
    }
  });

  it('dark_shelter reads its own line, and says when it did not finish', () => {
    expect(reflexText('dark_shelter', 'handled')).toBe(
      'Reflex dark_shelter: it was dark and you were exposed, you took cover.',
    );
    expect(reflexText('dark_shelter', 'failed')).toBe(
      'Reflex dark_shelter: it was dark and you were exposed, you took cover. It did not finish.',
    );
  });
});
