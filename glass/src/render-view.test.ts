import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { HOSTILE, hostileRow, plainRow } from './render-fixtures.ts';
import { copyText, display, toView } from './render-model.ts';
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
  'MARK',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
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

describe('renderRow with a search keyword', () => {
  it('marks each match in the name, the wake reason and the text, and nothing else', () => {
    const doc = freshDoc();
    const view = toView({
      ...plainRow(1),
      name: 'Pitman',
      wake_reason: 'fell in a pit',
      parsed: { plan: 'Leave the PIT. Avoid pits.' },
    });
    const row = renderRow(doc as unknown as Doc, view, () => {}, { keyword: 'pit' });
    (doc.body as unknown as El).append(row as unknown as El);
    auditTree(doc.body);
    const marks = Array.from(doc.body.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toEqual(['Pit', 'pit', 'PIT', 'pit']);
    expect(doc.body.querySelector('.plan')?.textContent).toBe('Leave the PIT. Avoid pits.');
    expect(doc.body.querySelector('.tier mark, .outcome mark, .when mark')).toBeNull();
  });

  it('builds no mark without a keyword', () => {
    const doc = bodyWithRow('a pit', 0);
    expect(doc.querySelectorAll('mark').length).toBe(0);
  });

  it('keeps hostile text as text when a keyword inside it is marked', () => {
    for (const [index, value] of HOSTILE.entries()) {
      for (const keyword of ['alert', 'x', '<', value.slice(0, 12)]) {
        const doc = freshDoc();
        const view = toView(hostileRow(value, index));
        const row = renderRow(doc as unknown as Doc, view, () => {}, { keyword });
        (doc.body as unknown as El).append(row as unknown as El);
        auditTree(doc.body);
        expect(doc.body.innerHTML).not.toMatch(/<(script|img|svg|iframe|a|style)[\s>]/i);
        expect(doc.body.querySelector('.plan')?.textContent).toBe(display(value));
        for (const mark of Array.from(doc.body.querySelectorAll('mark'))) {
          expect(mark.children.length).toBe(0);
        }
      }
    }
  });
});

describe('renderRow layout', () => {
  it('shows the time in the button that opens the detail, and leaves the debugging fields to the detail', () => {
    const doc = freshDoc();
    const view = toView({ ...plainRow(2), prompt_template_version: 'v-template', latency_ms: 812 });
    const row = renderRow(doc as unknown as Doc, view, () => {}, {
      nowMs: Date.parse('2026-11-10T00:00:00.000Z'),
    });
    (doc.body as unknown as El).append(row as unknown as El);
    expect(doc.body.querySelectorAll('button').length).toBe(1);
    expect(doc.body.querySelector('button.when')?.textContent).toMatch(/\d{1,2}.\d\d.*, details$/);
    // The text is not inside a button, so a reader can select and copy it.
    expect(doc.body.querySelector('button .plan')).toBeNull();
    expect(doc.body.textContent).not.toContain('v-template');
    expect(doc.body.textContent).not.toContain('812');
    const detail = renderDetail(doc as unknown as Doc, view, []);
    (doc.body as unknown as El).append(detail as unknown as El);
    expect(doc.body.querySelector('.detail')?.textContent).toContain('v-template');
    expect(doc.body.querySelector('.detail')?.textContent).toContain('812 ms');
  });

  it('shows a time that did not parse as it came', () => {
    const doc = freshDoc();
    const row = renderRow(
      doc as unknown as Doc,
      toView({ thought_id: 't', at: 'not a time' }),
      () => {},
    );
    (doc.body as unknown as El).append(row as unknown as El);
    expect(doc.body.querySelector('button.when')?.textContent).toContain('not a time');
  });

  it('labels a parsed thought "thought" and an unparsed one "unparsed"', () => {
    const doc = freshDoc();
    const parsed = renderRow(doc as unknown as Doc, toView(plainRow(1)), () => {});
    const unparsed = renderRow(
      doc as unknown as Doc,
      toView({ ...plainRow(2), parsed: null }),
      () => {},
    );
    (doc.body as unknown as El).append(parsed as unknown as El, unparsed as unknown as El);
    const labels = Array.from(doc.body.querySelectorAll('.outcome')).map((n) => n.textContent);
    expect(labels).toEqual(['thought', 'unparsed']);
    expect(doc.body.querySelector('.outcome.unparsed')).not.toBeNull();
  });
});

describe('renderRow with a copy button', () => {
  it('has no "Copy" button unless the page can copy', () => {
    const doc = bodyWithRow('plain', 0);
    expect(doc.querySelector('button.copy')).toBeNull();
  });

  it('hands the entry as plain text to the callback on a press, and shows the label it is told', () => {
    const doc = freshDoc();
    const view = toView(plainRow(4));
    const copied: string[] = [];
    let say: (label: string) => void = () => {};
    const row = renderRow(doc as unknown as Doc, view, () => {}, {
      onCopy: (text, setLabel) => {
        copied.push(text);
        say = setLabel;
      },
    });
    (doc.body as unknown as El).append(row as unknown as El);
    auditTree(doc.body);
    const copy = doc.body.querySelector('button.copy');
    expect(copy?.textContent).toBe('Copy');
    expect(copied).toEqual([]);
    (copy as unknown as { click(): void }).click();
    expect(copied).toEqual([copyText(view)]);
    say('Copied');
    expect(copy?.textContent).toBe('Copied');
    // The controls sit together: "Copy", then the time.
    const acts = Array.from(doc.body.querySelectorAll('.acts > button')).map((b) => b.className);
    expect(acts).toEqual(['copy', 'when']);
  });

  it('copies hostile text as the text on the page, never as markup', () => {
    for (const [index, value] of HOSTILE.entries()) {
      const doc = freshDoc();
      const copied: string[] = [];
      const row = renderRow(doc as unknown as Doc, toView(hostileRow(value, index)), () => {}, {
        onCopy: (text) => copied.push(text),
      });
      (doc.body as unknown as El).append(row as unknown as El);
      auditTree(doc.body);
      (doc.body.querySelector('button.copy') as unknown as { click(): void }).click();
      expect(copied).toHaveLength(1);
      expect(copied[0]).toContain(display(value));
    }
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

it('renders receipt headers and five text cells per row, with empty nulls', () => {
  const doc = freshDoc();
  const detail = renderDetail(doc as unknown as Doc, toView(plainRow(1)), [
    { kind: 'place', phase: 'committed', item: '<img>\u202E', count: 4, credits: 0 },
    { kind: 'move', phase: 'aborted', item: null, count: null, credits: null },
  ]);
  (doc.body as unknown as El).append(detail);
  auditTree(doc.body);
  expect([...doc.querySelectorAll('thead th')].map((n) => n.textContent)).toEqual([
    'Kind',
    'Phase',
    'Item',
    'Count',
    'Credits',
  ]);
  expect(
    [...doc.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((n) => n.textContent),
    ),
  ).toEqual([
    ['place', 'committed', '<img>[U+202E]', '4', '0'],
    ['move', 'aborted', '', '', ''],
  ]);
  expect(doc.querySelector('img')).toBeNull();
});
