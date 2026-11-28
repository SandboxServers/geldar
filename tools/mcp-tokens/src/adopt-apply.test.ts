import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSheetAdoptedPayload } from '@geldar/contract';
import { STANDARD_SHEET } from '@geldar/psyche';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAdoption } from './adopt-apply.ts';
import { type Env, type Io, run } from './cli.ts';
import type { Row, Sql } from './owners.ts';
import { SHARD_YAML } from './players.fakes.ts';
import { sheetHash } from './players.ts';

const LIFE = 'ag_adam_01';
const SHARD = [LIFE];
const HASH = sheetHash(STANDARD_SHEET);
const OTHER_HASH = 'a'.repeat(64);

interface Stored {
  sheet_hash: string | null;
  died_at: string | null;
}

function copyOf(rows: Map<string, Stored>): Map<string, Stored> {
  return new Map([...rows].map(([id, s]) => [id, { ...s }]));
}

/**
 * An agents table with two views. The planner's SELECT answers from the snapshot, which is what it
 * read; the UPDATE tests the live row, as the database does. A BEGIN keeps a copy of the live rows
 * and a ROLLBACK puts it back. Its UPDATE honours only the predicates its SQL text names.
 */
class ApplySql implements Sql {
  calls: Array<{ text: string; values: unknown[] }> = [];
  live: Map<string, Stored>;
  private snapshot: Map<string, Stored>;
  private saved: Map<string, Stored> | null = null;
  failAudit = false;
  eventError: unknown = null;

  constructor(rows: Record<string, Stored>) {
    this.live = new Map(Object.entries(rows));
    this.snapshot = copyOf(this.live);
  }

  /** The planner now reads what the table holds, as a fresh run would. */
  refresh(): void {
    this.snapshot = copyOf(this.live);
  }

  writes(): Array<{ text: string; values: unknown[] }> {
    return this.calls.filter((c) => /^(INSERT|UPDATE)/.test(c.text));
  }

  audits(): Array<{ text: string; values: unknown[] }> {
    return this.calls.filter((c) => c.text.startsWith('INSERT INTO character_sheet_adoptions'));
  }

  async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values });
    if (text === 'BEGIN') {
      this.saved = copyOf(this.live);
      return { rows: [] };
    }
    if (text === 'COMMIT') {
      this.saved = null;
      return { rows: [] };
    }
    if (text === 'ROLLBACK') {
      if (this.saved !== null) this.live = this.saved;
      this.saved = null;
      return { rows: [] };
    }
    if (text.startsWith('SELECT agent_id, died_at, sheet_hash FROM agents')) {
      const wanted = values[0] as string[];
      return {
        rows: [...this.snapshot]
          .filter(([id]) => wanted.includes(id))
          .map(([id, s]) => ({ agent_id: id, died_at: s.died_at, sheet_hash: s.sheet_hash })),
      };
    }
    if (text.startsWith('INSERT INTO events')) {
      if (this.eventError !== null) throw this.eventError;
      return { rows: [] };
    }
    if (text.startsWith('UPDATE agents')) {
      const life = this.live.get(String(values[0]));
      if (life === undefined) return { rows: [] };
      if (text.includes('sheet_hash IS NULL') && life.sheet_hash !== null) return { rows: [] };
      if (text.includes('died_at IS NULL') && life.died_at !== null) return { rows: [] };
      life.sheet_hash = String(values[2]);
      return { rows: [{ agent_id: values[0] }] };
    }
    if (text.startsWith('INSERT INTO character_sheet_adoptions')) {
      if (this.failAudit) throw new Error('audit insert refused');
      return { rows: [] };
    }
    throw new Error(`the stub has no answer for: ${text}`);
  }
}

describe('applyAdoption', () => {
  it('writes the STANDARD_SHEET hash to a NULL-baseline live life and one conversion audit row', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    const lines = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(lines).toEqual([`${LIFE}: adopted`]);
    expect(sql.live.get(LIFE)?.sheet_hash).toBe(HASH);
    expect(sql.audits()).toHaveLength(1);
    expect(sql.audits()[0]?.text).toContain("'conversion', 'adopted'");
    expect(sql.audits()[0]?.values[0]).toBe(`conversion:sheet_adopted:${LIFE}`);
    const events = sql.calls.filter((c) => c.text.startsWith('INSERT INTO events'));
    expect(events).toHaveLength(1);
    expect(events[0]?.values[0]).toBe(`conversion:sheet_adopted:${LIFE}`);
    const check = validateSheetAdoptedPayload(JSON.parse(String(events[0]?.values[2])));
    expect(check.ok).toBe(true);
    expect(JSON.parse(String(events[0]?.values[2])).source).toBe('conversion');
    expect(JSON.parse(String(events[0]?.values[2])).sheet_hash).toBe(HASH);
  });

  it('refuses a named sheet value and writes nothing', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    await expect(applyAdoption(sql, SHARD, { [LIFE]: STANDARD_SHEET })).rejects.toThrow(
      'writes the standard sheet only (0328)',
    );
    expect(sql.calls).toHaveLength(0);
    expect(sql.live.get(LIFE)?.sheet_hash).toBeNull();
  });

  it('gives conflict for a life with a baseline and writes nothing', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: OTHER_HASH, died_at: null } });
    const lines = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(lines).toEqual([`${LIFE}: conflict`]);
    expect(sql.writes()).toHaveLength(0);
    expect(sql.live.get(LIFE)?.sheet_hash).toBe(OTHER_HASH);
  });

  it('gives same for a life already holding the standard sheet and writes nothing', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: HASH, died_at: null } });
    const lines = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(lines).toEqual([`${LIFE}: same`]);
    expect(sql.writes()).toHaveLength(0);
  });

  it('gives dead for a dead life and writes nothing', async () => {
    const sql = new ApplySql({
      [LIFE]: { sheet_hash: null, died_at: '2026-11-01T00:00:00Z' },
    });
    const lines = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(lines).toEqual([`${LIFE}: dead`]);
    expect(sql.writes()).toHaveLength(0);
  });

  it('a baseline written after the plan is read is conflict: the write is skipped and the baseline is byte-identical', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    sql.live.set(LIFE, { sheet_hash: OTHER_HASH, died_at: null });
    const lines = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(lines).toEqual([`${LIFE}: skipped`]);
    expect(sql.live.get(LIFE)?.sheet_hash).toBe(OTHER_HASH);
    expect(sql.audits()).toHaveLength(0);
  });

  it('a life that died after the plan is read gets no write', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    sql.live.set(LIFE, { sheet_hash: null, died_at: '2026-11-02T00:00:00Z' });
    const lines = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(lines).toEqual([`${LIFE}: skipped`]);
    expect(sql.live.get(LIFE)?.sheet_hash).toBeNull();
    expect(sql.audits()).toHaveLength(0);
  });

  it('a second apply on a stale read is skipped and adds no second audit row', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    const again = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(again).toEqual([`${LIFE}: skipped`]);
    expect(sql.audits()).toHaveLength(1);
  });

  it('a second apply after a fresh read is a no-op that reports same', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    sql.refresh();
    const again = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(again).toEqual([`${LIFE}: same`]);
    expect(sql.audits()).toHaveLength(1);
  });

  it('a failed audit insert rolls back the events row and the agents write, and reports failed', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    sql.failAudit = true;
    const lines = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(lines).toEqual([`${LIFE}: failed`]);
    const texts = sql.calls.map((c) => c.text);
    expect(texts.some((t) => t.startsWith('INSERT INTO events'))).toBe(true);
    expect(texts).toContain('ROLLBACK');
    expect(texts).not.toContain('COMMIT');
    expect(sql.live.get(LIFE)?.sheet_hash).toBeNull();
  });

  it('a unique violation on the event id is skipped: the earlier adoption stands and nothing is rolled forward', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    sql.eventError = {
      code: '23505',
      detail: `Key (source_event_id)=(conversion:sheet_adopted:${LIFE}) already exists.`,
    };
    const lines = await applyAdoption(sql, SHARD, { [LIFE]: 'standard' });
    expect(lines).toEqual([`${LIFE}: skipped`]);
    expect(sql.audits()).toHaveLength(0);
    expect(sql.calls.map((c) => c.text)).toContain('ROLLBACK');
    expect(sql.live.get(LIFE)?.sheet_hash).toBeNull();
  });

  it('another unique violation, on a different key, is a failed life, not a skip', async () => {
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    sql.eventError = { code: '23505', detail: 'Key (agent_id)=(ag_other) already exists.' };
    expect(await applyAdoption(sql, SHARD, { [LIFE]: 'standard' })).toEqual([`${LIFE}: failed`]);
  });

  it('a bad life id is failed before its transaction; the other lives still print', async () => {
    const BAD = 'Bad Life!';
    const sql = new ApplySql({
      [BAD]: { sheet_hash: null, died_at: null },
      [LIFE]: { sheet_hash: null, died_at: null },
    });
    const lines = await applyAdoption(sql, [BAD, LIFE], { [BAD]: 'standard', [LIFE]: 'standard' });
    expect(lines).toEqual([`${BAD}: failed`, `${LIFE}: adopted`]);
    expect(sql.calls.some((c) => c.values.includes(BAD))).toBe(false);
    expect(sql.live.get(BAD)?.sheet_hash).toBeNull();
    expect(sql.live.get(LIFE)?.sheet_hash).toBe(HASH);
  });
});

describe('player adopt-sheets --apply (cli)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function fixture(): Promise<{ shard: string; sheetsFile: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-apply-'));
    dirs.push(dir);
    const shard = join(dir, 'shard.yaml');
    const sheetsFile = join(dir, 'sheets.json');
    const mind = `mind:\n  lives: { strong: ${LIFE} }\n`;
    await writeFile(shard, SHARD_YAML.replace('shard: phase0\n', `shard: phase0\n${mind}`));
    await writeFile(sheetsFile, JSON.stringify({ [LIFE]: 'standard' }));
    return { shard, sheetsFile };
  }

  function capture(): Io & { outs: string[]; errs: string[] } {
    const outs: string[] = [];
    const errs: string[] = [];
    return { outs, errs, out: (line) => outs.push(line), err: (line) => errs.push(line) };
  }

  /** An env whose connect records each call: a refused run must never reach it. */
  function envFor(sql: ApplySql): { env: Env; connects: () => number } {
    let connects = 0;
    const env = {
      shardFile: '',
      secretDir: '',
      connect: async () => {
        connects += 1;
        return Object.assign(sql, { end: async () => {} });
      },
    } as unknown as Env;
    return { env, connects: () => connects };
  }

  it('--apply with a named sheet exits 2 before connecting, even in a mixed map', async () => {
    const { shard } = await fixture();
    const sheetsFile = join(dirs[0] ?? '', 'mixed.json');
    await writeFile(
      sheetsFile,
      JSON.stringify({ [LIFE]: 'standard', ag_other_01: STANDARD_SHEET }),
    );
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    const { env, connects } = envFor(sql);
    const out = capture();
    const code = await run(
      [
        'player',
        'adopt-sheets',
        '--shard',
        shard,
        '--sheets',
        sheetsFile,
        '--apply',
        '--operator-confirm',
      ],
      out,
      env,
    );
    expect(code).toBe(2);
    expect(out.errs).toEqual(['adopt-sheets: --apply writes the standard sheet only (0328)']);
    expect(connects()).toBe(0);
    expect(sql.calls).toHaveLength(0);
  });

  it('--apply with a named sheet only exits 2 before connecting', async () => {
    const { shard, sheetsFile } = await fixture();
    await writeFile(sheetsFile, JSON.stringify({ [LIFE]: 'named' }));
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    const { env, connects } = envFor(sql);
    const out = capture();
    const code = await run(
      [
        'player',
        'adopt-sheets',
        '--shard',
        shard,
        '--sheets',
        sheetsFile,
        '--apply',
        '--operator-confirm',
      ],
      out,
      env,
    );
    expect(code).toBe(2);
    expect(out.errs).toEqual(['adopt-sheets: --apply writes the standard sheet only (0328)']);
    expect(connects()).toBe(0);
  });

  it('--apply with --dry-run exits 2 before connecting', async () => {
    const { shard, sheetsFile } = await fixture();
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    const { env, connects } = envFor(sql);
    const out = capture();
    const code = await run(
      [
        'player',
        'adopt-sheets',
        '--shard',
        shard,
        '--sheets',
        sheetsFile,
        '--apply',
        '--operator-confirm',
        '--dry-run',
      ],
      out,
      env,
    );
    expect(code).toBe(2);
    expect(out.errs).toEqual(['adopt-sheets: --apply and --dry-run cannot be combined']);
    expect(connects()).toBe(0);
    expect(sql.calls).toHaveLength(0);
  });

  it('--apply where a life write fails prints the line and exits 1', async () => {
    const { shard, sheetsFile } = await fixture();
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    sql.failAudit = true;
    const { env } = envFor(sql);
    const out = capture();
    const code = await run(
      [
        'player',
        'adopt-sheets',
        '--shard',
        shard,
        '--sheets',
        sheetsFile,
        '--apply',
        '--operator-confirm',
      ],
      out,
      env,
    );
    expect(code).toBe(1);
    expect(out.outs).toEqual([`${LIFE}: failed`]);
  });

  it('dry run writes nothing: only the planner SELECT runs', async () => {
    const { shard, sheetsFile } = await fixture();
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    const env = {
      shardFile: shard,
      secretDir: '',
      connect: async () => Object.assign(sql, { end: async () => {} }),
    } as unknown as Env;
    const out = capture();
    const code = await run(
      ['player', 'adopt-sheets', '--shard', shard, '--sheets', sheetsFile],
      out,
      env,
    );
    expect(code).toBe(0);
    expect(out.outs).toEqual([`${LIFE}: would-adopt`]);
    expect(sql.writes()).toHaveLength(0);
  });

  it('--apply applies the standard sheet and prints adopted', async () => {
    const { shard, sheetsFile } = await fixture();
    const sql = new ApplySql({ [LIFE]: { sheet_hash: null, died_at: null } });
    const env = {
      shardFile: shard,
      secretDir: '',
      connect: async () => Object.assign(sql, { end: async () => {} }),
    } as unknown as Env;
    const out = capture();
    const code = await run(
      [
        'player',
        'adopt-sheets',
        '--shard',
        shard,
        '--sheets',
        sheetsFile,
        '--apply',
        '--operator-confirm',
      ],
      out,
      env,
    );
    expect(code).toBe(0);
    expect(out.outs).toEqual([`${LIFE}: adopted`]);
    expect(sql.live.get(LIFE)?.sheet_hash).toBe(HASH);
  });

  it('--apply without --operator-confirm exits 2 and connects to nothing', async () => {
    const { shard, sheetsFile } = await fixture();
    let connected = false;
    const env = {
      shardFile: shard,
      secretDir: '',
      connect: async () => {
        connected = true;
        throw new Error('must not connect');
      },
    } as unknown as Env;
    const out = capture();
    const code = await run(
      ['player', 'adopt-sheets', '--shard', shard, '--sheets', sheetsFile, '--apply'],
      out,
      env,
    );
    expect(code).toBe(2);
    expect(out.errs).toEqual(['adopt-sheets: --apply needs --operator-confirm']);
    expect(connected).toBe(false);
  });
});
