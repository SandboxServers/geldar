import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import {
  type CharacterSheet,
  canonicalSheetJson,
  normalizeSheet,
  STANDARD_SHEET,
} from '@geldar/psyche';
import { parse } from 'yaml';
import { checkCap, checkOwnerId, type Sql } from './owners.ts';
import { markText, personaMarks } from './persona-lint.ts';
import { checkRosterStart } from './roster.ts';

/** A player's identity, in bytes of UTF-8 (spec 5.15.5; multi-line markdown is allowed). */
export const IDENTITY_MAX_BYTES = 8192;

/** A player's goals, in bytes of UTF-8. */
export const GOALS_MAX_BYTES = 4096;

/** A `--sheet-file`, in bytes of UTF-8; the sheet is a few lines of scores. */
export const SHEET_FILE_MAX_BYTES = 16384;

const PLAYER_ID = /^ag-[a-z0-9]+(-[a-z0-9]+)*$/;
const LIFE_ID = /^ag_[a-z0-9]+(_[a-z0-9]+)*$/;
/** The contract LifeId (contract/schemas/common.schema.json); players.sheet.test.ts checks the two agree. */
export const SHEET_LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;
const HARNESS = /^[a-z][a-z0-9-]{0,31}$/;
/** The contract's event.schema.json `model` pattern: the declared model of a life. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,127}$/;

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
  /** `character.mode`: sheet makes roster creation write the sheet and its adoption; off (the default) writes neither. */
  characterMode: 'off' | 'sheet';
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
  /** The declared model (`--model`); the placeholder `self-reported` when absent. */
  model?: string;
  /** The character sheet (`--sheet-file`), checked by addPlayer; only the sheet-mode shard takes one. */
  characterSheet?: unknown;
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
    characterMode: readCharacterMode(doc),
  };
}

/** `character.mode`: off or sheet. An omitted mode (or a `character:` with no value) is off; any other value throws. */
function readCharacterMode(doc: Record<string, unknown>): 'off' | 'sheet' {
  const block = doc.character;
  if (block === undefined || block === null) return 'off';
  if (typeof block !== 'object' || Array.isArray(block)) {
    throw new Error('character must be a mapping');
  }
  const mode = (block as Record<string, unknown>).mode;
  if (mode === undefined || mode === 'off') return 'off';
  if (mode === 'sheet') return 'sheet';
  throw new Error('character.mode must be off or sheet');
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
 * Reads a `--sheet-file` (YAML or JSON) and returns its value. The caller checks the value with
 * the sheet validator. Errors never echo the file's contents.
 */
export async function readSheetFile(path: string): Promise<unknown> {
  const text = await readLimited(path, SHEET_FILE_MAX_BYTES, 'sheet');
  try {
    return parse(text);
  } catch {
    throw new Error('the sheet file is not valid YAML or JSON');
  }
}

/** The lower-case hex SHA-256 of the canonical sheet JSON (psyche's canonicalSheetJson; sql 0050). */
export function sheetHash(sheet: CharacterSheet): string {
  return createHash('sha256').update(canonicalSheetJson(sheet), 'utf8').digest('hex');
}

/** The sheet a roster life adopts: the given one, refused field by field if malformed, or the standard one. */
export function adoptedSheet(given: unknown): CharacterSheet {
  if (given === undefined) return STANDARD_SHEET;
  const result = normalizeSheet(given);
  if (!result.ok) throw new Error(`character sheet refused: ${result.errors.join('; ')}`);
  return result.sheet;
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

/** The agents row in off mode: the statement as it was before the sheet columns existed. */
const AGENTS_INSERT = `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
         declared_model, model_config, tier, personality_seed)
       VALUES ($1, $2, 1, $1, $3, 'sovereign', $4, $5, $7, 'declared:unverified', 'sovereign', $6)`;

/** The agents row in sheet mode: the sheet, its hash and the time it was adopted (sql 0050). */
const AGENTS_SHEET_INSERT = `INSERT INTO agents (agent_id, name, life_seq, game_account, shard, mode, owner, harness,
         declared_model, model_config, tier, personality_seed,
         character_sheet, sheet_hash, sheet_adopted_at)
       VALUES ($1, $2, 1, $1, $3, 'sovereign', $4, $5, $7, 'declared:unverified', 'sovereign', $6,
         $8::jsonb, $9::text, CASE WHEN $9::text IS NULL THEN NULL ELSE now() END)`;

/**
 * Refuses a sheet life that the contract's LifeId does not take, before any write, so the
 * sheet_adopted event row this add writes always passes the contract. The pattern is a copy of the
 * schema's, held equal by a drift test (the contract validator threw under vitest here).
 */
export function checkAdoptionLife(life: string): void {
  if (!SHEET_LIFE_ID.test(life)) {
    throw new Error(`life ${life} cannot take a sheet: its id must match ${SHEET_LIFE_ID.source}`);
  }
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
  if (player.model !== undefined) checkModel(player.model);
  if (shard.characterMode === 'off' && player.characterSheet !== undefined) {
    throw new Error('the shard has character mode off');
  }
  // Checked before any write: a malformed sheet is refused, never repaired.
  const adopted = shard.characterMode === 'sheet' ? adoptedSheet(player.characterSheet) : null;
  const hash = adopted === null ? null : sheetHash(adopted);
  if (adopted !== null) checkAdoptionLife(player.life);
  const agentValues = [
    player.life,
    player.name,
    shard.shard,
    player.owner,
    player.harness,
    player.seed ? seedText(player.seed) : null,
    player.model ?? 'self-reported',
  ];
  await transaction(sql, async () => {
    const owners = await sql.query(
      'SELECT player_cap FROM mcp_owners WHERE owner_id = $1 FOR UPDATE',
      [player.owner],
    );
    const owner = owners.rows[0];
    if (owner === undefined) throw new Error(`no owner ${player.owner}`);
    // The name must be on this owner's roster and under its max_agents (sql 0024, decision 0108).
    await checkRosterStart(sql, player.owner, player.name);
    const used = await sql.query(
      "SELECT count(*)::int AS n FROM mcp_players WHERE owner_id = $1 AND status <> 'retired'",
      [player.owner],
    );
    if (Number(used.rows[0]?.n) >= Number(owner.player_cap)) {
      throw new Error(`owner ${player.owner} is at the cap of ${owner.player_cap} players`);
    }
    // Off mode runs the original statement, so it works before sql 0050 is applied.
    if (adopted === null || hash === null) {
      await sql.query(AGENTS_INSERT, agentValues);
    } else {
      await sql.query(AGENTS_SHEET_INSERT, [...agentValues, JSON.stringify(adopted), hash]);
      await recordAdoption(sql, player.life, adopted, hash);
    }
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

/**
 * The one adoption of a roster life, inside addPlayer's transaction: its sheet_adopted event, then
 * the character_sheet_adoptions row that cites it (sql 0051 needs the events row first).
 */
async function recordAdoption(
  sql: Sql,
  life: string,
  sheet: CharacterSheet,
  hash: string,
): Promise<void> {
  const eventId = `roster:sheet_adopted:${life}`;
  await sql.query(
    `INSERT INTO events (source_event_id, at, type, agent_id, payload)
     VALUES ($1, now(), 'sheet_adopted', $2, $3::jsonb)`,
    [eventId, life, JSON.stringify({ life_id: life, sheet, sheet_hash: hash, source: 'roster' })],
  );
  await sql.query(
    `INSERT INTO character_sheet_adoptions (source_event_id, life_id, sheet_hash, sheet, source, result)
     VALUES ($1, $2, $3, $4::jsonb, 'roster', 'adopted')`,
    [eventId, life, hash, JSON.stringify(sheet)],
  );
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

/** Refuses a declared model the contract pattern does not take. */
function checkModel(model: string): void {
  if (!MODEL.test(model)) {
    throw new Error(
      'model must be 1 to 128 letters, digits or . _ : @ / + - (start with a letter or digit)',
    );
  }
}

/**
 * Sets the declared model of a live player's life (agents.declared_model). One row; a retired or
 * unknown player is refused and nothing is written.
 */
export async function setPlayerModel(sql: Sql, playerId: string, model: string): Promise<string> {
  if (!PLAYER_ID.test(playerId)) throw new Error('player id must look like ag-name-01');
  checkModel(model);
  const result = await sql.query(
    `UPDATE agents SET declared_model = $2 FROM mcp_players
     WHERE mcp_players.life_id = agents.agent_id AND mcp_players.player_id = $1
       AND mcp_players.status <> 'retired'
     RETURNING agents.agent_id`,
    [playerId, model],
  );
  if (result.rows.length !== 1) throw new Error(`no live player ${playerId} to set the model of`);
  return String((result.rows[0] as { agent_id: unknown }).agent_id);
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
