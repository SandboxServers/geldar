import { describe, expect, it } from 'vitest';
import { HOSTILE, hostileRow } from './render-fixtures.ts';
import {
  appendOlder,
  backoffMs,
  clip,
  copyText,
  countLabel,
  display,
  filterQuery,
  filterThoughts,
  JOURNAL_PREVIEW,
  journalSplit,
  LIST_CAP,
  pushThought,
  splitMatches,
  TEXT_CAP,
  type ThoughtView,
  toView,
  visible,
  whenLabel,
} from './render-model.ts';
import { type Doc, renderRow } from './render-view.ts';

// biome-ignore lint/suspicious/noControlCharactersInRegex: the same controls the page marks
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/u;

function viewAt(id: string, extra: Partial<ThoughtView> = {}): ThoughtView {
  return {
    ...toView({ thought_id: id, life_id: 'kestrel', at: '2026-11-10T00:00:00Z' }),
    ...extra,
  };
}

describe('toView', () => {
  it('keeps hostile text as data, unchanged, in the matching field', () => {
    for (const [index, text] of HOSTILE.entries()) {
      const view = toView(hostileRow(text, index));
      expect(view.agentName).toBe(text);
      expect(view.wakeReason).toBe(text);
      expect(view.templateVersion).toBe(text);
      expect(view.plan).toBe(text);
    }
  });

  it('reads the outcome from parsed: null is unparsed', () => {
    expect(toView({ thought_id: 'a', parsed: null }).outcome).toBe('unparsed');
    expect(toView({ thought_id: 'a' }).outcome).toBe('unparsed');
    expect(toView({ thought_id: 'a', parsed: { plan: 'walk' } }).outcome).toBe('parsed');
  });

  it('turns missing fields into empty text and a null latency', () => {
    const view = toView({ thought_id: 'a' });
    expect(view.agentName).toBe('');
    expect(view.templateVersion).toBe('');
    expect(view.latencyMs).toBeNull();
    expect(Number.isNaN(view.atMs)).toBe(true);
  });
});

describe('visible and clip', () => {
  it('shows bidi overrides, zero-width and NUL characters as markers, never raw', () => {
    for (const text of HOSTILE) {
      expect(CONTROL.test(visible(text.slice(0, TEXT_CAP)))).toBe(false);
    }
    expect(visible('‮evil')).toBe('[U+202E]evil');
    expect(visible('nul\u0000byte')).toBe('nul[U+0000]byte');
  });

  it('marks every other character a reader cannot see: tags, format marks, separators, selectors', () => {
    const hidden: [string, string][] = [
      ['\u{E0041}', '[U+E0041]'], // an invisible "tag" letter, used to smuggle text past a reader
      ['\u{E007F}', '[U+E007F]'],
      ['\u00AD', '[U+00AD]'], // soft hyphen
      ['\u061C', '[U+061C]'], // Arabic letter mark (bidi)
      ['\u2060', '[U+2060]'], // word joiner
      ['\u2028', '[U+2028]'], // line separator
      ['\u2029', '[U+2029]'],
      ['\u0085', '[U+0085]'], // a C1 control
      ['\u180E', '[U+180E]'],
      ['\u034F', '[U+034F]'], // combining grapheme joiner
      ['\uFE00', '[U+FE00]'], // a variation selector that is not the emoji one
      ['\u{E0100}', '[U+E0100]'], // a variation selector supplement
    ];
    for (const [ch, marker] of hidden) {
      expect(visible(`a${ch}b`), marker).toBe(`a${marker}b`);
    }
  });

  it('keeps the emoji selector, so an emoji stays an emoji', () => {
    expect(visible('warn \u26A0\uFE0F done \u2705')).toBe('warn \u26A0\uFE0F done \u2705');
    expect(visible('caf\u00E9 \u65E5\u672C\u8A9E \u0645\u0631\u062D\u0628\u0627')).toBe(
      'caf\u00E9 \u65E5\u672C\u8A9E \u0645\u0631\u062D\u0628\u0627',
    );
  });

  it('keeps ordinary text, including newlines, unchanged', () => {
    expect(visible('line one\nline two\tend')).toBe('line one\nline two\tend');
  });

  it('clips a huge string and says how much it dropped', () => {
    const big = 'x'.repeat(10_000);
    const shown = clip(big);
    expect(shown.startsWith('x'.repeat(TEXT_CAP))).toBe(true);
    expect(shown.length).toBeLessThan(TEXT_CAP + 80);
    expect(shown).toContain('6000 more characters');
    expect(clip('short')).toBe('short');
  });

  it('display clips before it shows markers, so a zero-width run stays bounded', () => {
    const shown = display('​'.repeat(10_000));
    expect(shown.length).toBeLessThan(TEXT_CAP * 10);
    expect(shown).toContain('[U+200B]');
  });
});

describe('filterThoughts', () => {
  const views = [
    toView(hostileRow('<b>walk</b>', 1)),
    toView({ thought_id: 'b', life_id: 'owl', at: '2026-11-01T00:00:00Z', parsed: null }),
    toView({
      thought_id: 'c',
      life_id: 'owl',
      at: '2026-11-09T12:00:00Z',
      parsed: { plan: 'dig' },
      prompt_template_version: 'v2',
    }),
  ];

  it('filters by agent, outcome and template version', () => {
    expect(filterThoughts(views, { agentId: 'owl' }).map((v) => v.id)).toEqual(['b', 'c']);
    expect(filterThoughts(views, { outcome: 'unparsed' }).map((v) => v.id)).toEqual(['b']);
    expect(filterThoughts(views, { templateVersion: 'v2' }).map((v) => v.id)).toEqual(['c']);
  });

  it('filters by a time range', () => {
    const since = Date.parse('2026-11-05T00:00:00Z');
    expect(filterThoughts(views, { sinceMs: since }).map((v) => v.id)).toEqual(['t-1', 'c']);
    expect(filterThoughts(views, {}).length).toBe(3);
  });

  it('matches a keyword literally, case-insensitively, against the text fields', () => {
    expect(filterThoughts(views, { keyword: '<B>WALK' }).map((v) => v.id)).toEqual(['t-1']);
    expect(filterThoughts(views, { keyword: '<script>' })).toEqual([]);
  });
});

describe('the bounded list', () => {
  it('pushes the newest thought first and dedupes by id', () => {
    let list: ThoughtView[] = [];
    list = pushThought(list, viewAt('a'));
    list = pushThought(list, viewAt('b'));
    list = pushThought(list, viewAt('a'));
    expect(list.map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest once the list is at its cap, and never grows past it', () => {
    let list: ThoughtView[] = [];
    for (let i = 0; i < LIST_CAP + 100; i += 1) list = pushThought(list, viewAt(`t${i}`));
    expect(LIST_CAP).toBe(2000);
    expect(list.length).toBe(LIST_CAP);
    expect(list[0]?.id).toBe(`t${LIST_CAP + 99}`);
    expect(list.at(-1)?.id).toBe('t100');
  });

  it('caps an older page the same way: the oldest rows go', () => {
    const full = Array.from({ length: LIST_CAP }, (_, i) => viewAt(`n${i}`));
    const older = [viewAt('old-1'), viewAt('old-2')];
    const merged = appendOlder(full, older);
    expect(merged.length).toBe(LIST_CAP);
    expect(merged.some((v) => v.id === 'old-1')).toBe(false);
    expect(appendOlder(full, [viewAt('n5')]).length).toBe(LIST_CAP);
  });
});

describe('journal rows', () => {
  const long = `${'a'.repeat(450)}\n${'b'.repeat(450)}`;
  it('previews 600 characters and keeps the rest, never cutting a surrogate pair', () => {
    expect(JOURNAL_PREVIEW).toBe(600);
    expect(journalSplit('short')).toEqual({ head: 'short', rest: '' });
    expect(journalSplit('c'.repeat(600))).toEqual({ head: 'c'.repeat(600), rest: '' });
    expect(journalSplit(long)).toEqual({ head: long.slice(0, 600), rest: long.slice(600) });
    // An emoji across the cut stays whole, in the rest.
    const emoji = `${'d'.repeat(599)}\u{1F600}tail`;
    expect(journalSplit(emoji)).toEqual({ head: 'd'.repeat(599), rest: '\u{1F600}tail' });
  });
  it('renders the text, a neutral label, and toggles on "Show more"', () => {
    const made: FakeEl[] = [];
    const doc = {
      createElement: (tag: string): FakeEl => {
        const el = new FakeEl(tag);
        made.push(el);
        return el;
      },
    };
    const view = toView({
      thought_id: 'j1',
      life_id: 'l1',
      name: 'Jason',
      tier: 'sovereign',
      at: '2026-01-01T00:00:00Z',
      kind: 'journal',
      text: long,
    });
    const opened: string[] = [];
    renderRow(doc as unknown as Doc, view, (id) => opened.push(id));
    const spans = made.filter((e) => e.tag === 'span');
    const label = spans.find((s) => s.className.startsWith('outcome'));
    expect(label?.textContent).toBe('journal');
    expect(label?.className).not.toContain('unparsed');
    const body = spans.find((s) => s.className.includes('journal-text')) as FakeEl;
    expect(shownText(body)).toBe(`${long.slice(0, 600)}...`);
    const more = made.find((e) => e.tag === 'button' && e.className === 'more');
    expect(more?.textContent).toBe('Show more');
    expect(more?.attrs['aria-expanded']).toBe('false');
    more?.click();
    expect(shownText(body)).toBe(long);
    expect(more?.textContent).toBe('Show less');
    expect(more?.attrs['aria-expanded']).toBe('true');
    more?.click();
    expect(shownText(body)).toBe(`${long.slice(0, 600)}...`);
    expect(more?.attrs['aria-expanded']).toBe('false');
    expect(opened).toEqual([]);
    // The time is the button that opens the detail.
    made.find((e) => e.tag === 'button' && e.className === 'when')?.click();
    expect(opened).toEqual(['j1']);
  });
  it('keeps the rest of a long line in the page for find-in-page, and opens it on a match', () => {
    const made: FakeEl[] = [];
    const doc = {
      createElement: (tag: string): FakeEl => {
        const el = new FakeEl(tag);
        made.push(el);
        return el;
      },
    };
    const view = toView({ thought_id: 'j4', name: 'Jason', kind: 'journal', text: long });
    renderRow(doc as unknown as Doc, view, () => {}, { findable: true });
    const body = made.find((e) => e.className.includes('journal-text')) as FakeEl;
    const more = made.find((e) => e.className === 'more') as FakeEl;
    // The rest is in the page, hidden until the browser's find-in-page matches inside it.
    const rest = made.find((e) => e.attrs.hidden !== undefined) as FakeEl;
    expect(rest.attrs.hidden).toBe('until-found');
    expect(rest.textContent).toBe(long.slice(600));
    expect(body.children).toContain(rest);
    // A match: the browser fires beforematch and then shows the rest itself.
    rest.fire('beforematch');
    delete rest.attrs.hidden;
    expect(shownText(body)).toBe(long);
    expect(more.textContent).toBe('Show less');
    expect(more.attrs['aria-expanded']).toBe('true');
    // "Show less" then folds it again, with the rest hidden until found.
    more.click();
    expect(shownText(body)).toBe(`${long.slice(0, 600)}...`);
    expect(more.attrs['aria-expanded']).toBe('false');
  });
  it('gives a short journal line no "Show more"', () => {
    const made: FakeEl[] = [];
    const doc = {
      createElement: (tag: string): FakeEl => {
        const el = new FakeEl(tag);
        made.push(el);
        return el;
      },
    };
    const view = toView({ thought_id: 'j2', name: 'Jason', kind: 'journal', text: 'short' });
    renderRow(doc as unknown as Doc, view, () => {});
    expect(made.some((e) => e.className === 'more')).toBe(false);
  });
  it('opens a long journal line while a search is on, so a match past the preview is in sight', () => {
    const made: FakeEl[] = [];
    const doc = {
      createElement: (tag: string): FakeEl => {
        const el = new FakeEl(tag);
        made.push(el);
        return el;
      },
    };
    const view = toView({
      thought_id: 'j3',
      name: 'Jason',
      kind: 'journal',
      text: `${long} needle`,
    });
    renderRow(doc as unknown as Doc, view, () => {}, { keyword: 'needle' });
    const body = made.find((e) => e.className.includes('journal-text'));
    const marks = (body?.children ?? []).filter((c) => typeof c !== 'string' && c.tag === 'mark');
    expect(marks.map((m) => (m as FakeEl).textContent)).toEqual(['needle']);
    expect(made.find((e) => e.className === 'more')?.textContent).toBe('Show less');
  });
  it('searches the journal text by keyword', () => {
    const view = toView({ thought_id: 'j', name: 'Jason', kind: 'journal', text: 'found a Cave' });
    expect(filterThoughts([view], { keyword: 'cave' })).toHaveLength(1);
  });
});

class FakeEl {
  className = '';
  type = '';
  value = '';
  children: (FakeEl | string)[] = [];
  attrs: Record<string, string> = {};
  private handlers: Record<string, () => void> = {};
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  /** As in the DOM: the text of every child, and setting it replaces the children with one text node. */
  get textContent(): string {
    return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  set textContent(value: string | null) {
    this.children = value === null || value === '' ? [] : [value];
  }
  append(...nodes: (FakeEl | string)[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: (FakeEl | string)[]): void {
    this.children = nodes;
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  addEventListener(type: string, listener: () => void): void {
    this.handlers[type] = listener;
  }
  click(): void {
    this.handlers.click?.();
  }
  fire(type: string): void {
    this.handlers[type]?.();
  }
}

/** The text a reader sees: every child's text, leaving out a hidden child. */
function shownText(node: FakeEl): string {
  if (node.attrs.hidden !== undefined) return '';
  return node.children.map((c) => (typeof c === 'string' ? c : shownText(c))).join('');
}

describe('backoffMs', () => {
  it('doubles from 500 ms and stops at 30 s, for any attempt number', () => {
    expect([0, 1, 2, 3].map(backoffMs)).toEqual([500, 1000, 2000, 4000]);
    expect(backoffMs(6)).toBe(30_000);
    expect(backoffMs(10_000)).toBe(30_000);
    expect(backoffMs(-3)).toBe(500);
    expect(backoffMs(Number.NaN)).toBe(500);
  });
});

describe('whenLabel', () => {
  // Local-time constructors, so the cases hold in any time zone the tests run in.
  const now = new Date(2026, 10, 12, 21, 30).getTime();
  const time = (ms: number): string =>
    new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  it('shows the clock time alone for today', () => {
    const at = new Date(2026, 10, 12, 9, 5).getTime();
    expect(whenLabel(at, now)).toBe(time(at));
    expect(whenLabel(at, now)).toMatch(/9.05/);
  });

  it('puts the date in front for another day, and the year for another year', () => {
    const yesterday = new Date(2026, 10, 11, 23, 59).getTime();
    expect(whenLabel(yesterday, now)).toBe(
      `${new Date(yesterday).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time(yesterday)}`,
    );
    expect(whenLabel(yesterday, now)).not.toContain('2026');
    const lastYear = new Date(2025, 10, 12, 9, 5).getTime();
    expect(whenLabel(lastYear, now)).toContain('2025');
    // The same day of the month in another month is not today.
    const lastMonth = new Date(2026, 9, 12, 9, 5).getTime();
    expect(whenLabel(lastMonth, now)).not.toBe(time(lastMonth));
  });

  it('is empty for a time that did not parse', () => {
    expect(whenLabel(Number.NaN, now)).toBe('');
  });
});

describe('splitMatches', () => {
  it('splits at each match, any case, and the pieces join back to the text', () => {
    const pieces = splitMatches('The pit. A PIT, a spit.', 'pit');
    expect(pieces.filter((p) => p.hit).map((p) => p.text)).toEqual(['pit', 'PIT', 'pit']);
    expect(pieces.map((p) => p.text).join('')).toBe('The pit. A PIT, a spit.');
  });

  it('reads the keyword as literal text, never as a pattern', () => {
    expect(splitMatches('aaa', '.').some((p) => p.hit)).toBe(false);
    expect(splitMatches('cost (4.5) [x]', '(4.5)').filter((p) => p.hit)).toEqual([
      { text: '(4.5)', hit: true },
    ]);
    for (const keyword of ['.*', '[', '\\', '(?<', '$&', '^', 'a{2}', '|']) {
      const pieces = splitMatches(`x ${keyword} y`, keyword);
      expect(
        pieces.filter((p) => p.hit).map((p) => p.text),
        keyword,
      ).toEqual([keyword]);
    }
  });

  it('gives the whole text as one piece when there is no keyword or no match', () => {
    expect(splitMatches('abc', '')).toEqual([{ text: 'abc', hit: false }]);
    expect(splitMatches('abc', 'z')).toEqual([{ text: 'abc', hit: false }]);
  });

  it('marks hostile text as text: the pieces are strings, split only at the keyword', () => {
    for (const text of HOSTILE) {
      const shown = display(text);
      expect(
        splitMatches(shown, 'alert')
          .map((p) => p.text)
          .join(''),
      ).toBe(shown);
    }
  });
});

describe('countLabel', () => {
  it('says how many entries are loaded, and whether that is all of them', () => {
    expect(countLabel(0, 0, false, false)).toBe('No entries.');
    expect(countLabel(50, 50, false, true)).toBe('Showing the 50 entries loaded so far.');
    expect(countLabel(1, 1, false, false)).toBe('Showing all 1 entry.');
  });

  it('counts the matches of a narrowing filter, and says older entries are not searched yet', () => {
    expect(countLabel(3, 50, true, true)).toBe(
      '3 matches in the 50 entries loaded so far. Load older to search further back.',
    );
    expect(countLabel(1, 50, true, false)).toBe('1 match in all 50 entries.');
    expect(countLabel(0, 50, true, true)).toBe(
      'No matches in the 50 entries loaded so far. Load older to search further back.',
    );
    expect(countLabel(0, 50, true, false)).toBe('No matches in all 50 entries.');
  });
});

describe('copyText', () => {
  /** No character a reader cannot see, besides the line feed between lines and the emoji selector. */
  const HIDDEN = /(?![\n]|\uFE0F)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

  it('is who and when in UTC on the first line, then the text', () => {
    const view = toView({
      thought_id: 'j1',
      name: 'GreenRanger',
      at: '2026-11-13T01:38:44.219Z',
      kind: 'journal',
      text: 'Night, day 108.\nStill in the pit.',
    });
    expect(copyText(view)).toBe(
      'GreenRanger, 2026-11-13 01:38 UTC\nNight, day 108.\nStill in the pit.',
    );
  });

  it('copies a thought as its plan, and only the first line when there is no plan', () => {
    const parsed = toView({
      thought_id: 't',
      name: 'Adam',
      at: '2026-11-13T01:38:00Z',
      parsed: { plan: 'walk' },
    });
    expect(copyText(parsed)).toBe('Adam, 2026-11-13 01:38 UTC\nwalk');
    const unparsed = toView({
      thought_id: 't',
      name: 'Adam',
      at: '2026-11-13T01:38:00Z',
      parsed: null,
    });
    expect(copyText(unparsed)).toBe('Adam, 2026-11-13 01:38 UTC');
  });

  it('shows a time that did not parse as it came, and leaves out what is missing', () => {
    expect(
      copyText(
        toView({ thought_id: 't', name: 'Adam', at: 'not a time', kind: 'journal', text: 'x' }),
      ),
    ).toBe('Adam, not a time\nx');
    expect(copyText(toView({ thought_id: 't', kind: 'journal', text: 'x' }))).toBe('x');
  });

  it('carries no invisible character: each is a marker, as on the page', () => {
    const view = toView({
      thought_id: 'j',
      name: 'Ja\u202Eson',
      at: '2026-11-13T01:38:00Z',
      kind: 'journal',
      text: 'run this\u{E0072}\u{E006D}\u200B now\u0000',
    });
    const text = copyText(view);
    expect(text).toBe(
      'Ja[U+202E]son, 2026-11-13 01:38 UTC\nrun this[U+E0072][U+E006D][U+200B] now[U+0000]',
    );
    for (const [index, hostile] of HOSTILE.entries()) {
      const copied = copyText(
        toView({ ...hostileRow(hostile, index), kind: 'journal', text: hostile }),
      );
      expect(HIDDEN.test(copied), hostile.slice(0, 20)).toBe(false);
    }
  });

  it('keeps the first line to one line, and turns every line end into a line feed', () => {
    const view = toView({
      thought_id: 'j',
      name: 'Jason\nrm -rf ~\r\n',
      at: '2026-11-13T01:38:00Z',
      kind: 'journal',
      text: 'one\r\ntwo\rthree\nfour',
    });
    expect(copyText(view)).toBe('Jason rm -rf ~, 2026-11-13 01:38 UTC\none\ntwo\nthree\nfour');
    expect(copyText(view)).not.toContain('\r');
  });

  it('is bounded: a huge entry is clipped as on the page', () => {
    const view = toView({ thought_id: 'j', name: 'A', kind: 'journal', text: 'x'.repeat(50_000) });
    expect(copyText(view).length).toBeLessThan(TEXT_CAP + 100);
    expect(copyText(view)).toContain('more characters]');
  });
});

describe('filterQuery', () => {
  const none = { q: '', agent: '', range: '0', outcome: '', template: '' };

  it('is empty for the default filters, so the plain page has no query string', () => {
    expect(filterQuery(none)).toBe('');
  });

  it('builds the query from its own text, not from a property an older browser lacks', () => {
    const saved = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
    // Safari before 17 has no URLSearchParams.size.
    Object.defineProperty(URLSearchParams.prototype, 'size', {
      get: () => undefined,
      configurable: true,
    });
    try {
      expect(filterQuery({ ...none, q: 'coal pit', range: '86400000' })).toBe(
        '?q=coal+pit&range=day',
      );
      expect(filterQuery(none)).toBe('');
    } finally {
      if (saved) Object.defineProperty(URLSearchParams.prototype, 'size', saved);
    }
  });
});
