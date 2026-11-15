import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The time-of-day dial's placement (BM-15, geldar.css): top right, below BlueMap's control bar (y 8..40), and left of
// the chat panel on a wide screen. On a narrow screen the chat panel is at the bottom, so the dial takes the right 12px.
// These tests read the stylesheet text; they do not render it. The chat panel's right offset and width are read from
// its rule, so the arithmetic follows the stylesheet.

const css = readFileSync(join(import.meta.dirname, '..', 'web', 'geldar.css'), 'utf8');

const NARROW = '@media (max-width: 600px) {';
const CONTROL_BAR_BOTTOM = 40;

// The text of the narrow media block, from its opening brace to the matching closing brace.
function narrowBlock(source: string): string {
  const start = source.indexOf(NARROW);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start + NARROW.length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start + NARROW.length, i);
    }
  }
  return '';
}

// Everything outside the narrow media block: the wide-screen and landscape rules.
function wideRules(source: string): string {
  const start = source.indexOf(NARROW);
  if (start < 0) return source;
  const block = narrowBlock(source);
  return source.slice(0, start) + source.slice(start + NARROW.length + block.length + 1);
}

// The declarations of the rule for a selector, or '' when there is no such rule.
function body(scope: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped} \\{([^}]*)\\}`).exec(scope);
  return match?.[1] ?? '';
}

// The value of a px declaration in a rule body, e.g. right: 324px; gives 324. Throws when there is none.
function px(rule: string, prop: string): number {
  const match = new RegExp(`(?:^|[\\s;])${prop}: (\\d+)px;`).exec(rule);
  if (!match) throw new Error(`no ${prop}: <n>px; in the rule`);
  return Number(match[1]);
}

// The top of a rule in px: a plain Npx, or calc(Apx + Bpx) summed.
function topPx(rule: string): number {
  const sum = /(?:^|[\s;])top: calc\((\d+)px \+ (\d+)px\);/.exec(rule);
  if (sum) return Number(sum[1]) + Number(sum[2]);
  return px(rule, 'top');
}

const wide = wideRules(css);
// The narrow block of the dial. The chat panel has its own narrow block earlier in the file, so the search starts at
// the dial's rule.
const narrow = narrowBlock(css.slice(css.indexOf('#geldar-sky {')));

describe('dial placement: wide screens and landscape', () => {
  const dial = body(wide, '#geldar-sky');
  const chat = body(wide, '#geldar-chat');

  it('sits 16px below the control bar: top calc(40px + 16px), which is 56px', () => {
    expect(dial).toMatch(/(^|[\s;])top: calc\(40px \+ 16px\);/);
    expect(topPx(dial)).toBe(56);
  });

  it('sits left of the chat panel: right 324px', () => {
    expect(px(dial, 'right')).toBe(324);
  });

  it('clears the chat panel: its right offset plus its width is at most the dial right', () => {
    const chatEdge = px(chat, 'right') + px(chat, 'width');
    expect(chatEdge).toBe(312);
    expect(px(dial, 'right')).toBeGreaterThanOrEqual(chatEdge);
  });

  it('sits below the control bar: the dial top is at least the bar bottom', () => {
    expect(topPx(dial)).toBeGreaterThanOrEqual(CONTROL_BAR_BOTTOM);
  });
});

describe('dial placement: narrow screens', () => {
  const dial = body(narrow, '#geldar-sky');

  it('has a narrow media query with a dial rule', () => {
    expect(narrow.length).toBeGreaterThan(0);
    expect(dial.length).toBeGreaterThan(0);
  });

  it('takes the right 12px, 56 by 32', () => {
    expect(px(dial, 'right')).toBe(12);
    expect(px(dial, 'width')).toBe(56);
    expect(px(dial, 'height')).toBe(32);
  });
});
