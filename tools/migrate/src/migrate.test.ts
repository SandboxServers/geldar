import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { listMigrations, type MigrationFile, needsBaseline, pendingMigrations } from './migrate.ts';

const SQL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'sql');

const FILES: MigrationFile[] = [
  { version: '0001', name: '0001_init.sql', path: '/x/0001_init.sql' },
  { version: '0002', name: '0002_sovereign_mcp.sql', path: '/x/0002_sovereign_mcp.sql' },
];

describe('listMigrations', () => {
  it('lists the real sql directory in name order, without the test scripts', async () => {
    const files = await listMigrations(SQL_DIR);
    expect(files.map((file) => file.name)).toEqual([
      '0001_init.sql',
      '0002_sovereign_mcp.sql',
      '0003_mcp_sleep_marks.sql',
      '0004_mcp_sleep_marks_grants.sql',
      '0005_glass_reader.sql',
      '0006_owner_cap_trigger.sql',
      '0007_journals_append_only.sql',
      '0008_register_identities.sql',
      '0009_register_mint_function.sql',
      '0010_register_definer_functions.sql',
      '0011_register_signup_function.sql',
      '0012_register_read_functions.sql',
      '0013_register_daily_owner_cap.sql',
      '0014_kino_access.sql',
      '0015_kino_audit.sql',
      '0016_thought_visibility.sql',
      '0017_kino_scope_functions.sql',
      '0018_kino_agent_list.sql',
      '0019_kino_agent_list_no_owner.sql',
      '0020_glass_journal_thoughts.sql',
      '0021_register_sessions.sql',
      '0022_register_consents.sql',
      '0023_death_count.sql',
    ]);
  });

  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function dirWith(names: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'geldar-migrate-'));
    dirs.push(dir);
    for (const name of names) await writeFile(join(dir, name), '-- test\n');
    return dir;
  }

  it('refuses two files with the same version', async () => {
    const dir = await dirWith(['0001_a.sql', '0001_b.sql']);
    await expect(listMigrations(dir)).rejects.toThrow('share a version');
  });

  it('refuses a numbered file that is not NNNN_name.sql', async () => {
    const dir = await dirWith(['0003.sql']);
    await expect(listMigrations(dir)).rejects.toThrow('must be NNNN_name.sql');
  });
});

describe('pendingMigrations', () => {
  it('applies everything on a fresh database', () => {
    expect(pendingMigrations(FILES, new Set()).map((file) => file.version)).toEqual([
      '0001',
      '0002',
    ]);
  });

  it('applies only the later files to a baselined database', () => {
    expect(pendingMigrations(FILES, new Set(['0001'])).map((file) => file.version)).toEqual([
      '0002',
    ]);
  });

  it('does nothing when every file is recorded', () => {
    expect(pendingMigrations(FILES, new Set(['0001', '0002']))).toEqual([]);
  });
});

describe('needsBaseline', () => {
  it('baselines a schema that has agents but no ledger', () => {
    expect(needsBaseline(false, true)).toBe(true);
  });

  it('does not baseline a database that has a ledger', () => {
    expect(needsBaseline(true, true)).toBe(false);
  });

  it('does not baseline an empty database', () => {
    expect(needsBaseline(false, false)).toBe(false);
  });
});
