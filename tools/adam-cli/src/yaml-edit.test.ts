import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readLives, readPins } from './pins.ts';
import { recordDigests, selectLife } from './yaml-edit.ts';

const SHARD = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'shards', 'phase0.yaml'),
  'utf8',
);
const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);
const found = new Map([
  ['qwen3:32b', `sha256:${HEX_A}`],
  ['qwen3:8b', `sha256:${HEX_B}`],
  ['nomic-embed-text', `sha256:${HEX_C}`],
]);

/** The file with its placeholder digests, whatever state the checked-in file is in. */
const WITH_PLACEHOLDERS = SHARD.replace(/sha256:[0-9a-f]{64}/g, 'sha256:RECORD_AT_DISPATCH');

describe('recordDigests', () => {
  it('replaces only the placeholder digests and keeps every other line and comment', () => {
    const result = recordDigests(
      WITH_PLACEHOLDERS,
      ['qwen3:32b', 'qwen3:8b'],
      'nomic-embed-text',
      found,
      '2026-11-09',
    );
    expect(result.recorded).toEqual(['qwen3:32b', 'qwen3:8b', 'nomic-embed-text']);
    const before = WITH_PLACEHOLDERS.split('\n');
    const after = result.text.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((line, i) => (line === after[i] ? [] : [i]));
    expect(changed).toHaveLength(3);
    for (const i of changed) expect(after[i]).toMatch(/^\s+digest: "sha256:[abc]{64}"/);
    expect(after.filter((l) => l.trimStart().startsWith('#')).length).toBe(
      before.filter((l) => l.trimStart().startsWith('#')).length,
    );
  });

  it('writes each digest under its own model and updates the stale placeholder comment', () => {
    const result = recordDigests(
      WITH_PLACEHOLDERS,
      ['qwen3:32b', 'qwen3:8b'],
      'nomic-embed-text',
      found,
      '2026-11-09',
    );
    const pins = Object.fromEntries(readPins(parse(result.text)).map((p) => [p.tag, p.digest]));
    expect(pins).toEqual(Object.fromEntries(found));
    expect(result.text).toContain('# recorded from Ollama on 2026-11-09');
    expect(result.text).not.toContain('# placeholder: record at dispatch');
  });

  it('never overwrites a real digest', () => {
    const once = recordDigests(
      WITH_PLACEHOLDERS,
      ['qwen3:32b', 'qwen3:8b'],
      'nomic-embed-text',
      found,
      '2026-11-09',
    );
    const other = new Map([...found].map(([tag]) => [tag, `sha256:${'d'.repeat(64)}`]));
    const twice = recordDigests(
      once.text,
      ['qwen3:32b', 'qwen3:8b'],
      'nomic-embed-text',
      other,
      '2026-11-10',
    );
    expect(twice.recorded).toEqual([]);
    expect(twice.kept).toEqual(['qwen3:32b', 'qwen3:8b', 'nomic-embed-text']);
    expect(twice.text).toBe(once.text);
  });

  it('refuses a model with no entry or no found digest', () => {
    expect(() =>
      recordDigests(WITH_PLACEHOLDERS, ['qwen3:70b'], 'nomic-embed-text', found, 'd'),
    ).toThrow(/no entry/);
    expect(() =>
      recordDigests(WITH_PLACEHOLDERS, ['qwen3:8b'], 'nomic-embed-text', new Map(), 'd'),
    ).toThrow(/no digest found/);
  });

  it('keeps CRLF line endings', () => {
    const crlf = WITH_PLACEHOLDERS.replace(/\n/g, '\r\n');
    const result = recordDigests(crlf, ['qwen3:32b', 'qwen3:8b'], 'nomic-embed-text', found, 'd');
    expect(result.text.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('selectLife', () => {
  it('sets the username, tier and run_tier for the fast life and changes nothing else', () => {
    const fast = selectLife(SHARD, 'fast', readLives(parse(SHARD)).fast);
    const doc = parse(fast) as {
      mind: { agent: { username: string; tier: string }; run_tier: string };
    };
    expect(doc.mind.agent).toMatchObject({ username: 'ag_adam_02', tier: 'fast' });
    expect(doc.mind.run_tier).toBe('fast');
    const before = SHARD.split('\n');
    const after = fast.split('\n');
    expect(after).toHaveLength(before.length);
    expect(before.filter((l, i) => l !== after[i]).length).toBeLessThanOrEqual(3);
  });

  it('round-trips to the strong life', () => {
    const lives = readLives(parse(SHARD));
    const there = selectLife(SHARD, 'fast', lives.fast);
    expect(selectLife(there, 'strong', lives.strong)).toBe(
      selectLife(SHARD, 'strong', lives.strong),
    );
    const strong = parse(selectLife(there, 'strong', lives.strong)) as {
      mind: { agent: { username: string } };
    };
    expect(strong.mind.agent.username).toBe('ag_adam_01');
  });
});
