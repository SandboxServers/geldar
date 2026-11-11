import { readFile, stat } from 'node:fs/promises';
import { parse } from 'yaml';
import { checkCap, checkOwnerId, type Sql } from './owners.ts';
import { markText, personaMarks } from './persona-lint.ts';

/** A player's identity, in bytes of UTF-8 (spec 5.15.5; multi-line markdown is allowed). */
export const IDENTITY_MAX_BYTES = 8192;

/** A player's goals, in bytes of UTF-8. */
export const GOALS_MAX_BYTES = 4096;

const PLAYER_ID = /^ag-[a-z0-9]+(-[a-z0-9]+)*$/;
const LIFE_ID = /^ag_[a-z0-9]+(_[a-z0-9]+)*$/;
const HARNESS = /^[a-z][a-z0-9-]{0,31}$/;

/** The part of shards/phase0.yaml that sovereign players read. */
export interface SovereignShard {
  shard: string;
  allowed: boolean;
  harnesses: Record<string, { enabled: boolean }>;
  /** The most credits a life can hold; a new life starts with a full balance. */
  capCredits: number;
  /** The cap `owner add` gives an owner when no --cap is named (sovereign.owner_cap_default); absent when the key is. */
  ownerCapDefault: number | undefined;
  /** The most a `--cap` flag may grant (sovereign.owner_cap_owner, decision 0052); absent when the key is. */
  ownerCapOwner: number | undefined;
}

/** A player's persona: the identity (required, markdown) and the goals (optional, markdown). */
export interface Seed {
  identity: string;
  goals: string;
}

export interface NewPlayer {
  playerId: string;
  owner: string;
  life: string;
  name: string;
  harness: string;
  seed?: Seed;
  /** Keeps a persona the lint refuses (`--allow-meta`). */
  allowMeta?: boolean;
}

export type PlayerAction = 'pause' | 'resume' | 'retire';

/** The statuses each action may start from; anything else is refused. */
const FROM_STATUS: Record<PlayerAction, { from: string[]; to: string }> = {
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  retire: { from: ['active', 'paused'], to: 'retired' },
};

/** Reads the sovereign block of a shard config. Refuses a shard that does not allow sovereign players. */
export function parseSovereignShard(text: string): SovereignShard {
  const doc = parse(text) as Record<string, unknown> | null;
  const sovereign = doc?.sovereign as Record<string, unknown> | undefined;
  if (typeof doc?.shard !== 'string' || sovereign === undefined) {
    throw new Error('the shard config has no sovereign block');
  }
  if (doc.identity_mode !== 'watched')
    throw new Error('sovereign players need identity_mode: watched');
  const budget = sovereign.budget as Record<string, unknown> | undefined;
  if (typeof budget?.cap_credits !== 'number')
    throw new Error('sovereign.budget.cap_credits is missing');
  return {
    shard: doc.shard,
    allowed: sovereign.allowed === true,
    harnesses: (sovereign.harnesses ?? {}) as Record<string, { enabled: boolean }>,
    capCredits: budget.cap_credits,
    ownerCapDefault: readOptionalCap(sovereign.owner_cap_default, 'sovereign.owner_cap_default'),
    ownerCapOwner: readOptionalCap(sovereign.owner_cap_owner, 'sovereign.owner_cap_owner'),
  };
}

/** An absent cap key stays undefined (the caller refuses); a present one must be a valid cap. */
function readOptionalCap(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number') throw new Error(`${key} must be a number`);
  checkCap(value);
  return value;
}

export async function loadSovereignShard(path: string): Promise<SovereignShard> {
  return parseSovereignShard(await readFile(path, 'utf8'));
}

/**
 * Reads the identity file (required) and the goals file (optional) as UTF-8 markdown, within the
 * byte limits. The size is checked before the file is read in full. Errors never echo contents.
 */
export async function readSeedFiles(
  identityPath: string,
  goalsPath?: string,
  allowMeta = false,
): Promise<Seed> {
  const identity = await readLimited(identityPath, IDENTITY_MAX_BYTES, 'identity');
  const goals =
    goalsPath === undefined ? '' : await readLimited(goalsPath, GOALS_MAX_BYTES, 'goals');
  const seed = { identity, goals };
  checkSeed(seed, allowMeta);
  return seed;
}

async function readLimited(path: string, maxBytes: number, what: string): Promise<string> {
  const info = await stat(path);
  if (info.size > maxBytes) throw new Error(`the ${what} file is over ${maxBytes} bytes`);
  return readFile(path, 'utf8');
}

/**
 * Refuses a persona that is empty or over its size, or that tells the character it is watched by
 * humans, that it is software, or names the harness, shard, colo or credits. `allowMeta` (the
 * `--allow-meta` flag) lets the persona through; the caller prints the warning.
 */
export function checkSeed(seed: Seed, allowMeta = false): void {
  if (seed.identity.trim() === '') throw new Error('the identity is empty');
  if (Buffer.byteLength(seed.identity, 'utf8') > IDENTITY_MAX_BYTES) {
    throw new Error(`the identity is over ${IDENTITY_MAX_BYTES} bytes`);
  }
  if (Buffer.byteLength(seed.goals, 'utf8') > GOALS_MAX_BYTES) {
    throw new Error(`the goals are over ${GOALS_MAX_BYTES} bytes`);
  }
  const marks = personaMarks(`${seed.identity}\n${seed.goals}`);
  if (marks.length > 0 && !allowMeta) {
    throw new Error(`the persona ${markText(marks)}; remove that, or pass --allow-meta to keep it`);
  }
}

/**
 * The agents.personality_seed text: the identity, then the goals under their own heading. The
 * identity is free markdown, so the animus single-line check (checkIdentity) does not apply.
 */
export function seedText(seed: Seed): string {
  return seed.goals.trim() === '' ? seed.identity : `${seed.identity}\n\n## Goals\n\n${seed.goals}`;
}

/**
 * Adds a sovereign player: the agents row (mode sovereign), the mcp_players row and the first
 * budget, in one transaction. The owner row is locked so two adds cannot both pass the cap.
 */
export async function addPlayer(sql: Sql, player: NewPlayer, shard: SovereignShard): Promise<void> {
  if (!PLAYER_ID.test(player.playerId)) throw new Error('player id must look like ag-name-01');
  if (!LIFE_ID.test(player.life)) throw new Error('life id must look like ag_name_01');
  checkOwnerId(player.owner);
  if (!HARNESS.test(player.harness)) throw new Error('harness must be a lower-case name');
  if (player.name.trim() === '') throw new Error('a player needs a --name');
  if (!shard.allowed) throw new Error(`shard ${shard.shard} does not allow sovereign players`);
  if (shard.harnesses[player.harness]?.enabled !== true) {
    throw new Error(`harness ${player.harness} is not enabled on shard ${shard.shard}`);
  }
  if (player.seed !== undefined) checkSeed(player.seed, player.allowMeta === true);
  await transaction(sql, async () => {
    const owners = await sql.query(
      'SELECT player_cap FROM mcp_owners WHERE owner_id = $1 FOR UPDATE',
      [player.owner],
    );
    const owner = owners.rows[0];
    if (owner === undefined) throw new Error(`no owner ${player.owner}`);
    const used = await sql.query(
      "SELECT count(*)::int AS n FROM mcp_players WHERE owner_id = $1 AND status <> 'retired'",
      [player.owner],
    );
    if (Number(used.rows[0]?.n) >= Number(owner.player_cap)) {
      throw new Error(`owner ${player.owner} is at the cap of ${owner.player_cap} players`);
    }
    await sql.query(
      `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
         declared_model, model_config, tier, personality_seed)
       VALUES ($1, $2, 1, $1, $3, 'sovereign', $4, $5, 'self-reported', 'declared:unverified', 'sovereign', $6)`,
      [
        player.life,
        player.name,
        shard.shard,
        player.owner,
        player.harness,
        player.seed ? seedText(player.seed) : null,
      ],
    );
    await sql.query(
      `INSERT INTO mcp_players (player_id, owner_id, life_id, display_name, harness, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [player.playerId, player.owner, player.life, player.name, player.harness],
    );
    await sql.query(
      'INSERT INTO mcp_budget (life_id, credits, accrued_at) VALUES ($1, $2, now())',
      [player.life, shard.capCredits],
    );
  });
}

/** Pauses, resumes or retires a player. Retiring also revokes every token the player holds. */
export async function setPlayerStatus(
  sql: Sql,
  playerId: string,
  action: PlayerAction,
): Promise<string> {
  if (!PLAYER_ID.test(playerId)) throw new Error('player id must look like ag-name-01');
  const rule = FROM_STATUS[action];
  let life = '';
  await transaction(sql, async () => {
    const result = await sql.query(
      'UPDATE mcp_players SET status = $2 WHERE player_id = $1 AND status = ANY($3) RETURNING player_id, life_id',
      [playerId, rule.to, rule.from],
    );
    if (result.rows.length === 0)
      throw new Error(`cannot ${action} ${playerId} from its current status`);
    life = String((result.rows[0] as { life_id: unknown }).life_id);
    if (action === 'retire') {
      await sql.query(
        'UPDATE mcp_tokens SET revoked_at = now() WHERE player_id = $1 AND revoked_at IS NULL',
        [playerId],
      );
    }
  });
  return life;
}

/** Runs `work` between BEGIN and COMMIT, and rolls back if it throws. */
export async function transaction(sql: Sql, work: () => Promise<void>): Promise<void> {
  await sql.query('BEGIN');
  try {
    await work();
  } catch (error) {
    await sql.query('ROLLBACK');
    throw error;
  }
  await sql.query('COMMIT');
}
