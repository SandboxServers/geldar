import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseSovereignShard } from './players.ts';

// The real colo shard file, the one the colo containers and the CLI read (decision 0180).
const COLO_SHARD = new URL('../../../shards/colo-mind.yaml', import.meta.url);

// The TNG crew: each player id, its life id and its short internal name, as the shard lists them.
const TNG_CREW = [
  ['ag-riker-01', 'ag_riker_01', 'Riker'],
  ['ag-data-01', 'ag_data_01', 'Data'],
  ['ag-troi-01', 'ag_troi_01', 'Troi'],
  ['ag-laforge-01', 'ag_laforge_01', 'LaForge'],
  ['ag-worf-01', 'ag_worf_01', 'Worf'],
  ['ag-bcrusher-01', 'ag_bcrusher_01', 'BCrusher'],
  ['ag-wcrusher-01', 'ag_wcrusher_01', 'WCrusher'],
] as const;

// The residents added to the colo shard (docs/analysis/residents): the same shape as the TNG crew.
const RESIDENTS = [
  ['ag-lewis-01', 'ag_lewis_01', 'Lewis'],
  ['ag-clark-01', 'ag_clark_01', 'Clark'],
] as const;

describe('the colo shard TNG crew players', () => {
  it('parses the real shard and lists all seven crew players, each id and life id once', () => {
    const text = readFileSync(COLO_SHARD, 'utf8');
    expect(parseSovereignShard(text).shard).toBe('colo');
    const players = (
      parse(text) as { sovereign: { players: { player_id: string; life_id: string }[] } }
    ).sovereign.players;
    const ids = players.map((p) => p.player_id);
    const lives = players.map((p) => p.life_id);
    for (const [playerId, lifeId] of TNG_CREW) {
      expect(ids).toContain(playerId);
      expect(lives).toContain(lifeId);
    }
    for (const [playerId, lifeId] of RESIDENTS) {
      expect(ids).toContain(playerId);
      expect(lives).toContain(lifeId);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(lives).size).toBe(lives.length);
    // 15 before the residents were added, 17 with them. A change here is a deliberate roster change.
    expect(players).toHaveLength(17);
  });
});

describe('the colo shard harnesses', () => {
  const shard = parseSovereignShard(readFileSync(COLO_SHARD, 'utf8'));

  it('enables the chatgpt harness, so player add accepts --harness chatgpt', () => {
    expect(shard.shard).toBe('colo');
    expect(shard.harnesses.chatgpt).toEqual({ enabled: true });
  });

  it('keeps the claude harness enabled', () => {
    expect(shard.harnesses.claude).toEqual({ enabled: true });
  });
});
