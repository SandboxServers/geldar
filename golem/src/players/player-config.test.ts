import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { repoRoot } from '../config.ts';
import { lifeIdForPlayer, parsePlayerConfig } from './player-config.ts';

/** The real shard file, parsed fresh for each test so a test can change it. */
async function shardDoc(): Promise<Record<string, unknown>> {
  const text = await readFile(join(repoRoot(), 'shards', 'phase0.yaml'), 'utf8');
  return parse(text) as Record<string, unknown>;
}

function sovereignOf(doc: Record<string, unknown>): Record<string, unknown> {
  return doc.sovereign as Record<string, unknown>;
}

describe('lifeIdForPlayer', () => {
  it('turns hyphens into underscores and keeps the life id pattern', () => {
    expect(lifeIdForPlayer('ag-jason-01')).toBe('ag_jason_01');
    expect(lifeIdForPlayer('ag-kimberly-01')).toBe('ag_kimberly_01');
  });

  it('returns null for an id that is not a player id', () => {
    expect(lifeIdForPlayer('ag_jason_01')).toBeNull();
    expect(lifeIdForPlayer('ag-Jason-01')).toBeNull();
    expect(lifeIdForPlayer('ag-jason-1')).toBeNull();
    expect(lifeIdForPlayer('ag-jason-01-extra-long-name-here')).toBeNull();
  });
});

describe('parsePlayerConfig', () => {
  it('builds the AdamConfig shape from the player entry', async () => {
    const config = parsePlayerConfig(await shardDoc(), 'ag-jason-01');
    expect(config.lifeId).toBe('ag_jason_01');
    expect(config.displayName).toBe('Jason');
    expect(config.playerId).toBe('ag-jason-01');
    expect(config.start).toBe('on_demand');
    expect(config.shard).toBe('phase0');
    expect(config.maxChars).toBeGreaterThan(0);
    expect(config.timeScale).toBeGreaterThan(0);
  });

  it('reads the presence start mode', async () => {
    const doc = await shardDoc();
    (sovereignOf(doc).presence as Record<string, unknown>).start = 'always';
    expect(parsePlayerConfig(doc, 'ag-tommy-01').start).toBe('always');
  });

  it('refuses a presence start mode it does not know', async () => {
    const doc = await shardDoc();
    (sovereignOf(doc).presence as Record<string, unknown>).start = 'sometimes';
    expect(() => parsePlayerConfig(doc, 'ag-tommy-01')).toThrow(/on_demand or always/);
  });

  it('refuses a player id that is not listed', async () => {
    const doc = await shardDoc();
    expect(() => parsePlayerConfig(doc, 'ag-nobody-01')).toThrow(/not in/);
  });

  it('refuses a malformed player id', async () => {
    const doc = await shardDoc();
    expect(() => parsePlayerConfig(doc, 'ag_jason_01')).toThrow(/player pattern/);
  });

  it("refuses Adam's life ids from mind.lives", async () => {
    const doc = await shardDoc();
    const players = sovereignOf(doc).players as Record<string, string>[];
    players.push({ player_id: 'ag-adam-01', life_id: 'ag_adam_01', name: 'Adam' });
    expect(() => parsePlayerConfig(doc, 'ag-adam-01')).toThrow(/Adam's life id/);
  });

  it('refuses an entry whose life_id is not the underscore form of its player id', async () => {
    const doc = await shardDoc();
    const players = sovereignOf(doc).players as Record<string, string>[];
    const jason = players.find((p) => p.player_id === 'ag-jason-01');
    if (jason !== undefined) jason.life_id = 'ag_billy_01';
    expect(() => parsePlayerConfig(doc, 'ag-jason-01')).toThrow(/has life_id/);
  });

  it('refuses an entry with no display name', async () => {
    const doc = await shardDoc();
    const players = sovereignOf(doc).players as Record<string, string>[];
    const jason = players.find((p) => p.player_id === 'ag-jason-01');
    if (jason !== undefined) jason.name = ' ';
    expect(() => parsePlayerConfig(doc, 'ag-jason-01')).toThrow(/has no name/);
  });
});
