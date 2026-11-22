import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { auditTree, freshDoc } from '../test/audit.ts';
import { HOSTILE, hostileRow, plainRow } from './render-fixtures.ts';
import { display, toView } from './render-model.ts';
import {
  type Doc,
  type El,
  JOURNAL_LINE,
  renderChips,
  renderRow,
  UNPARSED_LINE,
} from './render-view.ts';

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

  it('fires the open callback with the thought id when the time is pressed', () => {
    const doc = freshDoc();
    const seen: string[] = [];
    const row = renderRow(doc as unknown as Doc, toView(hostileRow('<b>x</b>', 7)), (id) =>
      seen.push(id),
    );
    (doc.body as unknown as El).append(row as unknown as El);
    doc.body.querySelector('button')?.click();
    expect(seen).toEqual(['t-7']);
  });

  it('fires the select callback on a press anywhere in the row, and has none without one', () => {
    const doc = freshDoc();
    const selected: string[] = [];
    const row = renderRow(doc as unknown as Doc, toView(plainRow(7)), () => {}, {
      onSelect: (id) => selected.push(id),
    });
    (doc.body as unknown as El).append(row as unknown as El);
    (doc.body.querySelector('.plan') as unknown as { click(): void }).click();
    expect(selected).toEqual(['t-7']);
    // The time is inside the row: its press selects too.
    doc.body.querySelector('button')?.click();
    expect(selected).toEqual(['t-7', 't-7']);
  });

  it('draws the sigil of the agent as a hidden canvas of fixed size: the name is hashed, never written', () => {
    for (const [index, value] of HOSTILE.entries()) {
      const canvas = bodyWithRow(value, index).body.querySelector('canvas');
      expect(canvas?.getAttribute('class')).toBe('sigil sigil-row');
      expect(canvas?.getAttribute('aria-hidden')).toBe('true');
      expect(canvas?.getAttribute('width')).toBe('7');
      expect(canvas?.getAttribute('height')).toBe('7');
      expect(canvas?.attributes.length).toBe(4);
    }
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
    expect(doc.body.querySelector('.mode mark, .when mark')).toBeNull();
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
  it('shows the time in the one button, which opens the detail, and leaves the debugging fields out', () => {
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

  it('says what woke a thought, and for a reply that did not parse, that the body could not read it', () => {
    const doc = freshDoc();
    const parsed = renderRow(doc as unknown as Doc, toView(plainRow(1)), () => {});
    const unparsed = renderRow(
      doc as unknown as Doc,
      toView({ ...plainRow(2), parsed: null }),
      () => {},
    );
    (doc.body as unknown as El).append(parsed as unknown as El, unparsed as unknown as El);
    const rows = Array.from(doc.body.querySelectorAll('li'));
    expect(rows[0]?.querySelector('.wake')?.textContent).toBe('woke: plain');
    expect(rows[0]?.querySelector('.unparsed')).toBeNull();
    expect(rows[0]?.querySelector('.plan')?.textContent).toBe('plain');
    // An unparsed thought has no text: the fixed sentence stands where the text would be.
    expect(rows[1]?.querySelector('.wake')?.textContent).toBe('woke: plain');
    expect(rows[1]?.querySelector('.unparsed')?.textContent).toBe(UNPARSED_LINE);
    expect(rows[1]?.querySelector('.plan')).toBeNull();
  });

  it('says a journal entry was written for the agent itself, and gives it no wake line', () => {
    const doc = freshDoc();
    const view = toView({ thought_id: 'j', name: 'Vesper', kind: 'journal', text: 'a note' });
    (doc.body as unknown as El).append(renderRow(doc as unknown as Doc, view, () => {}));
    expect(doc.body.querySelector('.kind')?.textContent).toBe(JOURNAL_LINE);
    expect(doc.body.querySelector('.wake')).toBeNull();
    expect(doc.body.querySelector('.plan')?.className).toBe('plan journal-text');
  });

  it('shows how the mind is run beside the name: the mode from the agents list, else the tier', () => {
    const word = (options: Parameters<typeof renderRow>[3]): string | null => {
      const doc = freshDoc();
      const row = renderRow(doc as unknown as Doc, toView(plainRow(1)), () => {}, options);
      (doc.body as unknown as El).append(row as unknown as El);
      return doc.body.querySelector('.mode')?.textContent ?? null;
    };
    expect(word({ mode: 'headless' })).toBe('headless');
    expect(word({})).toBe('local');
  });

  it('tags a dead agent beside its name and greys its sigil', () => {
    const doc = freshDoc();
    const row = renderRow(doc as unknown as Doc, toView(plainRow(1)), () => {}, {
      death: { died_at: '2026-11-11' },
    });
    (doc.body as unknown as El).append(row as unknown as El);
    expect(doc.body.querySelector('.agent + .died')?.textContent).toBe('† died');
    expect(doc.body.querySelector('canvas')?.className).toBe('sigil sigil-row dead');
    expect(bodyWithRow('plain', 0).body.querySelector('.died')).toBeNull();
  });
});

describe('renderChips', () => {
  function chipsFor(names: string[], selected: number, dead: boolean[] = []) {
    const doc = new Window().document;
    const row = doc.createElement('div');
    const picked: number[] = [];
    const on = renderChips(
      doc as unknown as Doc,
      row as unknown as El,
      names.map((name, index) => ({ name, dead: dead[index] === true })),
      selected,
      (index) => picked.push(index),
    );
    return { row, picked, on };
  }

  it('puts "Everyone" first and then one chip per agent, with the name only as text', () => {
    const { row } = chipsFor(HOSTILE, -1);
    auditTree(row);
    const chips = Array.from(row.querySelectorAll('button.chip'));
    expect(chips.length).toBe(HOSTILE.length + 1);
    expect(chips[0]?.textContent).toBe('Everyone');
    expect(chips[0]?.querySelector('canvas')).toBeNull();
    expect(chips[1]?.querySelector('.chip-name')?.textContent).toBe(display(HOSTILE[0] ?? ''));
    expect(chips[1]?.querySelector('canvas')?.className).toBe('sigil sigil-chip');
    expect(row.innerHTML).not.toMatch(/<(script|img|svg|iframe|a|style)[\s>]/i);
    // No name or id is an attribute: a chip carries its class, its type and whether it is on.
    for (const chip of chips) {
      expect(Array.from(chip.attributes).map((a) => a.name)).toEqual([
        'type',
        'class',
        'aria-pressed',
      ]);
    }
  });

  it('marks the one chip that is on, and returns it', () => {
    const { row, on } = chipsFor(['Ada', 'Bo'], 1);
    const pressed = Array.from(row.querySelectorAll('button')).map((b) => [
      b.className,
      b.getAttribute('aria-pressed'),
    ]);
    expect(pressed).toEqual([
      ['chip', 'false'],
      ['chip', 'false'],
      ['chip on', 'true'],
    ]);
    expect((on as unknown as { textContent: string }).textContent).toBe('Bo');
    const none = chipsFor(['Ada'], -1);
    expect(none.row.querySelector('button.on')?.textContent).toBe('Everyone');
    expect((none.on as unknown as { textContent: string }).textContent).toBe('Everyone');
  });

  it('calls back with the position of the pressed chip, and -1 for "Everyone"', () => {
    const { row, picked } = chipsFor(['Ada', 'Bo'], -1);
    const chips = Array.from(row.querySelectorAll('button'));
    chips[2]?.click();
    chips[0]?.click();
    expect(picked).toEqual([1, -1]);
  });

  it('marks a dead agent with a dagger, says "died" to a screen reader and greys its sigil', () => {
    const { row } = chipsFor(['Ada', 'Mote'], -1, [false, true]);
    const chips = Array.from(row.querySelectorAll('button'));
    expect(chips[1]?.querySelector('.died')).toBeNull();
    expect(chips[2]?.querySelector('.died')?.textContent).toBe('†');
    expect(chips[2]?.querySelector('.sr')?.textContent).toBe(' died');
    expect(chips[2]?.querySelector('canvas')?.className).toBe('sigil sigil-chip dead');
  });
});

describe('plainRow', () => {
  it('is the baseline shape for the audit', () => {
    expect(plainRow(3).thought_id).toBe('t-3');
  });
});
