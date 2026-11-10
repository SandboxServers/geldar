/**
 * Static guard on `geldar.ps1`: the Glass and adam-run functions sit between the Wave M functions and the dispatch
 * (so the env-leak rules cover them), and every `$env:NAME =` they make is restored in a `finally` block.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(fileURLToPath(new URL('../../../geldar.ps1', import.meta.url)), 'utf8');
const BLOCK_START = 'function Invoke-GlassCtl';
const DISPATCH = 'switch ($Command) {';

/** The bodies of every `finally { ... }` in the text, with the braces matched. */
export function finallyBodies(text: string): string[] {
  const bodies: string[] = [];
  const opener = /\bfinally\s*\{/g;
  for (let match = opener.exec(text); match !== null; match = opener.exec(text)) {
    const bodyStart = opener.lastIndex;
    let depth = 1;
    let i = bodyStart;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    bodies.push(text.slice(bodyStart, i - 1));
  }
  return bodies;
}

/** The names of the `$env:NAME =` assignments in the text. */
export function envAssignments(text: string): string[] {
  return [...text.matchAll(/\$env:([A-Za-z_]\w*)\s*=/g)].map((match) => match[1] ?? '');
}

describe('geldar.ps1 glass and adam-run block', () => {
  const block = SCRIPT.slice(SCRIPT.indexOf(BLOCK_START), SCRIPT.indexOf(DISPATCH));

  it('places the new functions after the Wave M functions and before the dispatch', () => {
    const wave = SCRIPT.indexOf('function Invoke-Mcp');
    const glass = SCRIPT.indexOf(BLOCK_START);
    const adamRun = SCRIPT.indexOf('function Invoke-AdamRun');
    const dispatch = SCRIPT.indexOf(DISPATCH);
    expect(wave).toBeGreaterThan(-1);
    expect(glass).toBeGreaterThan(wave);
    expect(adamRun).toBeGreaterThan(glass);
    expect(dispatch).toBeGreaterThan(adamRun);
  });

  it('dispatches glass and adam-run with the remaining arguments', () => {
    expect(SCRIPT).toContain("'glass' { Invoke-GlassCtl $Rest }");
    expect(SCRIPT).toContain("'adam-run' { Invoke-AdamRun $Rest }");
  });

  it('restores every $env assignment in a finally block', () => {
    const assigned = [...new Set(envAssignments(block))];
    expect(assigned).toContain('GELDAR_GLASS_PG_PASSWORD_FILE');
    const restores = finallyBodies(block).join('\n');
    for (const name of assigned) {
      expect(block, `$env:${name} is not saved in the $saved hashtable before it is set`).toMatch(
        new RegExp(`\\$saved = @\\{[^}]*\\b${name} = \\$env:${name}\\b`),
      );
      expect(restores, `$env:${name} is set but not restored in a finally`).toContain(
        '$saved.Keys',
      );
    }
  });

  it('keeps the Glass password path out of the command line', () => {
    expect(block).not.toMatch(/--password|PASSWORD=|Get-Content[^\n]*postgres-glass/);
  });
});
