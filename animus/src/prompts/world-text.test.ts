import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MindEvent } from '../ports/index.ts';
import { createPromptLibrary } from './library.ts';
import { sampleSnapshot, sampleThoughtVars } from './snapshot.fixture.ts';
import {
  isRiskyCodePoint,
  jsonString,
  MAX_ITEM_CHARS,
  renderWorldText,
  WORLD_TEXT_FOOTER,
  WORLD_TEXT_HEADER,
} from './world-text.ts';

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
    lifeId: 'ag_adam_01',
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
          agentId: 'ag_adam_01',
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
