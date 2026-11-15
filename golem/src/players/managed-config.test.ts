import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from '../config.ts';
import { managedLifeId, parseManagedPlayerConfig } from './managed-config.ts';

const LIFE = 'ag_abc123def456';

/** The real shard file, parsed fresh for each test so a test can change it. */
async function shardDoc(): Promise<Record<string, unknown>> {
  const text = await readFile(join(repoRoot(), 'shards', 'phase0.yaml'), 'utf8');
  return parse(text) as Record<string, unknown>;
}

/** A host row as `player_host_config` returns it. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    display_name: 'Kestrel',
    harness: 'claude',
    model: 'claude-sonnet-5',
    character_sheet: null,
    ...overrides,
  };
}

describe('parseManagedPlayerConfig', () => {
  it('builds the config from a fake database row and the shard file', async () => {
    const config = parseManagedPlayerConfig(await shardDoc(), LIFE, row());
    expect(config.lifeId).toBe(LIFE);
    expect(config.playerId).toBe(LIFE);
    expect(config.displayName).toBe('Kestrel');
    expect(config.start).toBe('always');
    expect(config.shard).toBe('phase0');
    expect(config.maxChars).toBeGreaterThan(0);
  });

  it('passes the stored harness and model on with the config', async () => {
    const config = parseManagedPlayerConfig(await shardDoc(), LIFE, row());
    expect(config.stamp).toEqual({ harness: 'claude', model: 'claude-sonnet-5' });
  });

  it('accepts a null harness, model and sheet as absent', async () => {
    const config = parseManagedPlayerConfig(
      await shardDoc(),
      LIFE,
      row({ harness: null, model: null }),
    );
    expect(config.stamp).toBeUndefined();
  });

  it('refuses Adam life id, as parsePlayerConfig does', async () => {
    const doc = await shardDoc();
    const mind = doc.mind as Record<string, unknown>;
    mind.lives = { adam: 'ag_adamlife0001' };
    expect(() => parseManagedPlayerConfig(doc, 'ag_adamlife0001', row())).toThrow(/Adam's life id/);
  });

  it('refuses a row that is not exactly the four keys', async () => {
    const doc = await shardDoc();
    expect(() => parseManagedPlayerConfig(doc, LIFE, { ...row(), owner_id: 'x' })).toThrow(
      /exactly display_name/,
    );
    const { model: _model, ...short } = row();
    expect(() => parseManagedPlayerConfig(doc, LIFE, short)).toThrow(/exactly display_name/);
  });

  it('refuses a row with no display name', async () => {
    await expect(async () =>
      parseManagedPlayerConfig(await shardDoc(), LIFE, row({ display_name: ' ' })),
    ).rejects.toThrow(/has no name/);
  });
});

describe('managedLifeId', () => {
  it('accepts ag_ and 1 to 12 lower-case letters or digits', () => {
    expect(managedLifeId('ag_abc123def456')).toBe('ag_abc123def456');
    expect(managedLifeId('ag_a')).toBe('ag_a');
  });

  it('refuses malformed and injection-shaped ids', () => {
    const hostile = [
      'AG_ABC123DEF456',
      'ag_ABC123',
      'ag_abc def',
      'ag_abcdef0123456',
      'ag_',
      'ag_abc_def',
      "ag_x'; DROP TABLE mcp_players; --",
      'ag_abc$(reboot)',
      'ag_abc;rm',
      'ag_abc\n',
      'ag-abc',
      '',
      undefined,
    ];
    for (const value of hostile) {
      expect(() => managedLifeId(value), String(value)).toThrow(/managed life id/);
    }
  });

  it('refuses a malformed id before the row is read', async () => {
    await expect(async () =>
      parseManagedPlayerConfig(await shardDoc(), 'ag_ABC', row()),
    ).rejects.toThrow(/managed life id/);
  });
});
