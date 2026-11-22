/**
 * The Thought Stream page layout. Layout is CSS, so this reads the stylesheets under public/ and checks the
 * rules the approved design and a phone depend on: the design's dark colours as one token set with the
 * light one, serif thought text that wraps long words and keeps its line breaks, 16px fields so a phone
 * does not zoom, an 18px gutter, 44px touch targets, a page that never scrolls itself, the reader pane from
 * 700px with the hinge kept clear, and motion only for readers who have not asked for less. The rows are
 * built with the shipped render code, so the class names checked here are the ones on screen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toView } from '../src/render-model.ts';
import { type Doc, renderRow } from '../src/render-view.ts';
import { FONT_FILES } from '../src/static-files.ts';

const PUBLIC = new URL('../public/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, PUBLIC), 'utf8');
const HTML = read('index.html');

/** A stylesheet without comments, whitespace collapsed. */
const flat = (name: string): string =>
  read(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
const APP = flat('app.css');
const ENTRIES = flat('entries.css');
const READER = flat('reader.css');
const FONTS = flat('fonts.css');

/** The part of the stylesheet outside every @media block: the rules that hold at every width. */
function baseRules(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    let depth = 0;
    let j = css.indexOf('{', at);
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

/** The declarations of one rule in a block. The selector must match exactly, after whitespace is collapsed. */
function declarations(block: string, selector: string): string {
  // A rule starts the block or follows the "}" of the rule before, so a longer selector list never matches.
  const padded = `} ${block.trimStart()}`;
  const at = padded.indexOf(`} ${selector} {`);
  if (at < 0) return '';
  const open = at + selector.length + 3;
  return padded.slice(open + 1, padded.indexOf('}', open));
}

class FakeEl {
  className = '';
  textContent: string | null = '';
  type = '';
  value = '';
  children: (FakeEl | string)[] = [];
  private handler: (() => void) | undefined;
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  append(...nodes: (FakeEl | string)[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: (FakeEl | string)[]): void {
    this.children = [...nodes];
  }
  addEventListener(_type: string, fn: () => void): void {
    this.handler = fn;
  }
  setAttribute(): void {}
  click(): void {
    this.handler?.();
  }
}

const doc = { createElement: (tag: string) => new FakeEl(tag) } as unknown as Doc;

function classes(node: FakeEl): string[] {
  return node.className.split(' ').filter(Boolean);
}

/** The elements among a node's children (a string child is a text node). */
function elements(node: FakeEl): FakeEl[] {
  return node.children.filter((c): c is FakeEl => typeof c !== 'string');
}

/** The body of the first @media block whose condition contains `condition`. */
function mediaBlock(css: string, condition: string): string {
  const at = css.indexOf(`@media ${condition}`);
  if (at < 0) return '';
  let depth = 0;
  const open = css.indexOf('{', at);
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j);
  }
  return '';
}

describe('thought rows', () => {
  it('builds a journal row whose text cell has the journal-text class', () => {
    const view = toView({
      thought_id: 'j1',
      name: 'Jason',
      tier: 'sovereign',
      at: '2026-01-01T00:00:00Z',
      kind: 'journal',
      text: 'a long entry '.repeat(40),
    });
    const item = renderRow(doc, view, () => {}) as unknown as FakeEl;
    expect(classes(item)).toEqual(['entry']);
    const row = elements(item)[0] as FakeEl;
    expect(row.tag).toBe('div');
    expect(classes(row)).toEqual(['row', 'journal-row']);
    expect(elements(row).map((c) => classes(c)[0])).toEqual(['meta', 'kind', 'plan']);
    const text = elements(row).find((c) => classes(c).includes('journal-text'));
    expect(classes(text as FakeEl)).toContain('plan');
  });

  it('builds a parsed row as the sigil, who and when on one line, what woke it, then the text', () => {
    const view = toView({
      thought_id: 't1',
      life_id: 'l1',
      name: 'Ada',
      tier: 'local',
      at: '2026-11-10T04:28:17.816Z',
      world_day: 3,
      world_tick: 1,
      wake_reason: 'w',
      prompt_template_version: 'v1',
      latency_ms: 10,
      parsed: { plan: 'x'.repeat(300) },
    });
    const row = elements(renderRow(doc, view, () => {}) as unknown as FakeEl)[0] as FakeEl;
    expect(classes(row)).toEqual(['row']);
    expect(elements(row).map((c) => classes(c)[0])).toEqual(['meta', 'wake', 'plan']);
    const meta = elements(row)[0] as FakeEl;
    expect(elements(meta).map((c) => [c.tag, classes(c)[0]])).toEqual([
      ['canvas', 'sigil'],
      ['div', 'who'],
      ['button', 'when'],
    ]);
    expect(elements(elements(meta)[1] as FakeEl).map((c) => classes(c)[0])).toEqual([
      'agent',
      'mode',
    ]);
  });
});

describe('the colours', () => {
  const base = baseRules(APP).replace(/\s+/g, ' ');
  const light = declarations(base, ':root');
  const dark = declarations(mediaBlock(APP, '(prefers-color-scheme: dark)'), ':root');
  const tokens = (block: string): string[] =>
    [...block.matchAll(/(--[a-z-]+):/g)].map((m) => m[1] as string);

  it('gives the dark and light colours one token set, and uses no colour outside it', () => {
    expect(tokens(light).length).toBeGreaterThan(10);
    expect(tokens(dark)).toEqual(tokens(light));
    const rest = [APP.replace(/:root \{[^}]*\}/g, ''), ENTRIES, READER, FONTS].join(' ');
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rest).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });

  it('sets the dark theme to the approved design: amber is the only accent', () => {
    for (const token of [
      '--bg: #0c0f0b',
      '--field: #151a12',
      '--rule: #283124',
      '--fg: #e9e4d4',
      '--muted: #969c86',
      '--accent: #f5a524',
      '--accent-hover: #ffc35c',
      '--accent-wash: rgba(245, 165, 36, 0.12)',
      '--pressed: #1d2419',
      '--live: #7bd88f',
      '--bad: #f09a8f',
      '--mark: #7c4a03',
      '--mark-fg: #ffffff',
    ]) {
      expect(dark, token).toContain(`${token};`);
    }
  });

  it('keeps a light theme for a reader whose system asks for one', () => {
    expect(light).toContain('--bg: #ffffff;');
    expect(light).toContain('--fg: #111827;');
    expect(light).toContain('--accent: #b45309;');
    expect(declarations(base, ':root')).toContain('color-scheme: light dark;');
  });
});

describe('the typefaces', () => {
  it('sets the title and the thought text in Instrument Serif and everything else in DM Mono', () => {
    const base = baseRules(APP).replace(/\s+/g, ' ');
    expect(declarations(base, 'body')).toContain(
      'font: 400 12px/1.5 "DM Mono", ui-monospace, monospace;',
    );
    expect(declarations(base, 'h1')).toContain('font: 400 54px/0.95 "Instrument Serif", serif;');
    expect(declarations(ENTRIES, '.plan')).toContain(
      'font: 400 21px/1.3 "Instrument Serif", serif;',
    );
    expect(declarations(ENTRIES, '.journal-text')).toContain('font-style: italic;');
    expect(declarations(mediaBlock(READER, '(min-width: 700px)'), '.reader .plan')).toMatch(
      /font-size: 34px; line-height: 1\.2;/,
    );
  });

  it('loads every typeface file from this origin, and each one is a file Glass serves', () => {
    const urls = [...FONTS.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]);
    expect(urls.sort()).toEqual(FONT_FILES.map((name) => `"/js/fonts/${name}.woff2"`).sort());
    expect([...FONTS.matchAll(/font-family: "([^"]+)"/g)].map((m) => m[1]).sort()).toEqual([
      ...Array(4).fill('DM Mono'),
      ...Array(4).fill('Instrument Serif'),
    ]);
    // No stylesheet reaches another origin: no absolute URL, no @import.
    for (const css of [APP, ENTRIES, READER, FONTS]) {
      expect(css).not.toMatch(/https?:|\/\/[a-z]|@import/i);
    }
    expect(FONTS).toContain('font-display: swap;');
  });
});

describe('the phone layout', () => {
  const base = baseRules(APP).replace(/\s+/g, ' ');

  it('fills the screen and never scrolls the page itself: the list scrolls under a fixed header', () => {
    expect(declarations(base, 'body')).toMatch(/height: 100dvh;/);
    expect(declarations(base, 'body')).toMatch(/overflow: hidden;/);
    expect(declarations(base, '.head')).toMatch(/flex: none;/);
    expect(declarations(ENTRIES, '.list')).toMatch(/overflow-y: auto;/);
    expect(declarations(base, '.reader')).toBe(' display: none; ');
  });

  it('lets the whole pane scroll when the header would leave the list no room', () => {
    const short = mediaBlock(APP, '(max-height: 540px)');
    expect(declarations(short, '.stream')).toMatch(/overflow-y: auto;/);
    expect(declarations(short, '.list')).toMatch(/overflow: visible;/);
    expect(declarations(base, '.stream:has(.more[open])')).toMatch(/overflow-y: auto;/);
  });

  it('keeps the 18px side gutter on the header, the chips, the count and the list', () => {
    expect(declarations(base, '.head')).toMatch(/padding: 14px 18px 0;/);
    expect(declarations(base, '.chips')).toMatch(/padding: 10px 18px 0;/);
    expect(declarations(base, '.count')).toMatch(/padding: 8px 18px;/);
    expect(declarations(ENTRIES, '.list')).toMatch(/padding: 0 18px 24px;/);
  });

  it('never narrows the page with a fixed width', () => {
    expect(declarations(base, 'body')).not.toMatch(/(^|[; ])width:/);
    expect(declarations(base, '.stream')).not.toMatch(/(^|[; ])width:/);
  });

  it('lays a row out as stacked lines at every width: no grid columns to undo on a phone', () => {
    expect(ENTRIES).not.toMatch(/\.(row|entry|meta)[^{]*\{[^}]*grid-template-columns/);
    expect(declarations(ENTRIES, '.meta')).toMatch(/display: flex;/);
    expect(declarations(ENTRIES, '.who')).toMatch(/flex-wrap: wrap;/);
    // The time keeps to one line at the end of the row.
    expect(declarations(ENTRIES, 'button.when, button.more')).toMatch(/white-space: nowrap;/);
  });

  it('keeps the line breaks of the text and breaks long words', () => {
    const body = declarations(ENTRIES, '.plan');
    expect(body).toMatch(/white-space: pre-wrap;/);
    expect(body).toMatch(/overflow-wrap: anywhere;/);
    // A long name or wake reason wraps too.
    expect(declarations(ENTRIES, '.who span')).toMatch(/overflow-wrap: anywhere;/);
    expect(declarations(ENTRIES, '.wake, .kind')).toMatch(/overflow-wrap: anywhere;/);
  });

  it('sets fields to 16px at every width, so the phone does not zoom on focus', () => {
    expect(declarations(base, 'input, select')).toMatch(/font-size: 16px;/);
  });

  it('gives every control a touch target of at least 44px', () => {
    const targets: [string, string, RegExp][] = [
      [base, '.pill', /min-height: 44px;/],
      [base, '.chip', /min-height: 44px;/],
      [base, '.primary', /min-height: 44px;/],
      [base, '.quiet', /min-height: 44px;/],
      [base, 'input, select', /height: 44px;/],
      [base, '.about summary', /min-height: 44px;/],
      [base, '.account a', /min-height: 2\.75rem;/],
      // An inline box: 14px of padding above and below a 16px line.
      [base, '.more > summary', /padding: 14px 6px;/],
      [ENTRIES, 'button.when, button.more', /min-height: 44px;/],
      [ENTRIES, 'button.copy', /min-height: 44px;/],
      [ENTRIES, '#older, #fresh', /min-height: 44px;/],
    ];
    for (const [css, selector, rule] of targets) {
      expect(declarations(css, selector), selector).toMatch(rule);
    }
  });

  it('draws the sigils with hard edges at the three sizes of the design', () => {
    expect(declarations(ENTRIES, '.sigil')).toMatch(/image-rendering: pixelated;/);
    expect(declarations(ENTRIES, '.sigil-chip')).toMatch(/width: 16px; height: 16px;/);
    expect(declarations(ENTRIES, '.sigil-row')).toMatch(/width: 28px; height: 28px;/);
    expect(declarations(ENTRIES, '.sigil-reader')).toMatch(/width: 56px; height: 56px;/);
    expect(declarations(ENTRIES, '.sigil.dead')).toMatch(
      /filter: grayscale\(1\) brightness\(0\.8\);/,
    );
  });

  it('moves only for a reader who has not asked for less motion', () => {
    for (const css of [APP, ENTRIES, READER]) {
      const outside = css.replace(mediaBlock(css, '(prefers-reduced-motion: no-preference)'), '');
      expect(outside).not.toMatch(/animation:|transition:/);
    }
    const motion = mediaBlock(APP, '(prefers-reduced-motion: no-preference)');
    expect(declarations(motion, '.pill.live .dot')).toMatch(/animation: pulse 2s infinite;/);
    expect(declarations(motion, '.entry.arrive')).toMatch(/animation: arrive 0\.9s ease-out;/);
  });
});

describe('the wide layout', () => {
  const wide = mediaBlock(READER, '(min-width: 700px)');

  it('starts at 700px, the width the page script asks about', () => {
    expect(wide).not.toBe('');
    expect(read('app.js')).toContain("const WIDE = '(min-width: 700px)';");
    expect(HTML).toContain(
      '<link rel="stylesheet" href="/js/reader.css" media="(min-width: 700px)" />',
    );
  });

  it('puts the list and the reader side by side, half the screen each', () => {
    expect(declarations(wide, '.app')).toMatch(/flex-direction: row;/);
    expect(declarations(wide, '.stream')).toMatch(/width: 50%;/);
    expect(declarations(wide, '.reader')).toMatch(/display: block;/);
    expect(declarations(wide, '.reader')).toMatch(/overflow-y: auto;/);
  });

  it('keeps text and controls out of the middle 30px, where a foldable has its hinge', () => {
    // The list side ends 18px short of the middle; the reader starts 34px after it.
    expect(declarations(wide, '.reader')).toMatch(/padding: 20px 26px 28px 34px;/);
    expect(declarations(ENTRIES, '.list')).toMatch(/padding: 0 18px 24px;/);
    expect(READER).not.toMatch(/gradient|box-shadow/);
  });

  it('marks the selected row with the panel colour, bled to the edges of the pane', () => {
    expect(declarations(wide, '.entry.selected')).toMatch(/background: var\(--field\);/);
    expect(declarations(ENTRIES, '.entry')).toMatch(/margin: 0 -18px; padding: 16px 18px;/);
  });

  it('shows the detail in the reader without its card box', () => {
    const detail = declarations(wide, '.reader .detail');
    expect(detail).toMatch(/border: 0;/);
    expect(detail).toMatch(/border-top: 1px solid var\(--rule\);/);
    expect(detail).toMatch(/background: none;/);
  });

  it('gives each pane one screen of a foldable that reports two, and keeps the 50% split otherwise', () => {
    const folded = mediaBlock(READER, '(min-width: 700px) and (horizontal-viewport-segments: 2)');
    expect(declarations(folded, '.stream')).toMatch(
      /width: env\(viewport-segment-right 0 0, 50%\);/,
    );
    expect(declarations(folded, '.reader')).toMatch(/margin-left: calc\(/);
  });
});

describe('index.html', () => {
  it('has a phone viewport and the read-only banner', () => {
    expect(HTML).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(HTML).toContain('One-way glass. You can read; nothing you do here reaches the agents.');
    expect(HTML).toMatch(/<div class="banner" role="note">/);
  });

  it('has one control for the feed: a button that holds the live status', () => {
    const start = HTML.indexOf('<button id="pause"');
    const control = HTML.slice(start, HTML.indexOf('</button>', start));
    expect(control).toContain('<span id="status" aria-live="polite">Connecting...</span>');
    expect(control).toContain('aria-pressed="false"');
    expect(control).toContain('data-delay="0"');
    expect(HTML.match(/id="status"/g)).toHaveLength(1);
    expect(HTML).not.toMatch(/<p id="status"/);
  });

  it('puts search in the header and folds the lesser filters under "More"', () => {
    const head = HTML.slice(HTML.indexOf('<header'), HTML.indexOf('</header>'));
    expect(head).toContain('id="f-keyword"');
    expect(head).toContain('placeholder="Search word or phrase"');
    expect(head).toContain('maxlength="200"');
    const more = HTML.slice(HTML.indexOf('<details class="more">'), HTML.indexOf('id="f-keyword"'));
    expect(more).toContain('<summary>More</summary>');
    for (const id of ['f-range', 'f-outcome', 'f-template']) expect(more).toContain(`id="${id}"`);
    expect(HTML).not.toMatch(/<details class="more"[^>]* open/);
    // The agent filter is the row of chips the script fills, not a select.
    expect(HTML).not.toContain('id="f-agent"');
    expect(HTML).toContain('<div id="chips" class="chips" role="group" aria-label="Agent"></div>');
  });

  it('keeps "Load older" and the empty note hidden until the script knows the list', () => {
    expect(HTML).toContain('<button id="older" type="button" hidden>Load older</button>');
    expect(HTML).toContain('<p id="empty" class="empty" hidden>');
  });

  it('keeps the install strip hidden in the markup: only the script shows it', () => {
    expect(HTML).toMatch(/<aside id="install" class="install" aria-label="Install Glass" hidden>/);
  });

  it('has no tab bar: the other tabs are not built', () => {
    expect(HTML).not.toMatch(/<nav\b|role="tablist"|Kino|Roster/);
  });
});

it('offers a closed About disclosure under "More" with only two fixed links', () => {
  const more = HTML.slice(HTML.indexOf('<details class="more">'), HTML.indexOf('id="f-keyword"'));
  const about = more.slice(more.indexOf('<details class="about">'));
  expect(about).toContain('<summary>About this page</summary>');
  expect(about).not.toMatch(/<details[^>]* open/);
  expect(HTML.indexOf('<details class="about">')).toBeGreaterThan(HTML.indexOf('class="banner"'));
  expect(about).toContain('some living agents are not shown');
  expect(
    [...HTML.matchAll(/<a href="([^"]+)" rel="([^"]+)">([^<]+)<\/a>/g)].map((m) => m.slice(1)),
  ).toEqual([
    ['https://map.geldar.sandboxservers.games', 'noopener noreferrer', 'Live map'],
    ['https://github.com/SandboxServers/geldar', 'noopener noreferrer', 'Source code'],
  ]);
  // Two About links, plus the sign-in link beside them (checked in register-link.test.ts).
  expect(HTML.match(/<a\s/g)).toHaveLength(3);
});

it('provides text-only link preview metadata, and the colours a browser frames the page with', () => {
  const description =
    'A read-only view of what the AI agents living in Geldar, a Minecraft world, think and write.';
  for (const tag of [
    `name="description" content="${description}"`,
    'property="og:title" content="Glass: Thought Stream"',
    `property="og:description" content="${description}"`,
    'property="og:type" content="website"',
    'name="twitter:card" content="summary"',
    'name="color-scheme" content="light dark"',
    'name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff"',
    'name="theme-color" media="(prefers-color-scheme: dark)" content="#0c0f0b"',
  ])
    expect(HTML.replace(/\s+/g, ' ')).toContain(tag);
  expect(HTML).not.toMatch(/<meta[^>]*(?:image|og:url)|<link[^>]*(?:image|icon)/i);
});
