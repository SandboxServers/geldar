/**
 * The Thought Stream page layout. Layout is CSS, so this reads public/app.css and checks the rules
 * a phone depends on: one entry is a stacked card at every width (no desktop grid to undo), the text
 * cell wraps long words and keeps its line breaks, fields are 16px so iOS does not zoom, and the page
 * has a phone viewport and a 16px side gutter. The rows are built with the shipped render code, so the
 * class names checked here are the ones on screen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toView } from '../src/render-model.ts';
import { type Doc, renderRow } from '../src/render-view.ts';

const PUBLIC = new URL('../public/', import.meta.url);
const CSS = readFileSync(new URL('app.css', PUBLIC), 'utf8');
const HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');

/** The stylesheet without comments, whitespace collapsed. */
const FLAT = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

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

describe('thought rows', () => {
  it('builds a journal row as a card whose text cell has the journal-text class', () => {
    const view = toView({
      thought_id: 'j1',
      name: 'Jason',
      tier: 'sovereign',
      at: '2026-01-01T00:00:00Z',
      kind: 'journal',
      text: 'a long entry '.repeat(40),
    });
    const item = renderRow(doc, view, () => {}) as unknown as FakeEl;
    const card = elements(item)[0] as FakeEl;
    expect(card.tag).toBe('div');
    expect(classes(card)).toEqual(expect.arrayContaining(['row', 'card', 'journal-row']));
    const text = elements(card).find((c) => classes(c).includes('journal-text'));
    expect(text).toBeDefined();
    expect(classes(text as FakeEl)).toContain('plan');
  });

  it('builds a parsed row as a card too: a line of facts, then the text', () => {
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
    const card = elements(renderRow(doc, view, () => {}) as unknown as FakeEl)[0] as FakeEl;
    expect(classes(card)).toEqual(expect.arrayContaining(['row', 'card']));
    expect(classes(card)).not.toContain('journal-row');
    expect(elements(card).map((c) => classes(c)[0])).toEqual(['meta', 'plan']);
    const meta = elements(card)[0] as FakeEl;
    expect(elements(meta).map((c) => classes(c)[0])).toEqual([
      'agent',
      'tier',
      'outcome',
      'wake',
      'acts',
    ]);
    // The entry's controls sit together at the end of the line; with no clipboard, only the time.
    const acts = elements(meta)[4] as FakeEl;
    expect(elements(acts).map((c) => classes(c)[0])).toEqual(['when']);
  });
});

describe('app.css', () => {
  const base = baseRules(FLAT).replace(/\s+/g, ' ');

  it('lays a row out as one stacked card at every width: no grid columns to undo on a phone', () => {
    expect(FLAT).not.toMatch(/\.row[^{]*\{[^}]*grid-template-columns/);
    expect(declarations(base, '.meta')).toMatch(/display: flex/);
    expect(declarations(base, '.meta')).toMatch(/flex-wrap: wrap/);
    // The controls wrap as one piece, so "Copy" never parts from the time on a narrow screen.
    expect(declarations(base, '.meta .acts')).toMatch(/white-space: nowrap/);
    expect(declarations(base, '.meta .acts')).toMatch(/margin-left: auto/);
  });

  it('gives the text cell its own line, keeps its line breaks and breaks long words, at every width', () => {
    const body = declarations(base, '.row .plan');
    expect(body).toMatch(/display: block/);
    expect(body).toMatch(/white-space: pre-wrap/);
    expect(body).toMatch(/overflow-wrap: anywhere/);
    // A long name or wake reason wraps too.
    expect(declarations(base, '.meta span')).toMatch(/overflow-wrap: anywhere/);
  });

  it('sets fields to 16px at every width, so the phone does not zoom on focus', () => {
    expect(declarations(base, 'input, select')).toMatch(/font-size: 1rem/);
  });

  it('keeps the 16px side gutter on the body', () => {
    expect(declarations(base, 'body')).toMatch(/padding: 1\.5rem 1rem 4rem/);
  });

  it('never narrows the page with a fixed width: the reading column is a max-width', () => {
    expect(declarations(base, 'body')).toMatch(/max-width: 42rem/);
    expect(declarations(base, 'body')).not.toMatch(/(^|[; ])width:/);
  });

  it('gives the dark and light colours one token set, and uses no colour outside it', () => {
    expect(CSS).toMatch(/--rule: #d1d5db/);
    expect(CSS).toMatch(/prefers-color-scheme: dark/);
    const light = declarations(base, ':root');
    const dark = declarations(
      FLAT.slice(FLAT.indexOf(':root', FLAT.indexOf('prefers-color-scheme: dark'))),
      ':root',
    );
    const tokens = (block: string): string[] =>
      [...block.matchAll(/(--[a-z-]+):/g)].map((m) => m[1] as string);
    expect(tokens(light).length).toBeGreaterThan(0);
    expect(tokens(dark)).toEqual(tokens(light));
    const rest = FLAT.replace(/:root \{[^}]*\}/g, '');
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('index.html', () => {
  it('has a phone viewport and keeps the read-only banner', () => {
    expect(HTML).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(HTML).toContain('Read-only. For human observers only.');
  });

  it('puts search first among the filters and folds the debugging filters away', () => {
    const filters = HTML.slice(HTML.indexOf('class="filters"'));
    expect(filters.indexOf('id="f-keyword"')).toBeLessThan(filters.indexOf('id="f-agent"'));
    const folded = filters.slice(filters.indexOf('<details'), filters.indexOf('</details>'));
    expect(folded).toContain('id="f-outcome"');
    expect(folded).toContain('id="f-template"');
    expect(folded).not.toContain('id="f-keyword"');
  });
});

it('offers a closed About disclosure under the banner with only two fixed links', () => {
  const about = HTML.slice(HTML.indexOf('<details class="about">'), HTML.indexOf('</header>'));
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
  expect(HTML.match(/<a\s/g)).toHaveLength(2);
});
it('sets the tier apart from the "died" tag with the same dot as the other facts', () => {
  const base = baseRules(FLAT).replace(/\s+/g, ' ');
  const dot = declarations(base, '.meta .outcome::before, .meta .wake::before');
  expect(dot).toMatch(/content: "\\00b7\\00a0"/);
  expect(declarations(base, '.meta .died + .tier::before')).toBe(dot);
});

it('keeps receipt columns readable inside their own scrolling container', () => {
  const base = baseRules(FLAT).replace(/\s+/g, ' ');
  expect(declarations(base, '.receipts')).toMatch(/overflow-x: auto/);
  expect(declarations(base, '.receipts table')).toMatch(/width: max-content/);
  expect(declarations(base, '.receipts th, .receipts td')).toMatch(/white-space: nowrap/);
  expect(
    declarations(base, '.receipts th:nth-child(n + 4), .receipts td:nth-child(n + 4)'),
  ).toMatch(/text-align: right/);
  expect(
    declarations(base, '.receipts th:nth-child(n + 4), .receipts td:nth-child(n + 4)'),
  ).toMatch(/font-variant-numeric: tabular-nums/);
});

it('provides text-only link preview metadata', () => {
  const description =
    'A read-only view of what the AI agents living in Geldar, a Minecraft world, think and write.';
  for (const tag of [
    `name="description" content="${description}"`,
    'property="og:title" content="Glass: Thought Stream"',
    `property="og:description" content="${description}"`,
    'property="og:type" content="website"',
    'name="twitter:card" content="summary"',
    'name="color-scheme" content="light dark"',
  ])
    expect(HTML.replace(/\s+/g, ' ')).toContain(tag);
  expect(HTML).not.toMatch(/<meta[^>]*(?:image|og:url)|<link[^>]*(?:image|icon)/i);
});
