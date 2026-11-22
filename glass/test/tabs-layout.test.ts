/**
 * The tab bar's place on the page, read from the markup and the stylesheet: where each tab sits on a wide
 * screen (a foldable has a hinge down the middle), and the heading that takes the focus when a Roster row
 * opens an agent in Glass.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PUBLIC = new URL('../public/', import.meta.url);
const HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');
const CSS = readFileSync(new URL('roster.css', PUBLIC), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** The body of the stylesheet's wide-screen block. */
function wideBlock(css: string): string {
  const at = css.indexOf('@media (min-width: 700px)');
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}
const WIDE = wideBlock(CSS);

describe('the tab bar on a wide screen', () => {
  it('has four slots and leaves the middle of the screen empty, where a foldable has its hinge', () => {
    // Three equal columns would centre the middle label on the hinge. Four put a boundary there.
    expect(WIDE).toContain(
      '.tabs { grid-auto-flow: row; grid-template-columns: repeat(4, minmax(0, 1fr)); }',
    );
    expect(WIDE).toContain('#tab-map { grid-column: 3; }');
    expect(WIDE).toContain('#tab-roster { grid-column: 4; }');
  });

  it('keeps the tabs in the order of the design, with the ids the stylesheet places them by', () => {
    const tabs = [...HTML.matchAll(/<a id="(tab-[a-z]+)" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
      (m) => m.slice(1),
    );
    expect(tabs).toEqual([
      ['tab-glass', '/', 'Glass'],
      ['tab-map', 'https://map.geldar.sandboxservers.games', 'Map'],
      ['tab-roster', '/?view=roster', 'Roster'],
    ]);
  });

  it('on a phone gives every tab an equal column, however many there are', () => {
    const base = CSS.slice(0, CSS.indexOf('@media'));
    expect(base).toMatch(
      /\.tabs \{[^}]*grid-auto-flow: column;[^}]*grid-auto-columns: minmax\(0, 1fr\);/,
    );
  });
});

describe('the Glass heading', () => {
  it('can take the focus from a script, so opening an agent from the Roster lands a keyboard reader on it', () => {
    // happy-dom focuses any element, so the page tests cannot see this attribute missing; a browser can.
    expect(HTML).toContain('<h1 tabindex="-1">Glass</h1>');
  });
});
