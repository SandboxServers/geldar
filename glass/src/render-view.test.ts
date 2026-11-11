import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { HOSTILE, hostileRow, plainRow } from './render-fixtures.ts';
import { display, toView } from './render-model.ts';
import { type Doc, type El, fillAgentOptions, renderDetail, renderRow } from './render-view.ts';

/** Every tag the page builds itself. A data value can never add a tag outside this list. */
const ALLOWED_TAGS = new Set([
  'UL',
  'LI',
  'BUTTON',
  'SPAN',
  'DL',
  'DT',
  'DD',
  'SECTION',
  'H3',
  'PRE',
  'P',
  'SELECT',
  'OPTION',
  'DIV',
]);
/** Attributes the page sets. `value` on an option holds an index, never data. */
const ALLOWED_ATTRS = new Set(['class', 'type', 'value']);

interface AuditNode {
  tagName: string;
  attributes: ArrayLike<{ name: string }>;
}

/** Lists every element under a root, failing on any tag or attribute the page does not build. */
function auditTree(root: { querySelectorAll(selector: string): ArrayLike<AuditNode> }): string[] {
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

function freshDoc() {
  const win = new Window();
  return win.document;
}

/** The row for a fixture, appended to a fresh body. Returns the body for auditing. */
function bodyWithRow(value: string, index: number) {
  const doc = freshDoc();
  const row = renderRow(doc as unknown as Doc, toView(hostileRow(value, index)), () => {});
  (doc.body as unknown as El).append(row as unknown as El);
  return doc;
}

describe('renderRow with hostile data', () => {
  it('builds only the page own elements, and shows each value as text', () => {
    const plainCount = auditTree(bodyWithRow('plain', 0).body).length;
    for (const [index, value] of HOSTILE.entries()) {
      const doc = bodyWithRow(value, index);
      expect(auditTree(doc.body).length, value.slice(0, 30)).toBe(plainCount);
      expect(doc.body.innerHTML).not.toMatch(/<(script|img|svg|iframe|a|style)[\s>]/i);
      const row = doc.body.querySelector('li');
      expect(row?.textContent).toContain(display(value).slice(0, 40));
    }
  });

  it('builds no link, image or script from a javascript: URL or an onerror attribute', () => {
    const doc = bodyWithRow('javascript:alert(1)', 0);
    expect(doc.querySelectorAll('a[href]').length).toBe(0);
    const doc2 = bodyWithRow('<img src=x onerror="alert(1)">', 1);
    expect(doc2.querySelectorAll('img').length).toBe(0);
    expect(doc2.querySelectorAll('[onerror]').length).toBe(0);
    expect(doc2.body.querySelector('li')?.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('fires the open callback with the thought id when the row is pressed', () => {
    const doc = freshDoc();
    const seen: string[] = [];
    const row = renderRow(doc as unknown as Doc, toView(hostileRow('<b>x</b>', 7)), (id) =>
      seen.push(id),
    );
    (doc.body as unknown as El).append(row as unknown as El);
    doc.body.querySelector('button')?.click();
    expect(seen).toEqual(['t-7']);
  });
});

describe('renderDetail with hostile data', () => {
  it('shows the receipts as text, with the same element set', () => {
    for (const [index, value] of HOSTILE.entries()) {
      const doc = freshDoc();
      const receipts = [{ kind: value, phase: value, item: value, count: 1, credits: 2 }];
      const section = renderDetail(
        doc as unknown as Doc,
        toView(hostileRow(value, index)),
        receipts,
      );
      (doc.body as unknown as El).append(section as unknown as El);
      auditTree(doc.body);
      expect(doc.body.innerHTML).not.toMatch(/<(script|img|svg|iframe|a|style)[\s>]/i);
      expect(doc.body.querySelector('pre')).toBeNull();
      expect(doc.body.textContent).toContain(display(value).slice(0, 40));
    }
  });
});

describe('fillAgentOptions', () => {
  it('uses an index as each option value and the name only as text', () => {
    const doc = freshDoc();
    const select = doc.createElement('select');
    fillAgentOptions(doc as unknown as Doc, select as unknown as El, HOSTILE);
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.length).toBe(HOSTILE.length + 1);
    for (const option of options.slice(1)) {
      expect(option.getAttribute('value')).toMatch(/^\d+$/);
    }
    expect(options[1]?.textContent).toBe(display(HOSTILE[0] ?? ''));
    auditTree(select as unknown as { querySelectorAll(s: string): ArrayLike<AuditNode> });
  });
});

describe('plainRow', () => {
  it('is the baseline shape for the audit', () => {
    expect(plainRow(3).thought_id).toBe('t-3');
  });
});
