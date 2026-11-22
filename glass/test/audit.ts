/**
 * The audit the render tests share: every element and attribute the page builds itself. A value from the
 * world can never add a tag or an attribute outside these lists. Used by the render tests only; the
 * browser never loads this file.
 */
import { Window } from 'happy-dom';
import { expect } from 'vitest';

/** Every tag the render modules build. */
export const ALLOWED_TAGS = new Set([
  'LI',
  'OL',
  'BUTTON',
  'SPAN',
  'DL',
  'DT',
  'DD',
  'SECTION',
  'H2',
  'H3',
  'P',
  'DIV',
  'MARK',
  'CANVAS',
]);

/**
 * Attributes the render modules set. Each holds a fixed word or a number the page computed (a canvas is 7
 * by 7), never text from the world.
 */
export const ALLOWED_ATTRS = new Set([
  'class',
  'type',
  'width',
  'height',
  'aria-hidden',
  'aria-current',
  'aria-live',
  'aria-pressed',
]);

export interface AuditNode {
  tagName: string;
  attributes: ArrayLike<{ name: string }>;
}

/** Lists every element under a root, failing on any tag or attribute the page does not build. */
export function auditTree(root: {
  querySelectorAll(selector: string): ArrayLike<AuditNode>;
}): string[] {
  const tags: string[] = [];
  for (const node of Array.from(root.querySelectorAll('*'))) {
    expect(ALLOWED_TAGS.has(node.tagName), `unexpected element ${node.tagName}`).toBe(true);
    for (const attr of Array.from(node.attributes)) {
      expect(
        ALLOWED_ATTRS.has(attr.name),
        `unexpected attribute ${attr.name} on ${node.tagName}`,
      ).toBe(true);
    }
    tags.push(node.tagName);
  }
  return tags;
}

export function freshDoc() {
  return new Window().document;
}
