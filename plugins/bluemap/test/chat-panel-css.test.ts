import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The chat panel's placement (decision 0310, geldar.css). BlueMap's top control bar takes y 8..40 across the
// width, and its zoom buttons sit in a column at the bottom right on a narrow screen. The panel must sit below
// the bar and clear of the zoom column. These tests read the stylesheet text; they do not render it.

const css = readFileSync(join(import.meta.dirname, '..', 'web', 'geldar.css'), 'utf8');

const NARROW = '@media (max-width: 600px) {';

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

describe('chat panel placement: wide screens and landscape', () => {
  const wide = wideRules(css);

  it('sits 56px from the top, below BlueMap control bar (y 8..40)', () => {
    expect(body(wide, '#geldar-chat')).toMatch(/(^|[\s;])top: 56px;/);
  });

  it('caps its height so it stays below the control bar', () => {
    expect(body(wide, '#geldar-chat')).toMatch(/max-height: min\(40vh, calc\(100vh - 68px\)\);/);
  });

  it('keeps the 12px right edge outside the narrow query', () => {
    expect(body(wide, '#geldar-chat')).toMatch(/(^|[\s;])right: 12px;/);
  });
});

describe('chat panel placement: narrow screens', () => {
  const narrow = narrowBlock(css);

  it('has a narrow media query at all', () => {
    expect(narrow.length).toBeGreaterThan(0);
  });

  it('clears the zoom column: right 68px and no right 8px', () => {
    const rule = body(narrow, '#geldar-chat');
    expect(rule).toMatch(/(^|[\s;])right: 68px;/);
    expect(rule).not.toMatch(/right: 8px/);
  });

  it('spans from left 8px with width auto and stays at the bottom', () => {
    const rule = body(narrow, '#geldar-chat');
    expect(rule).toMatch(/(^|[\s;])left: 8px;/);
    expect(rule).toMatch(/(^|[\s;])width: auto;/);
    expect(rule).toMatch(/(^|[\s;])bottom: 12px;/);
    expect(rule).toMatch(/max-height: 35vh;/);
  });
});

describe('chat panel placement: the toggle', () => {
  it('stays at least 40px high (a touch target)', () => {
    expect(body(css, '#geldar-chat .gc-toggle')).toMatch(/min-height: 40px;/);
  });
});
