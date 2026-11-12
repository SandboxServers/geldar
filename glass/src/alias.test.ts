import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentLabelText } from '../web/kino/entities.ts';
import { initAliases, loadAliases, setAliases } from './alias.ts';
import { targetEntries } from './kino/scope.ts';
import { getThought, listAgents, listThoughts, type SqlClient, thoughtsAfter } from './query.ts';

// Made-up fixtures only: never a real agent id or alias.
const FIXTURE = { ag_test_01: 'TestRanger' };
const STORED = 'StoredTestName';

function db(rows: Record<string, unknown>[]): SqlClient {
  return { query: async () => ({ rows }) };
}

const thought = (life: string) => ({ thought_id: 't1', life_id: life, name: STORED, tier: 'a' });

afterEach(() => setAliases(new Map()));

describe('alias loader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alias-test-'));
  afterEach(() => vi.restoreAllMocks());

  it('reads {id: alias} and ignores non-string entries', () => {
    const file = join(dir, 'ok.json');
    writeFileSync(file, JSON.stringify({ ...FIXTURE, ag_test_02: 7, ag_test_03: '' }));
    expect([...loadAliases(file, () => {})]).toEqual([['ag_test_01', 'TestRanger']]);
  });

  it('missing, invalid or unset file: no aliases, one log line, no names printed', () => {
    const log = vi.fn();
    expect(loadAliases(join(dir, 'absent.json'), log).size).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '["ag_test_01","TestRanger"]');
    const log2 = vi.fn();
    expect(loadAliases(bad, log2).size).toBe(0);
    expect(log2).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log2.mock.calls)).not.toMatch(/TestRanger|ag_test/);
    const log3 = vi.fn();
    expect(loadAliases(undefined, log3).size).toBe(0);
    expect(log3).not.toHaveBeenCalled();
    rmSync(dir, { recursive: true, force: true });
  });

  it('initAliases reads GELDAR_ALIASES_FILE and a missing file leaves names unchanged', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'alias-init-')), 'a.json');
    writeFileSync(file, JSON.stringify(FIXTURE));
    initAliases({ GELDAR_ALIASES_FILE: file }, () => {});
    expect((await listAgents(db([{ agent_id: 'ag_test_01', name: STORED }])))[0]?.name).toBe(
      'TestRanger',
    );
    const log = vi.fn();
    initAliases({ GELDAR_ALIASES_FILE: `${file}.missing` }, log);
    expect((await listAgents(db([{ agent_id: 'ag_test_01', name: STORED }])))[0]?.name).toBe(
      STORED,
    );
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('Glass rows', () => {
  it('/api/agents, thought lists, one thought and the stream show the alias for mapped ids only', async () => {
    setAliases(new Map(Object.entries(FIXTURE)));
    const agents = await listAgents(
      db([
        { agent_id: 'ag_test_01', name: STORED },
        { agent_id: 'ag_test_09', name: 'Other' },
      ]),
    );
    expect(agents.map((a) => a.name)).toEqual(['TestRanger', 'Other']);
    const rows = [thought('ag_test_01'), thought('ag_test_09')];
    const filter = { limit: 10 };
    expect((await listThoughts(db(rows), filter)).map((r) => r.name)).toEqual([
      'TestRanger',
      STORED,
    ]);
    expect((await getThought(db(rows), 't1'))?.name).toBe('TestRanger');
    expect((await thoughtsAfter(db(rows), { at: '', id: '' }, 10)).map((r) => r.name)).toEqual([
      'TestRanger',
      STORED,
    ]);
    expect(JSON.stringify(agents)).not.toContain(STORED);
  });

  it('without aliases nothing changes', async () => {
    expect((await getThought(db([thought('ag_test_01')]), 't1'))?.name).toBe(STORED);
  });
});

describe('Kino labels', () => {
  it('/kino/targets entries carry the alias as label and keep the id', () => {
    setAliases(new Map(Object.entries(FIXTURE)));
    expect(targetEntries(['ag_test_01', 'ag_test_09'])).toEqual([
      { id: 'ag_test_01', label: 'TestRanger' },
      { id: 'ag_test_09', label: 'ag_test_09' },
    ]);
  });

  it('the name sprite text is the label, else the id', () => {
    const labels = new Map([['ag_test_01', 'TestRanger']]);
    expect(agentLabelText('ag_test_01', labels)).toBe('TestRanger');
    expect(agentLabelText('ag_test_09', labels)).toBe('ag_test_09');
  });
});
