import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Env, type Io, run } from './cli.ts';
import type { Row } from './owners.ts';
import {
  type Call,
  FakeSql,
  player,
  SHARD,
  SHARD_YAML,
  SHEET_SHARD,
  SHEET_SHARD_YAML,
} from './players.fakes.ts';
import { addPlayer, parseSovereignShard, readSheetFile, SHEET_LIFE_ID } from './players.ts';

/** A fake that also takes the sheet statements: the events row and the adoption row, recorded and not stored. */
class SheetSql extends FakeSql {
  failAdoption = false;

  constructor() {
    super();
    this.owners.set('jo', 3);
  }

  override async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    const adoptionStatement =
      text.startsWith('INSERT INTO events') ||
      text.startsWith('INSERT INTO character_sheet_adoptions');
    if (!adoptionStatement) return super.query(text, values);
    this.log.push(text);
    this.calls.push({ text, values });
    if (this.failAdoption && text.startsWith('INSERT INTO character_sheet_adoptions')) {
      throw new Error('adoption insert refused');
    }
    return { rows: [] };
  }
}

/** The one statement the fake received that starts with `prefix`; more or fewer fails the test. */
function only(sql: FakeSql, prefix: string): Call {
  const found = sql.calls.filter((c) => c.text.startsWith(prefix));
  if (found.length !== 1) throw new Error(`expected one ${prefix}, got ${found.length}`);
  return found[0] as Call;
}

/**
 * The column-to-value map of an INSERT: `$n` takes values[n-1] (its cast dropped), a quoted literal
 * its text, NULL null, a number a number; `now()` and a CASE that ends in now() read as 'now()'.
 * The statement's own column list and VALUES list are read, so a swapped placeholder shows up here.
 */
function bindings(call: Call): Record<string, unknown> {
  const { text, values } = call;
  const columns = text
    .slice(text.indexOf('(') + 1, text.indexOf(')'))
    .split(',')
    .map((c) => c.trim());
  const valuesAt = text.search(/VALUES \(/) + 'VALUES ('.length;
  const items = text
    .slice(valuesAt, text.lastIndexOf(')'))
    .split(',')
    .map((s) => s.trim());
  const out: Record<string, unknown> = {};
  columns.forEach((name, i) => {
    out[name] = resolve(items[i] ?? '', values);
  });
  return out;
}

function resolve(item: string, values: unknown[]): unknown {
  const bound = /^\$(\d+)(::\w+)?$/.exec(item);
  if (bound) return values[Number(bound[1]) - 1];
  if (item === 'NULL') return null;
  if (item === 'now()') return 'now()';
  if (item.startsWith('CASE')) return item.includes('ELSE now()') ? 'now()' : item;
  const literal = /^'(.*)'$/.exec(item);
  if (literal) return literal[1];
  return Number(item);
}

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Canonical JSON (sorted keys, no whitespace) written out by hand, so the hash test does not reuse psyche. */
const STANDARD_CANON =
  '{"alignment":{"good":3,"law":3},"attributes":{"aggression":3,"cleverness":3,"common_sense":3,"curiosity":3},"op_modes":{"builder":3,"crafter":3,"explorer":3,"farmer":3,"miner":3,"nitwit":3,"warrior":3},"version":1}';
const GIVEN_CANON =
  '{"alignment":{"good":2,"law":4},"attributes":{"aggression":1,"cleverness":4,"common_sense":2,"curiosity":5},"op_modes":{"builder":3,"crafter":4,"explorer":5,"farmer":1,"miner":2,"nitwit":2,"warrior":1},"version":1}';
/** A sheet whose keys are not in canonical order. */
const GIVEN = {
  version: 1,
  attributes: { curiosity: 5, common_sense: 2, cleverness: 4, aggression: 1 },
  alignment: { good: 2, law: 4 },
  op_modes: { warrior: 1, nitwit: 2, miner: 2, farmer: 1, explorer: 5, crafter: 4, builder: 3 },
};

describe('character.mode in the shard', () => {
  it('reads sheet; an omitted mode, or mode off, is off; any other mode throws', () => {
    expect(SHEET_SHARD.characterMode).toBe('sheet');
    expect(SHARD.characterMode).toBe('off');
    expect(parseSovereignShard(`${SHARD_YAML}character:\n  mode: off\n`).characterMode).toBe('off');
    expect(parseSovereignShard(`${SHARD_YAML}character: {}\n`).characterMode).toBe('off');
    expect(() => parseSovereignShard(`${SHARD_YAML}character:\n  mode: sometimes\n`)).toThrow(
      'character.mode must be off or sheet',
    );
  });
});

describe('roster creation in a sheet-mode shard', () => {
  it('writes the standard sheet, its hash, the adoption time, and the agents row', async () => {
    const sql = new SheetSql();
    const p = player(1);
    await addPlayer(sql, p, SHEET_SHARD);
    const agents = bindings(only(sql, 'INSERT INTO agents'));
    expect(JSON.parse(String(agents.character_sheet))).toEqual(JSON.parse(STANDARD_CANON));
    expect(agents.sheet_hash).toBe(sha(STANDARD_CANON));
    expect(agents.sheet_adopted_at).toBe('now()');
    expect(agents).toMatchObject({
      agent_id: p.life,
      game_account: p.life,
      name: p.name,
      shard: 'phase0',
      mode: 'sovereign',
      owner: 'jo',
      harness: 'claude',
      declared_model: 'self-reported',
      model_config: 'declared:unverified',
      tier: 'sovereign',
      life_seq: 1,
      personality_seed: null,
    });
  });

  it('binds the seed text and the declared model to their own columns', async () => {
    const sql = new SheetSql();
    const p = {
      ...player(1),
      model: 'claude-sonnet-5.5',
      seed: { identity: 'Curious.', goals: '' },
    };
    await addPlayer(sql, p, SHEET_SHARD);
    expect(bindings(only(sql, 'INSERT INTO agents'))).toMatchObject({
      personality_seed: 'Curious.',
      declared_model: 'claude-sonnet-5.5',
    });
  });

  it('records one sheet_adopted event and one adoption, both for the life, with the given values', async () => {
    const sql = new SheetSql();
    const p = player(1);
    await addPlayer(sql, p, SHEET_SHARD);
    const event = bindings(only(sql, 'INSERT INTO events'));
    const adoption = bindings(only(sql, 'INSERT INTO character_sheet_adoptions'));
    expect(event).toMatchObject({
      source_event_id: `roster:sheet_adopted:${p.life}`,
      type: 'sheet_adopted',
      agent_id: p.life,
      at: 'now()',
    });
    expect(adoption).toEqual({
      source_event_id: `roster:sheet_adopted:${p.life}`,
      life_id: p.life,
      sheet_hash: sha(STANDARD_CANON),
      sheet: String(adoption.sheet),
      source: 'roster',
      result: 'adopted',
    });
    expect(JSON.parse(String(adoption.sheet))).toEqual(JSON.parse(STANDARD_CANON));
  });

  it('gives the event a payload with the life, sheet, hash and source', async () => {
    const sql = new SheetSql();
    const p = player(1);
    await addPlayer(sql, p, SHEET_SHARD);
    const payload = JSON.parse(String(bindings(only(sql, 'INSERT INTO events')).payload));
    expect(payload).toEqual({
      life_id: p.life,
      sheet: JSON.parse(STANDARD_CANON),
      sheet_hash: sha(STANDARD_CANON),
      source: 'roster',
    });
    expect(SHEET_LIFE_ID.test(payload.life_id)).toBe(true);
  });

  it('adopts a given sheet as given, and its hash is that of the canonical JSON', async () => {
    const sql = new SheetSql();
    const p = { ...player(2), characterSheet: GIVEN };
    await addPlayer(sql, p, SHEET_SHARD);
    const agents = bindings(only(sql, 'INSERT INTO agents'));
    expect(agents.sheet_hash).toBe(sha(GIVEN_CANON));
    expect(JSON.parse(String(agents.character_sheet))).toEqual(GIVEN);
    expect(bindings(only(sql, 'INSERT INTO character_sheet_adoptions')).sheet_hash).toBe(
      sha(GIVEN_CANON),
    );
  });

  it('records the adoption in the same transaction, between BEGIN and COMMIT', async () => {
    const sql = new SheetSql();
    await addPlayer(sql, player(1), SHEET_SHARD);
    const at = (prefix: string): number => sql.log.findIndex((t) => t.startsWith(prefix));
    const adoption = at('INSERT INTO character_sheet_adoptions');
    expect(adoption).toBeGreaterThan(-1);
    expect(sql.log.indexOf('BEGIN')).toBeLessThan(at('INSERT INTO agents'));
    expect(at('INSERT INTO agents')).toBeLessThan(at('INSERT INTO events'));
    expect(at('INSERT INTO events')).toBeLessThan(adoption);
    expect(adoption).toBeLessThan(sql.log.indexOf('COMMIT'));
  });

  it('refuses a malformed sheet before any write, naming the field and not its value', async () => {
    const sql = new SheetSql();
    const bad = { ...GIVEN, attributes: { ...GIVEN.attributes, curiosity: 9 } };
    const error = await addPlayer(sql, { ...player(3), characterSheet: bad }, SHEET_SHARD).catch(
      (e: unknown) => e,
    );
    expect(String(error)).toContain('attributes.curiosity');
    expect(String(error)).not.toContain('9');
    expect(sql.log).toEqual([]);
    expect(sql.agents).toEqual([]);
  });

  it('refuses a sheet in an off shard and writes nothing', async () => {
    const sql = new SheetSql();
    await expect(addPlayer(sql, { ...player(4), characterSheet: GIVEN }, SHARD)).rejects.toThrow(
      'the shard has character mode off',
    );
    expect(sql.log).toEqual([]);
  });

  it('rolls the whole add back when the adoption insert fails', async () => {
    const sql = new SheetSql();
    sql.failAdoption = true;
    await expect(addPlayer(sql, player(6), SHEET_SHARD)).rejects.toThrow('adoption insert refused');
    expect(sql.log).toContain('ROLLBACK');
    expect(sql.log).not.toContain('COMMIT');
    expect(sql.players).toEqual([]);
    expect(sql.budgets).toEqual([]);
  });
});

describe('roster creation in an off shard keeps the original statements', () => {
  it('runs the agents insert with its seven original columns and no sheet column', async () => {
    const sql = new FakeSql();
    sql.owners.set('jo', 20);
    await addPlayer(sql, player(5), SHARD);
    const agents = only(sql, 'INSERT INTO agents');
    const columns = agents.text
      .slice(agents.text.indexOf('(') + 1, agents.text.indexOf(')'))
      .split(',')
      .map((c) => c.trim());
    expect(columns).toEqual([
      'agent_id',
      'name',
      'life_seq',
      'game_account',
      'shard',
      'mode',
      'owner',
      'harness',
      'declared_model',
      'model_config',
      'tier',
      'personality_seed',
    ]);
    expect(agents.values).toHaveLength(7);
    for (const word of ['character_sheet', 'sheet_hash', 'sheet_adopted_at']) {
      expect(agents.text).not.toContain(word);
    }
    expect(bindings(agents)).toMatchObject({
      agent_id: 'ag_jo_05',
      declared_model: 'self-reported',
    });
  });

  it('runs no statement but the roster ones, the agents row, the player row and the budget', async () => {
    const sql = new FakeSql();
    sql.owners.set('jo', 20);
    await addPlayer(sql, player(5), SHARD);
    const writes = sql.calls
      .filter((c) => /^(INSERT|UPDATE|DELETE)/.test(c.text))
      .map((c) => c.text.split(' (')[0]);
    expect(writes).toEqual([
      'INSERT INTO agents',
      'INSERT INTO mcp_players',
      'INSERT INTO mcp_budget',
    ]);
  });

  it('writes no adoption and no event in an off shard', async () => {
    const sql = new SheetSql();
    await addPlayer(sql, player(5), SHARD);
    expect(
      sql.calls.some((c) => /^INSERT INTO (events|character_sheet_adoptions)/.test(c.text)),
    ).toBe(false);
  });
});

describe('the sheet life must take the contract sheet event (LifeId)', () => {
  it.each(['ag_jo_smith_01', 'ag_jo'])(
    'refuses %s in sheet mode with the LifeId reason, before any write',
    async (life) => {
      const sql = new SheetSql();
      await expect(addPlayer(sql, { ...player(1), life }, SHEET_SHARD)).rejects.toThrow(
        `life ${life} cannot take a sheet: `,
      );
      await expect(addPlayer(sql, { ...player(1), life }, SHEET_SHARD)).rejects.toThrow(
        /cannot take a sheet: its id must match/,
      );
      expect(sql.log).toEqual([]);
    },
  );

  it.each(['ag_jo_smith_01', 'ag_jo'])('keeps the looser rule in off mode for %s', async (life) => {
    const sql = new FakeSql();
    sql.owners.set('jo', 20);
    await addPlayer(sql, { ...player(1), life }, SHARD);
    expect(sql.agents).toEqual([life]);
  });

  it('accepts the ag_jo_01 life in sheet mode', async () => {
    const sql = new SheetSql();
    await addPlayer(sql, player(1), SHEET_SHARD);
    expect(sql.calls.some((c) => c.text.startsWith('INSERT INTO agents'))).toBe(true);
  });
});

describe('readSheetFile', () => {
  let dir = '';
  afterEach(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('reads a YAML file and a JSON file to the same value', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-sheet-'));
    const yaml = join(dir, 'sheet.yaml');
    const json = join(dir, 'sheet.json');
    await writeFile(
      yaml,
      'version: 1\nattributes: {curiosity: 5, common_sense: 2, cleverness: 4, aggression: 1}\n' +
        'alignment: {good: 2, law: 4}\n' +
        'op_modes: {warrior: 1, nitwit: 2, miner: 2, farmer: 1, explorer: 5, crafter: 4, builder: 3}\n',
    );
    await writeFile(json, JSON.stringify(GIVEN));
    expect(await readSheetFile(yaml)).toEqual(GIVEN);
    expect(await readSheetFile(json)).toEqual(GIVEN);
  });

  it('reads an empty file as null, which the sheet check then refuses', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-sheet-'));
    const empty = join(dir, 'empty.yaml');
    await writeFile(empty, '');
    expect(await readSheetFile(empty)).toBeNull();
  });

  it('refuses malformed YAML with a fixed message that does not echo the file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-sheet-'));
    const bad = join(dir, 'bad.yaml');
    await writeFile(bad, 'version: 1\nSECRET-VALUE: [unclosed\n');
    const error = await readSheetFile(bad).catch((e: unknown) => e);
    expect(String(error)).toContain('the sheet file is not valid YAML or JSON');
    expect(String(error)).not.toContain('SECRET-VALUE');
  });

  it('accepts a file of exactly 16384 bytes and refuses one of 16385', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-sheet-'));
    const head = 'version: 1\n#';
    const under = join(dir, 'under.yaml');
    const over = join(dir, 'over.yaml');
    await writeFile(under, `${head}${'a'.repeat(16384 - head.length)}`);
    await writeFile(over, `${head}${'a'.repeat(16385 - head.length)}`);
    expect(Buffer.byteLength(`${head}${'a'.repeat(16384 - head.length)}`)).toBe(16384);
    expect(await readSheetFile(under)).toEqual({ version: 1 });
    await expect(readSheetFile(over)).rejects.toThrow('the sheet file is over 16384 bytes');
  });
});

describe('player add --sheet-file in a sheet-mode shard, through the CLI', () => {
  let dir = '';
  afterEach(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('adopts the sheet in the file: the canonical hash goes to the agents row and the adoption', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-sheet-'));
    const shardFile = join(dir, 'phase0.yaml');
    const sheetFile = join(dir, 'sheet.json');
    await writeFile(shardFile, SHEET_SHARD_YAML);
    await writeFile(sheetFile, JSON.stringify(GIVEN));
    const sql = new SheetSql();
    const errors: string[] = [];
    const io: Io = { out: () => {}, err: (line) => errors.push(line) };
    const env: Env = {
      secretDir: join(dir, 'secrets'),
      shardFile,
      connect: async () => Object.assign(sql, { end: async () => {} }),
    };
    const code = await run(
      [
        'player',
        'add',
        'ag-jo-01',
        '--owner',
        'jo',
        '--life',
        'ag_jo_01',
        '--name',
        'Player 1',
        '--harness',
        'claude',
        '--sheet-file',
        sheetFile,
      ],
      io,
      env,
    );
    expect(errors).toEqual([]);
    expect(code).toBe(0);
    const agents = bindings(only(sql, 'INSERT INTO agents'));
    expect(agents.sheet_hash).toBe(sha(GIVEN_CANON));
    expect(JSON.parse(String(agents.character_sheet))).toEqual(GIVEN);
    const event = bindings(only(sql, 'INSERT INTO events'));
    expect(event.source_event_id).toBe('roster:sheet_adopted:ag_jo_01');
    expect(bindings(only(sql, 'INSERT INTO character_sheet_adoptions')).sheet_hash).toBe(
      sha(GIVEN_CANON),
    );
  });
});

describe('the sheet LifeId is the contract LifeId', () => {
  it('SHEET_LIFE_ID is the LifeId pattern of contract/schemas/common.schema.json', () => {
    const common = JSON.parse(
      readFileSync(
        new URL('../../../contract/schemas/common.schema.json', import.meta.url),
        'utf8',
      ),
    );
    expect(SHEET_LIFE_ID.source).toBe(common.$defs.LifeId.pattern);
  });
});
