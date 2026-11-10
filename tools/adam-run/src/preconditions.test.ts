import { describe, expect, it } from 'vitest';
import { checkPreconditions, type PreconditionFacts } from './preconditions.ts';

const SHA = 'eba101b';
const FULL_HEAD = 'eba101b2f00dcafe1234567890abcdef12345678';
/** A complete bench result at HEAD: one 20 TPS row per scenario, all at 100%. */
const benchResult = (over: { commit?: string; truncated?: boolean; pct?: number } = {}) => ({
  meta: { commit: over.commit ?? SHA },
  truncated: over.truncated ?? false,
  summary: ['wood-to-stone-tools', 'food'].map((scenario) => ({
    scenario,
    tps: 20,
    successPct: over.pct ?? 100,
  })),
});
const BENCH_FILE = '20261110T024026Z-eba101b.json';

const good: PreconditionFacts = {
  profile: '8b',
  headSha: SHA,
  cleanTree: true,
  bench: { file: BENCH_FILE, text: JSON.stringify(benchResult()) },
  pins: [{ tag: 'qwen3:8b', digest: 'sha256:bbb' }],
  observedDigests: { 'qwen3:8b': 'sha256:bbb' },
  loadedModels: [],
  freshVolumeJson:
    '{"volume":"geldar-8b","created_at":"2026-11-10T00:00:00Z","life_id":"ag_adam_02"}',
  lifeId: 'ag_adam_02',
};

const withBench = (json: unknown): PreconditionFacts => ({
  ...good,
  bench: { file: BENCH_FILE, text: JSON.stringify(json) },
});

describe('checkPreconditions', () => {
  it('accepts a complete, clean, matching 8B run', () => {
    expect(checkPreconditions(good)).toEqual({ ok: true });
  });

  it('compares the bench file with the short form of the full HEAD sha git reports', () => {
    expect(checkPreconditions({ ...good, headSha: FULL_HEAD })).toEqual({ ok: true });
  });

  it.each<[string, PreconditionFacts, string]>([
    ['a dirty tree', { ...good, cleanTree: false }, 'clean tree'],
    ['no bench result file', { ...good, bench: null }, 'no bench-results/*.json file'],
    [
      'a bench file that is not JSON',
      { ...good, bench: { file: BENCH_FILE, text: '{' } },
      'not valid JSON',
    ],
    ['a truncated run', withBench(benchResult({ truncated: true })), 'is a truncated run'],
    ['a 20 TPS cell below 100%', withBench(benchResult({ pct: 99 })), '20 TPS food is 99% success'],
    [
      'a run at another sha',
      withBench(benchResult({ commit: '898b9b9' })),
      'recorded at 898b9b9, HEAD is eba101b',
    ],
    [
      'a missing model pin',
      { ...good, observedDigests: {} },
      'model pin qwen3:8b: Ollama does not have it',
    ],
    [
      'a digest that differs from the pin',
      { ...good, observedDigests: { 'qwen3:8b': 'sha256:zzz' } },
      'Ollama reports sha256:zzz',
    ],
    ['the wrong life id for 8B', { ...good, lifeId: 'ag_adam_01' }, 'profile 8b runs ag_adam_02'],
    [
      'no fresh-volume marker for 8B',
      { ...good, freshVolumeJson: null },
      'fresh-volume.json is missing',
    ],
    [
      'a model loaded that is not expected',
      { ...good, loadedModels: ['qwen3:32b'] },
      'qwen3:32b is loaded',
    ],
  ])('refuses %s, and says what is missing', (_name, facts, text) => {
    const verdict = checkPreconditions(facts);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.missing.join('\n')).toContain(text);
  });

  it('allows the profile model and the embedding model to stay loaded', () => {
    const facts = {
      ...good,
      pins: [...good.pins, { tag: 'nomic-embed-text', digest: 'sha256:ccc' }],
      observedDigests: { ...good.observedDigests, 'nomic-embed-text': 'sha256:ccc' },
      loadedModels: ['qwen3:8b', 'nomic-embed-text'],
    };
    expect(checkPreconditions(facts)).toEqual({ ok: true });
  });

  it('matches a bare-hex Ollama digest to a sha256: pin, in both directions and in upper case', () => {
    const bare = { ...good, observedDigests: { 'qwen3:8b': 'bbb' } };
    expect(checkPreconditions(bare)).toEqual({ ok: true });
    const pinBare = { ...good, pins: [{ tag: 'qwen3:8b', digest: 'bbb' }] };
    expect(checkPreconditions(pinBare)).toEqual({ ok: true });
    const upper = { ...good, observedDigests: { 'qwen3:8b': 'SHA256:BBB' } };
    expect(checkPreconditions(upper)).toEqual({ ok: true });
  });

  it('refuses a real digest mismatch, and a prefix of the pinned digest', () => {
    const other = { ...good, observedDigests: { 'qwen3:8b': 'ccc' } };
    expect(checkPreconditions(other).ok).toBe(false);
    const prefix = { ...good, observedDigests: { 'qwen3:8b': 'bb' } };
    const verdict = checkPreconditions(prefix);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.missing.join('\n')).toContain('Ollama reports bb');
  });

  it('finds the embedding pin under the :latest tag Ollama lists', () => {
    const facts = {
      ...good,
      pins: [...good.pins, { tag: 'nomic-embed-text', digest: 'sha256:ccc' }],
      observedDigests: { ...good.observedDigests, 'nomic-embed-text:latest': 'ccc' },
      loadedModels: ['qwen3:8b', 'nomic-embed-text:latest'],
    };
    expect(checkPreconditions(facts)).toEqual({ ok: true });
  });

  it('the 32B profile needs no fresh-volume marker and runs ag_adam_01', () => {
    const facts: PreconditionFacts = {
      ...good,
      profile: '32b',
      lifeId: 'ag_adam_01',
      freshVolumeJson: null,
      pins: [{ tag: 'qwen3:32b', digest: 'sha256:aaa' }],
      observedDigests: { 'qwen3:32b': 'sha256:aaa' },
    };
    expect(checkPreconditions(facts)).toEqual({ ok: true });
  });
});
