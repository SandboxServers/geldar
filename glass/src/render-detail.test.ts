import { describe, expect, it } from 'vitest';
import { auditTree, freshDoc } from '../test/audit.ts';
import { COPY_LABEL, renderDetail, renderReaderHead } from './render-detail.ts';
import { HOSTILE, hostileRow, plainRow } from './render-fixtures.ts';
import { copyText, display, toView } from './render-model.ts';
import { type Doc, type El, JOURNAL_LINE, UNPARSED_LINE } from './render-view.ts';

type Body = ReturnType<typeof freshDoc>['body'];

/** The detail of a view in a fresh body. */
function bodyWithDetail(
  ...args: Parameters<typeof renderDetail> extends [Doc, ...infer R] ? R : never
) {
  const doc = freshDoc();
  (doc.body as unknown as El).append(renderDetail(doc as unknown as Doc, ...args));
  return doc.body;
}

/** The label and value pairs of the facts list, as text. */
function facts(body: Body): [string, string][] {
  const labels = Array.from(body.querySelectorAll('dl.facts dt')).map((n) => n.textContent);
  const values = Array.from(body.querySelectorAll('dl.facts dd')).map((n) => n.textContent);
  return labels.map((label, i) => [label, values[i] ?? '']);
}

describe('renderDetail', () => {
  it('lists the facts the row leaves out: world day, tick, tier, latency, template and the exact time', () => {
    const view = toView({
      ...plainRow(1),
      world_tick: '16463',
      prompt_template_version: 'mind-v4.2',
    });
    expect(facts(bodyWithDetail(view, null))).toEqual([
      ['world day', '3'],
      ['tick', '16,463'],
      ['tier', 'local'],
      ['latency', '812 ms'],
      ['template', 'mind-v4.2'],
      ['written', '2026-11-10T00:00:00.000Z'],
    ]);
  });

  it('shows a dash for what an entry does not carry: a journal line, and a live frame before its facts load', () => {
    const journal = toView({
      thought_id: 'j',
      name: 'Vesper',
      tier: 'local',
      kind: 'journal',
      text: 'x',
    });
    expect(facts(bodyWithDetail(journal, [])).map(([, value]) => value)).toEqual([
      '—',
      '—',
      'local',
      '—',
      '—',
      '—',
    ]);
    const frame = toView({ thought_id: 't', at: '2026-11-10T00:00:00.000Z', wake_reason: 'w' });
    expect(
      facts(bodyWithDetail(frame, null))
        .slice(0, 5)
        .map(([, value]) => value),
    ).toEqual(['—', '—', '—', '—', '—']);
  });

  it('adds when and how a dead agent died, the cause as text in the warning colour', () => {
    const body = bodyWithDetail(toView(plainRow(1)), null, {
      death: { died_at: '2026-11-11', death_cause: '<img>‮' },
    });
    expect(facts(body).slice(-2)).toEqual([
      ['died', '2026-11-11'],
      ['cause', '<img>[U+202E]'],
    ]);
    expect(body.querySelector('dd.bad')?.textContent).toBe('<img>[U+202E]');
    expect(body.querySelector('img')).toBeNull();
  });

  it('shows each receipt as what was done, how it ended and its credits, coloured by the phase', () => {
    const body = bodyWithDetail(toView(plainRow(1)), [
      { kind: 'place', phase: 'committed', item: '<img>‮', count: 4, credits: 0 },
      { kind: 'move', phase: 'aborted', item: null, count: null, credits: null },
      { kind: 'craft', phase: 'prepared', item: 'bread', count: 1, credits: 3 },
    ]);
    auditTree(body);
    expect(body.querySelector('h3')?.textContent).toBe('receipts — what the body actually did');
    const cells = Array.from(body.querySelectorAll('.receipts > span')).map((n) => [
      n.className,
      n.textContent,
    ]);
    expect(cells).toEqual([
      ['did', 'place <img>[U+202E] ×4'],
      ['outcome ok', 'committed'],
      ['amount', '0 cr'],
      ['did', 'move'],
      ['outcome bad', 'aborted'],
      ['amount', ''],
      ['did', 'craft bread'],
      ['outcome other', 'prepared'],
      ['amount', '3 cr'],
    ]);
    expect(body.querySelector('img')).toBeNull();
  });

  it('says so when an action left no receipt, and says nothing when the entry names no action', () => {
    const none = bodyWithDetail(toView(plainRow(1)), []);
    expect(none.querySelector('.none')?.textContent).toBe(
      'No receipts: nothing was done with this entry.',
    );
    expect(none.querySelector('.receipts, h3')).toBeNull();
    // null: the page does not know. A missing answer is never shown as "nothing was done".
    const unknown = bodyWithDetail(toView(plainRow(1)), null);
    expect(unknown.querySelector('.none, .receipts, h3')).toBeNull();
  });

  it('shows hostile receipts as text, with the same element set', () => {
    for (const [index, value] of HOSTILE.entries()) {
      const receipts = [{ kind: value, phase: value, item: value, count: 1, credits: 2 }];
      const body = bodyWithDetail(toView(hostileRow(value, index)), receipts);
      auditTree(body);
      expect(body.innerHTML).not.toMatch(/<(script|img|svg|iframe|a|style)[\s>]/i);
      expect(body.textContent).toContain(display(value).slice(0, 40));
      // A phase the page does not know gets no colour of its own: it is world text, not a class.
      expect(body.querySelector('.outcome')?.className).toBe('outcome other');
    }
  });

  it('has no copy button unless the page can copy', () => {
    expect(bodyWithDetail(toView(plainRow(1)), null).querySelector('button')).toBeNull();
  });

  it('hands the entry as plain text to the callback on a press, and shows the label it is told', () => {
    const view = toView(plainRow(4));
    const copied: string[] = [];
    let say: (label: string) => void = () => {};
    const body = bodyWithDetail(view, null, {
      onCopy: (text, setLabel) => {
        copied.push(text);
        say = setLabel;
      },
    });
    auditTree(body);
    const copy = body.querySelector('button.copy');
    expect(copy?.textContent).toBe(COPY_LABEL);
    expect(COPY_LABEL).toBe('Copy entry');
    expect(copied).toEqual([]);
    (copy as unknown as { click(): void }).click();
    expect(copied).toEqual([copyText(view)]);
    say('Copied');
    expect(copy?.textContent).toBe('Copied');
  });

  it('copies hostile text as the text on the page, never as markup', () => {
    for (const [index, value] of HOSTILE.entries()) {
      const copied: string[] = [];
      const body = bodyWithDetail(toView(hostileRow(value, index)), null, {
        onCopy: (text) => copied.push(text),
      });
      auditTree(body);
      (body.querySelector('button.copy') as unknown as { click(): void }).click();
      expect(copied).toHaveLength(1);
      expect(copied[0]).toContain(display(value));
    }
  });
});

describe('renderReaderHead', () => {
  function head(
    ...args: Parameters<typeof renderReaderHead> extends [Doc, ...infer R] ? R : never
  ) {
    const doc = freshDoc();
    (doc.body as unknown as El).append(...renderReaderHead(doc as unknown as Doc, ...args));
    return doc.body;
  }

  it('sets the name large beside a large sigil, then how the mind is run and when', () => {
    const body = head(toView({ ...plainRow(1), name: 'Orrin' }), {
      mode: 'headless',
      nowMs: Date.parse('2026-11-10T00:00:00.000Z'),
    });
    auditTree(body);
    expect(body.querySelector('h2.reader-name')?.textContent).toBe('Orrin');
    expect(body.querySelector('canvas')?.className).toBe('sigil sigil-reader');
    expect(body.querySelector('.reader-sub')?.textContent).toMatch(/^headless · \d{1,2}.\d\d/);
    expect(body.querySelector('.wake')?.textContent).toBe('woke: plain');
    expect(body.querySelector('p.plan')?.textContent).toBe('plain');
  });

  it('says a dead agent died, a journal line was written for itself, and an unparsed reply could not be read', () => {
    const dead = head(toView(plainRow(1)), { death: { died_at: '2026-11-11' } });
    expect(dead.querySelector('.reader-sub')?.textContent).toMatch(/^† died · local/);
    expect(dead.querySelector('canvas')?.className).toBe('sigil sigil-reader dead');
    const journal = head(toView({ thought_id: 'j', name: 'V', kind: 'journal', text: 'a note' }));
    expect(journal.querySelector('.kind')?.textContent).toBe(JOURNAL_LINE);
    expect(journal.querySelector('p.plan')?.className).toBe('plan journal-text');
    const unparsed = head(toView({ ...plainRow(2), parsed: null }));
    expect(unparsed.querySelector('.unparsed')?.textContent).toBe(UNPARSED_LINE);
    expect(unparsed.querySelector('p.plan')).toBeNull();
  });

  it('marks the search keyword, and keeps hostile text as text', () => {
    const marked = head(toView({ ...plainRow(1), parsed: { plan: 'Avoid pits.' } }), {
      keyword: 'pit',
    });
    expect(Array.from(marked.querySelectorAll('mark')).map((m) => m.textContent)).toEqual(['pit']);
    for (const [index, value] of HOSTILE.entries()) {
      const body = head(toView(hostileRow(value, index)), { keyword: 'alert' });
      auditTree(body);
      expect(body.innerHTML).not.toMatch(/<(script|img|svg|iframe|a|style)[\s>]/i);
      expect(body.querySelector('p.plan')?.textContent).toBe(display(value));
    }
  });
});
