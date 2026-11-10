import { describe, expect, it } from 'vitest';
import { HOSTILE, hostileRow } from './render-fixtures.ts';
import {
  appendOlder,
  backoffMs,
  clip,
  display,
  filterThoughts,
  LIST_CAP,
  pushThought,
  TEXT_CAP,
  type ThoughtView,
  toView,
  visible,
} from './render-model.ts';

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

describe('backoffMs', () => {
  it('doubles from 500 ms and stops at 30 s, for any attempt number', () => {
    expect([0, 1, 2, 3].map(backoffMs)).toEqual([500, 1000, 2000, 4000]);
    expect(backoffMs(6)).toBe(30_000);
    expect(backoffMs(10_000)).toBe(30_000);
    expect(backoffMs(-3)).toBe(500);
    expect(backoffMs(Number.NaN)).toBe(500);
  });
});
