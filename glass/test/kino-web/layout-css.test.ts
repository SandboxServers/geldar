import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// kino.css has no unit-testable layout, so these tests read its media rules. Each one fails when its rule
// is removed (the revert check for the wide-desktop cap and the narrow "Medium" label).
const css = readFileSync(new URL('../../web/kino/kino.css', import.meta.url), 'utf8');

/** The body of the first @media rule whose query is exactly `query`, or null. */
function mediaBody(query: string): string | null {
  const start = css.indexOf(`@media ${query} {`);
  if (start < 0) return null;
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

describe('kino.css wide desktop (issue #921)', () => {
  it('caps the channel pane at 420 px above 1100 px, and keeps the wall to the rest of the row', () => {
    const body = mediaBody('(min-width: 1100px)');
    expect(body).not.toBeNull();
    expect(body).toMatch(
      /\.kino\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*420px\)\s*;?\s*\}/,
    );
  });

  it('leaves the 700 px two-column rule in place below the cap', () => {
    expect(mediaBody('(min-width: 700px)')).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });
});

describe('kino.css narrow camera controls (issue #924)', () => {
  it('shrinks the camera segment button padding below 400 px so "Medium" fits at 360 px', () => {
    const body = mediaBody('(max-width: 399px)');
    expect(body).not.toBeNull();
    expect(body).toMatch(/\.camera-segments button\s*\{\s*padding:\s*0 4px;?\s*\}/);
  });

  it('keeps the segment row wrapping, so a narrow screen never clips the row', () => {
    expect(css).toMatch(/\.camera-segments\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
