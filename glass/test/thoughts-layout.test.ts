/**
 * The Thought Stream page on a phone. Layout is CSS, so this reads public/app.css and checks the
 * narrow-screen block: rows become stacked cards, the text cell wraps long words and keeps its
 * line breaks, inputs are 16px so iOS does not zoom, and the page has a phone viewport. The rows
 * are built with the shipped render code, so the class names checked here are the ones on screen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toView } from '../src/render-model.ts';
import { type Doc, renderRow } from '../src/render-view.ts';

const PUBLIC = new URL('../public/', import.meta.url);
const CSS = readFileSync(new URL('app.css', PUBLIC), 'utf8');
const HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');

/** The body of the narrow-screen block, with whitespace collapsed. */
function phoneBlock(css: string): string {
  const start = css.indexOf('@media (max-width: 700px)');
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i).replace(/\s+/g, ' ');
    }
  }
  return '';
}

/** The declarations of one rule in a block. The selector must match exactly, after whitespace is collapsed. */
function declarations(block: string, selector: string): string {
  const at = block.indexOf(`${selector} {`);
  if (at < 0) return '';
  return block.slice(at + selector.length + 2, block.indexOf('}', at));
}

class FakeEl {
  className = '';
  textContent: string | null = '';
  type = '';
  value = '';
  children: FakeEl[] = [];
  private handler: (() => void) | undefined;
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeEl[]): void {
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

describe('thought rows on a phone', () => {
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
    const button = item.children[0] as FakeEl;
    expect(classes(button)).toEqual(expect.arrayContaining(['row', 'card', 'journal-row']));
    const text = button.children.find((c) => classes(c).includes('journal-text'));
    expect(text).toBeDefined();
    expect(classes(text as FakeEl)).toContain('plan');
  });

  it('builds a parsed row as a card too', () => {
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
    const button = (renderRow(doc, view, () => {}) as unknown as FakeEl).children[0] as FakeEl;
    expect(classes(button)).toEqual(expect.arrayContaining(['row', 'card']));
    expect(classes(button)).not.toContain('journal-row');
  });
});

describe('app.css narrow-screen block', () => {
  const block = phoneBlock(CSS);

  it('has a block under 700px', () => {
    expect(block).not.toBe('');
  });

  it('lays each row out as a wrapping card, not the desktop grid', () => {
    expect(declarations(block, '.row')).toMatch(/display: flex/);
    expect(declarations(block, '.row')).toMatch(/flex-wrap: wrap/);
    expect(declarations(block, '.row.journal-row')).toMatch(/grid-template-columns: none/);
  });

  it('wraps the text cell at full width, keeps its line breaks and breaks long words', () => {
    for (const selector of ['.row .plan', '.row .journal-text']) {
      const body = declarations(block, selector);
      expect(body, selector).toMatch(/flex-basis: 100%/);
      expect(body, selector).toMatch(/white-space: pre-wrap/);
      expect(body, selector).toMatch(/overflow-wrap: anywhere/);
    }
  });

  it('sets form controls to 16px so the phone does not zoom on focus', () => {
    expect(declarations(block, '.filters input, .filters select, .filters button')).toMatch(
      /font-size: 1rem/,
    );
  });

  it('keeps the 16px side gutter on the body', () => {
    expect(declarations(block, 'body')).toMatch(/padding: 1rem/);
  });

  it('gives the dark and light colours one token set', () => {
    expect(CSS).toMatch(/--rule: #d1d5db/);
    expect(CSS).toMatch(/prefers-color-scheme: dark/);
  });
});

describe('index.html', () => {
  it('has a phone viewport and keeps the read-only banner', () => {
    expect(HTML).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(HTML).toContain('Read-only. For human observers only.');
  });
});
