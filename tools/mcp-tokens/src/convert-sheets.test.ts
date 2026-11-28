import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STANDARD_SHEET } from '@geldar/psyche';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, type Io, run } from './cli.ts';
import { type PlanLine, planAdoption, readShardLives } from './convert-sheets.ts';
import type { Row, Sql } from './owners.ts';
import { SHARD_YAML } from './players.fakes.ts';
import { sheetHash } from './players.ts';

const LIVES = ['ag_adam_01', 'ag_adam_02', 'ag_ranger_01', 'ag_ranger_02', 'ag_ranger_03'];
const STANDARD_HASH = sheetHash(STANDARD_SHEET);
const OTHER_HASH = 'a'.repeat(64);

/** A stand-in for the agents table: it answers the one SELECT the planner runs and records every call. */
class AgentsSql implements Sql {
  calls: Array<{ text: string; values: unknown[] }> = [];
  private readonly rows: Row[];

  constructor(rows: Row[]) {
    this.rows = rows;
  }

  async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values });
    if (!text.startsWith('SELECT agent_id, died_at, sheet_hash FROM agents')) {
      throw new Error(`the stub has no answer for: ${text}`);
    }
    const wanted = values[0] as string[];
    return { rows: this.rows.filter((row) => wanted.includes(String(row.agent_id))) };
  }
}

function agent(life: string, baseline: string | null, diedAt: string | null = null): Row {
  return { agent_id: life, died_at: diedAt, sheet_hash: baseline };
}

function verdictOf(lines: PlanLine[], life: string): PlanLine | undefined {
  return lines.find((line) => line.life === life);
}

describe('planAdoption', () => {
  it('gives would-adopt for a NULL baseline', async () => {
    const sql = new AgentsSql([agent('ag_adam_01', null)]);
    const lines = await planAdoption(sql, LIVES, { ag_adam_01: 'standard' });
    expect(lines).toEqual([{ life: 'ag_adam_01', verdict: 'would-adopt' }]);
  });

  it('gives same when the baseline equals the sheet hash', async () => {
    const sql = new AgentsSql([agent('ag_adam_01', STANDARD_HASH)]);
    const lines = await planAdoption(sql, LIVES, { ag_adam_01: 'standard' });
    expect(lines).toEqual([{ life: 'ag_adam_01', verdict: 'same' }]);
  });

  it('gives conflict when the baseline differs; the database baseline wins', async () => {
    const sql = new AgentsSql([agent('ag_adam_01', OTHER_HASH)]);
    const lines = await planAdoption(sql, LIVES, { ag_adam_01: 'standard' });
    expect(lines).toEqual([{ life: 'ag_adam_01', verdict: 'conflict' }]);
  });

  it('refuses a malformed sheet with the life and the first bad field, and repairs nothing', async () => {
    const sql = new AgentsSql([agent('ag_adam_01', null)]);
    const lines = await planAdoption(sql, LIVES, { ag_adam_01: { bogus: 9 } });
    const line = verdictOf(lines, 'ag_adam_01');
    expect(line?.verdict).toBe('refused');
    expect(line?.field).toContain('bogus');
    expect(sql.calls).toHaveLength(1);
  });

  it('skips a dead life', async () => {
    const sql = new AgentsSql([agent('ag_adam_01', null, '2026-11-01T00:00:00Z')]);
    const lines = await planAdoption(sql, LIVES, { ag_adam_01: 'standard' });
    expect(lines).toEqual([{ life: 'ag_adam_01', verdict: 'dead' }]);
  });

  it('gives not-found for a life with no agents row', async () => {
    const sql = new AgentsSql([]);
    const lines = await planAdoption(sql, LIVES, { ag_ranger_01: 'standard' });
    expect(lines).toEqual([{ life: 'ag_ranger_01', verdict: 'not-found' }]);
  });

  it('refuses the whole run when a life is outside the shard file, and reads nothing', async () => {
    const sql = new AgentsSql([agent('ag_adam_01', null)]);
    await expect(planAdoption(sql, LIVES, { ag_outside_01: 'standard' })).rejects.toThrow(
      'ag_outside_01 is not in the shard file',
    );
    expect(sql.calls).toHaveLength(0);
  });

  it('runs only the one SELECT and never reads the owner', async () => {
    const sql = new AgentsSql([agent('ag_adam_01', null), agent('ag_ranger_01', STANDARD_HASH)]);
    await planAdoption(sql, LIVES, { ag_adam_01: 'standard', ag_ranger_01: 'standard' });
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.text).not.toMatch(/owner/i);
    expect(sql.calls[0]?.values).toEqual([['ag_adam_01', 'ag_ranger_01']]);
  });
});

describe('readShardLives', () => {
  it('reads the life ids of the mind tier table', () => {
    const text = 'shard: phase0\nmind:\n  lives: { strong: ag_adam_03, fast: ag_adam_04 }\n';
    expect(readShardLives(text)).toEqual(['ag_adam_03', 'ag_adam_04']);
  });

  it('reads the rangers from sovereign.players, as colo-mind.yaml lists them', () => {
    const text = [
      'mind:',
      '  lives: { strong: ag_adam_04 }',
      'sovereign:',
      '  players:',
      '    - { player_id: p1, life_id: ag_ranger_01, name: R1 }',
      '    - { player_id: p2, name: NoLife }',
      '',
    ].join('\n');
    expect(readShardLives(text)).toEqual(['ag_adam_04', 'ag_ranger_01']);
  });

  it('lets the planner accept a ranger life listed only under sovereign.players', async () => {
    const text =
      'sovereign:\n  players:\n    - { player_id: p1, life_id: ag_ranger_01, name: R1 }\n';
    const sql = new AgentsSql([agent('ag_ranger_01', null)]);
    const lines = await planAdoption(sql, readShardLives(text), { ag_ranger_01: 'standard' });
    expect(lines).toEqual([{ life: 'ag_ranger_01', verdict: 'would-adopt' }]);
  });

  it('reads nothing from a mind.lives that is a string rather than a mapping', () => {
    expect(readShardLives('mind:\n  lives: "ag_x_01"\n')).toEqual([]);
  });
});

describe('player adopt-sheets (dry run)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function fixture(sheets: unknown): Promise<{ shard: string; sheetsFile: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-sheets-'));
    dirs.push(dir);
    const shard = join(dir, 'shard.yaml');
    const sheetsFile = join(dir, 'sheets.json');
    const mind = `mind:\n  lives: { strong: ${LIVES[0]} }\n`;
    await writeFile(shard, SHARD_YAML.replace('shard: phase0\n', `shard: phase0\n${mind}`));
    await writeFile(sheetsFile, JSON.stringify(sheets));
    return { shard, sheetsFile };
  }

  function capture(): Io & { outs: string[]; errs: string[] } {
    const outs: string[] = [];
    const errs: string[] = [];
    return { outs, errs, out: (line) => outs.push(line), err: (line) => errs.push(line) };
  }

  it('prints one line per life and exits 0 without --apply', async () => {
    const { shard, sheetsFile } = await fixture({ [LIVES[0] as string]: 'standard' });
    const sql = new AgentsSql([agent(LIVES[0] as string, null)]);
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
    expect(out.outs).toEqual([`${LIVES[0]}: would-adopt`]);
    expect(sql.calls).toHaveLength(1);
  });

  it('refuses --apply without --operator-confirm with exit 2 and connects to nothing', async () => {
    const { shard, sheetsFile } = await fixture({ [LIVES[0] as string]: 'standard' });
    const out = capture();
    const env = { shardFile: shard, secretDir: '' } as unknown as Env;
    const code = await run(
      ['player', 'adopt-sheets', '--shard', shard, '--sheets', sheetsFile, '--apply'],
      out,
      env,
    );
    expect(code).toBe(2);
    expect(out.errs).toEqual(['adopt-sheets: --apply needs --operator-confirm']);
  });
});
