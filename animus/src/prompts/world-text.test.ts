import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { JournalEntry, MemoryRow, MindEvent } from '../ports/index.ts';
import { createPromptLibrary, DEFAULT_THOUGHT_BUDGET_TOKENS } from './library.ts';
import { sampleSnapshot, sampleThoughtVars } from './snapshot.fixture.ts';
import {
  fitEscaped,
  isRiskyCodePoint,
  jsonString,
  MAX_ITEM_CHARS,
  renderWorldText,
  WORLD_TEXT_FOOTER,
  WORLD_TEXT_HEADER,
} from './world-text.ts';

/**
 * The estimated tokens of a text, written out here apart from `promptCost`: one per three ASCII
 * characters (rounded up once), one per other code point, four per astral one.
 */
function estimateTokens(text: string): number {
  let ascii = 0;
  let rest = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) ascii++;
    else rest += cp > 0xffff ? 4 : 1;
  }
  return Math.ceil(ascii / 3) + rest;
}

interface CorpusItem {
  name: string;
  text?: string;
  textRepeat?: [string, number];
}

const corpus = (
  JSON.parse(readFileSync(new URL('./hostile-text.corpus.json', import.meta.url), 'utf8')) as {
    items: CorpusItem[];
  }
).items.map((i) => ({
  name: i.name,
  text: i.textRepeat === undefined ? (i.text as string) : i.textRepeat[0].repeat(i.textRepeat[1]),
}));

const library = createPromptLibrary();

function speech(from: string, text: string): MindEvent {
  return {
    type: 'speech',
    eventId: 'ev1',
    lifeId: 'ag_adam_03',
    tick: 1,
    day: 1,
    at: '2026-11-09T00:00:00.000Z',
    payload: { from, text, distance: 3, own: false },
  };
}

describe('hostile text corpus', () => {
  it('has the cases the packet names', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(10);
    expect(corpus.some((c) => c.text.length >= 10_000)).toBe(true);
    expect(corpus.some((c) => c.text.includes('\u2028'))).toBe(true);
  });

  for (const item of corpus) {
    it(`keeps ${item.name} inside its quoted string in every world-text slot`, () => {
      const base = library.render('thought', sampleThoughtVars());
      const snap = sampleSnapshot({
        heard: [{ from: 'Eve', text: item.text.slice(0, 256), age_seconds: 1 }],
        surroundings: {
          blocks_summary: item.text,
          notable_blocks: [{ type: 'oak_sign', x: 1, y: 64, z: 2, text: item.text.slice(0, 256) }],
          entities: [],
          agents: [
            {
              name: item.text.slice(0, 32),
              distance: 1,
              held_item: null,
              health_estimate: item.text.slice(0, 32),
            },
          ],
        },
      });
      const vars = sampleThoughtVars(snap);
      vars.wake = {
        reason: 'speech_addressed',
        events: [speech(item.text.slice(0, 32), item.text)],
        digest: [speech('Mallory', item.text)],
        priority: 2,
      };
      vars.relationships = [
        {
          agentId: 'ag_adam_03',
          otherId: item.text.slice(0, 32),
          impression: item.text,
          trust: 90,
          lastSeenDay: 2,
        },
      ];
      const out = library.render('thought', vars);
      const system = out.messages[0]?.content as string;
      const user = out.messages[1]?.content as string;

      // The system message is untouched.
      expect(system).toBe(base.messages[0]?.content);
      expect(out.stablePrefixChars).toBe(system.length);

      // Exactly one section, at the end.
      // Counted by whole line: hostile text may mention the words, but only inside a string.
      const userLines = user.split('\n');
      expect(userLines.filter((l) => l === WORLD_TEXT_HEADER)).toHaveLength(1);
      expect(userLines.filter((l) => l === WORLD_TEXT_FOOTER)).toHaveLength(1);
      expect(user.endsWith(WORLD_TEXT_FOOTER)).toBe(true);
      const before = user.split(WORLD_TEXT_HEADER)[0] as string;
      expect(before).not.toContain(
        item.text.slice(0, 20).trim() === '' ? '\u0000' : item.text.slice(0, 20),
      );

      // No raw line breaks or markup from the text, anywhere in the user message.
      const stray = Array.from(user).filter((ch) => {
        const cp = ch.codePointAt(0) ?? 0;
        return cp !== 10 && (cp < 32 || isRiskyCodePoint(cp));
      });
      expect(stray).toEqual([]);
      expect(user).not.toContain('<<block');

      // Every line of the section is one `- kind {json}` item.
      const lines = user.slice(user.indexOf(WORLD_TEXT_HEADER)).split('\n').slice(1, -1);
      expect(lines.length).toBeGreaterThanOrEqual(7);
      for (const line of lines) {
        const m = /^- ([a-z_]+) (\{.*\})$/.exec(line);
        expect(m, line.slice(0, 80)).not.toBeNull();
        const parsed = JSON.parse(m?.[2] as string) as Record<string, unknown>;
        for (const value of Object.values(parsed)) {
          if (typeof value === 'string') {
            expect(value.length).toBeLessThanOrEqual(MAX_ITEM_CHARS);
          }
        }
      }
    });
  }

  it('round-trips a short hostile string exactly and cuts a long one with an ellipsis', () => {
    const short = corpus.find((c) => c.name === 'line_separator')?.text as string;
    expect(JSON.parse(jsonString(short))).toBe(short);
    const huge = corpus.find((c) => c.name === 'huge')?.text as string;
    const cut = JSON.parse(jsonString(huge)) as string;
    expect(Array.from(cut)).toHaveLength(MAX_ITEM_CHARS);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('shows none for an empty section and counts lines past the cap', () => {
    expect(renderWorldText([])).toBe(`${WORLD_TEXT_HEADER}\n(none)\n${WORLD_TEXT_FOOTER}`);
    const many = Array.from({ length: 130 }, (_, i) => ({
      kind: 'heard' as const,
      fields: { n: i },
    }));
    expect(renderWorldText(many)).toContain('(10 more lines not shown)');
  });
});

describe('invisible code points', () => {
  it('escapes tag characters, variation selectors and fillers inside a prompt string', () => {
    for (const cp of [0x34f, 0x61c, 0x115f, 0x1160, 0x180e, 0x3164, 0xfe0f, 0xe0041]) {
      expect(isRiskyCodePoint(cp)).toBe(true);
    }
    expect(isRiskyCodePoint(0x41)).toBe(false);
  });
});

/** Forty beliefs of 512 characters and a full journal of twenty thoughts with long text. */
function memoryHeavyVars() {
  const belief = (i: number): MemoryRow => ({
    memoryId: i,
    agentId: 'ag_adam_03',
    kind: 'semantic',
    provenance: 'observation',
    subject: null,
    text: `${i} ${'b'.repeat(510)}`,
    createdDay: 1,
    sourceThought: null,
    sourceAgent: null,
    dueTick: null,
    resolved: false,
    active: true,
  });
  const entry = (i: number): JournalEntry => ({
    thoughtId: `th${i}`,
    worldDay: 2,
    worldTick: i,
    wakeReason: 'idle',
    parsed: {
      reasoning: 'r'.repeat(240),
      actions: [{ do: 'wait' }],
      say: 's'.repeat(256),
    } as unknown as JournalEntry['parsed'],
  });
  const vars = sampleThoughtVars();
  return {
    ...vars,
    beliefs: Array.from({ length: 500 }, (_, i) => belief(i)),
    recentThoughts: Array.from({ length: 20 }, (_, i) => entry(i)),
  };
}

describe('escaping by property', () => {
  it('escapes every default-ignorable and format code point, whatever the Unicode version', () => {
    const ignorable = /^[\p{Default_Ignorable_Code_Point}\p{Cf}]$/u;
    const missed: string[] = [];
    let seen = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if (!ignorable.test(ch)) continue;
      seen++;
      if (!isRiskyCodePoint(cp) || jsonString(ch).includes(ch)) missed.push(cp.toString(16));
    }
    expect(seen).toBeGreaterThan(100);
    expect(missed).toEqual([]);
  });

  it('round-trips astral and escaped text through JSON', () => {
    const text = `\u{1d11e}\u{e0100}\u{e0fff}\u{1bca0}<> \u{10ffff}x😀`;
    expect(JSON.parse(jsonString(text, 10_000))).toBe(text);
  });
});

describe('the thought budget', () => {
  const BUDGET = DEFAULT_THOUGHT_BUDGET_TOKENS;

  /** Fifty heard lines of 256 characters each, ages 1 to 50, and one short wake speech. */
  function hostileVars(ch: string) {
    const heard = Array.from({ length: 50 }, (_, i) => ({
      from: 'Mallory',
      text: ch.repeat(256),
      age_seconds: i + 1,
    }));
    const vars = sampleThoughtVars(
      sampleSnapshot({
        heard,
        current_plan: { action: 'PLAN-MARK build', goal: 'shelter', status: 'active' },
      }),
    );
    return {
      ...vars,
      wake: { ...vars.wake, events: [speech('Eve', 'WAKE-SPEECH-MARK hello')] },
    };
  }

  it.each([
    ['汉', 'CJK'],
    ['\u{1d11e}', 'astral'],
    ['<', 'angle bracket'],
  ])('keeps the user message under budget with 50 lines of 256 %s characters (%s)', (ch) => {
    const user = library.render('thought', hostileVars(ch)).messages[1]?.content ?? '';
    expect(estimateTokens(user)).toBeLessThanOrEqual(BUDGET);
    expect(user).toContain('WAKE-SPEECH-MARK hello');
    expect(user).toContain('more lines not shown');
  });

  it('counts three ASCII characters as one token: 50 lines of 256 ASCII characters fit 8000', () => {
    const roomy = createPromptLibrary({ thoughtBudgetTokens: 8000 });
    const user = roomy.render('thought', hostileVars('a')).messages[1]?.content ?? '';
    expect(user).not.toContain('more lines not shown');
    expect(estimateTokens(user)).toBeLessThanOrEqual(8000);
  });

  it('holds the budget with 40 beliefs of 512 characters and a full journal', () => {
    const user = library.render('thought', memoryHeavyVars()).messages[1]?.content ?? '';
    expect(estimateTokens(user)).toBeLessThanOrEqual(BUDGET);
    // The memory blocks keep 60 percent: the journal goes first, then the oldest beliefs.
    expect(user).toContain('"0 bbbb');
    expect(user).not.toContain('"39 bbbb');
    expect(user).not.toContain('day 2 tick');
  });

  it('keeps the wake speech and the plan when the budget is one token', () => {
    const tiny = createPromptLibrary({ thoughtBudgetTokens: 1 });
    const user = tiny.render('thought', hostileVars('汉')).messages[1]?.content ?? '';
    expect(user).toContain('WAKE-SPEECH-MARK hello');
    expect(user).toContain('PLAN-MARK build');
    expect(user).toContain('more lines not shown');
  });

  it('cuts a digest of 8000 angle brackets after escaping, to its cost', () => {
    const cut = fitEscaped('<'.repeat(8000), 4000);
    expect(cut.endsWith('…')).toBe(true);
    expect(estimateTokens(jsonString(cut, 10_000).slice(1, -1))).toBeLessThanOrEqual(4000);
    expect(fitEscaped('abc', 4000)).toBe('abc');
  });

  it('drops the oldest heard lines first and keeps the newest', () => {
    const user = library.render('thought', hostileVars('汉')).messages[1]?.content ?? '';
    expect(user).toContain('"age_seconds":1,');
    expect(user).not.toContain('"age_seconds":50,');
  });

  it('keeps every line when the budget is not reached', () => {
    const out = library.render('thought', sampleThoughtVars()).messages[1]?.content ?? '';
    expect(out).not.toContain('more lines not shown');
    expect(renderWorldText([], BUDGET)).toBe(`${WORLD_TEXT_HEADER}\n(none)\n${WORLD_TEXT_FOOTER}`);
  });
});
