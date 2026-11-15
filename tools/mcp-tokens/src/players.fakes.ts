import type { Row, Sql } from './owners.ts';
import { type NewPlayer, parseSovereignShard } from './players.ts';

/** One statement the fake received, with the values bound to it. */
export interface Call {
  text: string;
  values: unknown[];
}

/** An in-memory stand-in for the tables the commands touch; it answers only those statements. */
export class FakeSql implements Sql {
  owners = new Map<string, number>();
  /** The starting roster: the names `player()` uses, listed for owner jo with one agent each. */
  roster = new Map<string, { owner_id: string; max_agents: number }>(
    Array.from({ length: 30 }, (_, i) => [`player ${i + 1}`, { owner_id: 'jo', max_agents: 1 }]),
  );
  players: Array<{
    player_id: string;
    owner_id: string;
    life_id: string;
    display_name: string;
    status: string;
  }> = [];
  agents: string[] = [];
  budgets: string[] = [];
  revokedFor: string[] = [];
  log: string[] = [];
  /** Every statement with its bound values, in the order received. */
  calls: Call[] = [];
  /** The declared_model of each life, as the agents insert and the model update leave it. */
  declared = new Map<string, string>();

  async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.log.push(text);
    this.calls.push({ text, values });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
    if (text.startsWith('INSERT INTO mcp_owners')) {
      this.owners.set(String(values[0]), Number(values[1]));
      return { rows: [] };
    }
    if (text.startsWith('UPDATE mcp_owners')) {
      const id = String(values[0]);
      if (!this.owners.has(id)) return { rows: [] };
      this.owners.set(id, Number(values[1]));
      return { rows: [{ owner_id: id }] };
    }
    if (text.includes('FROM mcp_owners')) {
      const id = String(values[0]);
      return { rows: this.owners.has(id) ? [{ player_cap: this.owners.get(id) }] : [] };
    }
    if (text.includes('FOR UPDATE') && text.includes('FROM mcp_roster')) {
      const entry = this.roster.get(String(values[0]));
      return { rows: entry === undefined ? [] : [{ ...entry }] };
    }
    if (text.includes('count(*)') && text.includes('lower(display_name) = $1')) {
      // Mirrors the SQL: the roster count compares lower(display_name) to the lower-cased name.
      const wanted = String(values[0]);
      const n = this.players.filter(
        (p) => p.display_name.toLowerCase() === wanted && p.status !== 'retired',
      ).length;
      return { rows: [{ n }] };
    }
    if (text.includes('count(*)')) {
      const n = this.players.filter(
        (p) => p.owner_id === values[0] && p.status !== 'retired',
      ).length;
      return { rows: [{ n }] };
    }
    if (text.startsWith('INSERT INTO agents')) {
      this.agents.push(String(values[0]));
      this.declared.set(String(values[0]), String(values[6]));
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO mcp_players')) {
      this.players.push({
        player_id: String(values[0]),
        owner_id: String(values[1]),
        life_id: String(values[2]),
        display_name: String(values[3]),
        status: 'active',
      });
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO mcp_budget')) {
      this.budgets.push(String(values[0]));
      return { rows: [] };
    }
    if (text.startsWith('UPDATE mcp_players')) {
      const player = this.players.find((p) => p.player_id === values[0]);
      const allowed = values[2] as string[];
      if (player === undefined || !allowed.includes(player.status)) return { rows: [] };
      player.status = String(values[1]);
      return { rows: [{ player_id: player.player_id, life_id: player.life_id }] };
    }
    if (text.startsWith('UPDATE agents')) {
      // The retired refusal lives in the SQL text: without that clause the fake matches a retired
      // player too, so removing the clause from players.ts fails the retired test.
      const refusesRetired = text.includes("status <> 'retired'");
      const player = this.players.find(
        (p) => p.player_id === values[0] && (!refusesRetired || p.status !== 'retired'),
      );
      if (player === undefined) return { rows: [] };
      this.declared.set(player.life_id, String(values[1]));
      return { rows: [{ agent_id: player.life_id }] };
    }
    if (text.startsWith('UPDATE mcp_tokens')) {
      this.revokedFor.push(String(values[0]));
      return { rows: [] };
    }
    throw new Error(`the fake has no answer for: ${text}`);
  }
}

export const SHARD_YAML = `shard: phase0
identity_mode: watched
sovereign:
  allowed: true
  harnesses:
    claude: { enabled: true }
    codex: { enabled: false }
  budget:
    credits_per_real_hour: 30
    cap_credits: 240
`;

/** The same shard in character mode sheet. */
export const SHEET_SHARD_YAML = SHARD_YAML.replace(
  'shard: phase0\n',
  'shard: phase0\ncharacter:\n  mode: sheet\n',
);

export const SHARD = parseSovereignShard(SHARD_YAML);

export const SHEET_SHARD = parseSovereignShard(SHEET_SHARD_YAML);

/** A sovereign player for owner jo: player n is ag-jo-NN, ag_jo_NN, named `Player n`, on claude. */
export function player(n: number, owner = 'jo'): NewPlayer {
  return {
    playerId: `ag-jo-${String(n).padStart(2, '0')}`,
    owner,
    life: `ag_jo_${String(n).padStart(2, '0')}`,
    name: `Player ${n}`,
    harness: 'claude',
  };
}
