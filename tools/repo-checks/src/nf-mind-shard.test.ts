/**
 * shards/nf-mind.yaml: the NeoForge rangers' shard file (decision 0480). The real parsers of the MCP and the player
 * host read it, so a value they refuse fails here, before the node sees it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parsePlayerConfig } from '../../../golem/src/players/player-config.ts';
import { parseMcpConfig } from '../../../threshold/mcp/src/config.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NF_TEXT = readFileSync(join(ROOT, 'shards', 'nf-mind.yaml'), 'utf8');
const COLO_TEXT = readFileSync(join(ROOT, 'shards', 'colo-mind.yaml'), 'utf8');

const RANGERS = [
  { player_id: 'ag-turboyelo-01', life_id: 'ag_turboyelo_01', name: 'TurboYellow' },
  { player_id: 'ag-turbogreen-01', life_id: 'ag_turbogreen_01', name: 'TurboGreen' },
  { player_id: 'ag-turboblue-01', life_id: 'ag_turboblue_01', name: 'TurboBlue' },
  { player_id: 'ag-turbored-01', life_id: 'ag_turbored_01', name: 'TurboRed' },
  { player_id: 'ag-turbopink-01', life_id: 'ag_turbopink_01', name: 'TurboPink' },
];

// The life id rule the MCP and the registry enforce (threshold/mcp config.ts LIFE_ID; LifeRegistry {1,16}).
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;
const NAME = /^[A-Za-z0-9_]{1,16}$/;

type Players = { sovereign: { players: { player_id: string; life_id: string; name: string }[] } };

function players(text: string): Players['sovereign']['players'] {
  return (parse(text) as Players).sovereign.players;
}

describe('shards/nf-mind.yaml', () => {
  const doc = parse(NF_TEXT) as Record<string, unknown>;

  it('parses with the MCP config parser', () => {
    const env = {
      GELDAR_SHARD: 'nf',
      GELDAR_MCP_DB_PASSWORD_FILE: '/run/secrets/postgres-mcp.txt',
      GELDAR_MCP_PEPPER_FILE: '/run/secrets/mcp-token-pepper.txt',
    };
    expect(() => parseMcpConfig(doc, { env })).not.toThrow();
  });

  it.each(RANGERS)('parses $player_id with the player host parser', ({ player_id }) => {
    expect(() => parsePlayerConfig(doc, player_id)).not.toThrow();
  });

  it('is the nf shard and watched', () => {
    expect(doc.shard).toBe('nf');
    expect(doc.identity_mode).toBe('watched');
  });

  it('lists exactly the five Turbo rangers, in order', () => {
    expect(players(NF_TEXT)).toEqual(RANGERS);
  });

  it('keeps every life id valid and 16 characters or fewer', () => {
    for (const p of players(NF_TEXT)) {
      expect(p.life_id).toMatch(LIFE_ID);
      expect(p.life_id.length).toBeLessThanOrEqual(16);
    }
  });

  it('keeps every name 1 to 16 characters of letters, digits and underscore', () => {
    for (const p of players(NF_TEXT)) {
      expect(p.name).toMatch(NAME);
    }
  });

  it('maps each player id to its life id with dashes and underscores', () => {
    for (const p of players(NF_TEXT)) {
      expect(p.life_id).toBe(p.player_id.replaceAll('-', '_'));
    }
  });

  it('names no colo life or player', () => {
    const colo = new Set(players(COLO_TEXT).flatMap((p) => [p.player_id, p.life_id]));
    for (const p of players(NF_TEXT)) {
      expect(colo.has(p.player_id)).toBe(false);
      expect(colo.has(p.life_id)).toBe(false);
    }
  });
});
