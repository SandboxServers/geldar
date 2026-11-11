#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { removeLifeFromShard } from '../../../golem/src/players/life-removal.ts';
import { identityHash } from '../../../threshold/register/src/identity.ts';
import { banIdentity, grantKinoAdmin, revokeKinoAdmin, unbanIdentity } from './identities.ts';
import { addOwner, capForOwnerAdd, parseCap, type Sql, setOwnerCap } from './owners.ts';
import { exportPersona } from './persona-export.ts';
import { markText, personaMarks } from './persona-lint.ts';
import { addPlayer, loadSovereignShard, readSeedFiles, setPlayerStatus } from './players.ts';
import { initSecretFiles, PASSWORD_FILE, REPO_ROOT, SECRET_DIR } from './secret-files.ts';
import {
  checkOutPath,
  DEFAULT_GRACE_MINUTES,
  listTokens,
  mintTokenFile,
  parseGrace,
  revokePlayerTokens,
  revokeToken,
  rotateTokenFile,
} from './tokens.ts';

/** The shard config that says whether sovereign players are allowed, and with which harnesses, by default. */
export const SHARD_FILE = join(REPO_ROOT, 'shards', 'phase0.yaml');

/** The variable that names another shard file (the admin image sets it to the colo shard). */
export const SHARD_FILE_VARIABLE = 'GELDAR_SHARD_FILE';

/**
 * The shard file the tool reads: GELDAR_SHARD_FILE when it is set and not empty, else SHARD_FILE. A named path that
 * does not exist is refused, naming the variable, so a typo never falls back to phase0.
 */
export function shardFileFrom(environ: NodeJS.ProcessEnv = process.env): string {
  const named = environ[SHARD_FILE_VARIABLE];
  if (named === undefined || named === '') return SHARD_FILE;
  if (!existsSync(named)) {
    throw new Error(`${SHARD_FILE_VARIABLE} names ${named}, which does not exist`);
  }
  return resolve(named);
}

export const USAGE = `usage: node tools/mcp-tokens/src/cli.ts <command> [...]

  init [--force --i-understand]         create the pepper and the Postgres password files
  owner add <id> [--cap N]              add an owner (cap from owner_cap_default; --cap at most owner_cap_owner)
  owner set-cap <id> <N>                change an owner's cap (at most 50)
  identity ban <id>                     ban a registered identity (64 hex digits) and revoke its owner's tokens
  identity ban --provider microsoft|github|discord --user-id <id> [--pepper-file <f>]
                                        the same, the id derived from the provider account (decision 0136)
  admin grant|revoke <id>               make a registered identity a Kino administrator, or remove it (64 hex digits)
  admin grant|revoke --provider microsoft --user-id <id> [--pepper-file <f>]
                                        the same, the id derived from the Microsoft subject
  identity unban <id>                   lift the ban (revoked tokens stay revoked)
  player add <id> --owner <o> --life <ag_name_NN> --name <n> --harness <h>
                                        [--identity-file <f> [--goals-file <f>]] [--allow-meta]
  player pause|resume|retire <id>
  persona export <character> --out <dir> [--dry-run] [--allow-meta]
                                        write memory/identity.md and goals.md (--out must not exist)
  token mint <player> --out <file>      write a new token to a file only you can read
  token list [--player <id>]            list tokens (never their hashes or values)
  token revoke <tk_id> | --player <id> --all
  token rotate <player> --out <file> [--grace-minutes N]

Output never contains a token. Set PG* variables for the database commands.`;

/** Where the command writes its lines; tests pass their own. */
export interface Io {
  out(line: string): void;
  err(line: string): void;
}

/** Flags that take no value. Every other --flag takes the next argument. */
const SWITCHES = new Set(['--force', '--i-understand', '--all', '--allow-meta', '--dry-run']);

export interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

/** Splits argv into positional words and --flags. Unknown flags are the caller's to refuse. */
export function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) {
      positional.push(arg);
    } else if (SWITCHES.has(arg)) {
      flags.set(arg, true);
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      flags.set(arg, value);
      i += 1;
    }
  }
  return { positional, flags };
}

export async function runInit(parsed: Parsed, io: Io, dir: string = SECRET_DIR): Promise<void> {
  const force = parsed.flags.has('--force');
  if (force && !parsed.flags.has('--i-understand')) {
    throw new Error(
      'init --force re-creates the pepper and invalidates every token; add --i-understand',
    );
  }
  if (parsed.flags.has('--i-understand') && !force) throw new Error('--i-understand needs --force');
  for (const report of await initSecretFiles(dir, { force })) {
    io.out(`${report.action} ${resolve(dir, report.file)}`);
    if (report.file === PASSWORD_FILE && report.action === 'replaced') {
      io.err(PASSWORD_REWRITE_WARNING);
    }
  }
}

/** Printed when the Postgres password file is rewritten: the database role keeps its old password. */
export const PASSWORD_REWRITE_WARNING = [
  'WARNING: postgres-mcp.txt was rewritten, but the geldar_mcp database role password did NOT change.',
  'The MCP cannot log in until the role is set to the new password. Run:',
  '  db migrate --set-role-password geldar_mcp --password-file compose/secrets/postgres-mcp.txt',
].join('\n');

/** A database session: the query surface plus end(). */
export interface SqlSession extends Sql {
  end(): Promise<void>;
}

/** Where the files and the database are; tests point these at temporary places and a fake. */
export interface Env {
  secretDir: string;
  shardFile: string;
  connect: () => Promise<SqlSession>;
  /** Deletes a retired life's registry key and whitelist entry; defaults to the golem removal. */
  removeLife?: (lifeId: string) => Promise<string[]>;
  /** The register pepper file when `--pepper-file` is not given (REGISTER_PEPPER_FILE). */
  registerPepperFile?: string | undefined;
}

export async function connectPg(): Promise<SqlSession> {
  const client = new Client();
  await client.connect();
  return {
    query: async (text, values) => client.query(text, values),
    end: () => client.end(),
  };
}

export const DEFAULT_ENV: Env = {
  secretDir: SECRET_DIR,
  // Read on each use, so GELDAR_SHARD_FILE is the one in force when the command runs.
  get shardFile() {
    return shardFileFrom();
  },
  get registerPepperFile() {
    return process.env.REGISTER_PEPPER_FILE;
  },
  connect: connectPg,
};

/** The value of a flag that must be present and take a value. */
function requireFlag(parsed: Parsed, name: string): string {
  const value = parsed.flags.get(name);
  if (typeof value !== 'string') throw new Error(`${name} is required`);
  return value;
}

function optionalFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags.get(name);
  if (value === true) throw new Error(`${name} needs a value`);
  return value;
}

async function withSql(env: Env, work: (sql: Sql) => Promise<void>): Promise<void> {
  const sql = await env.connect();
  try {
    await work(sql);
  } finally {
    await sql.end();
  }
}

async function runOwner(parsed: Parsed, io: Io, env: Env, args: string[]): Promise<void> {
  const [verb, id, value] = args;
  if (verb === 'add' && id !== undefined && args.length === 2) {
    const cap = optionalFlag(parsed, '--cap');
    const ownerCap = capForOwnerAdd(cap, await loadSovereignShard(env.shardFile));
    await withSql(env, (sql) => addOwner(sql, id, ownerCap));
    io.out(`added owner ${id}`);
    return;
  }
  if (verb === 'set-cap' && id !== undefined && value !== undefined && args.length === 3) {
    await withSql(env, (sql) => setOwnerCap(sql, id, parseCap(value)));
    io.out(`owner ${id} cap set to ${value}`);
    return;
  }
  throw new Error(USAGE);
}

/**
 * The identity id an operator names: the 64-hex id itself, or `--provider` and `--user-id`, from
 * which it is derived with the register service's own HMAC (identityHash) and its pepper, read
 * from `--pepper-file` or REGISTER_PEPPER_FILE the way the service reads REGISTER_PEPPER_FILE.
 */
async function identityIdFrom(args: string[], parsed: Parsed, env: Env): Promise<string> {
  if (args.length === 2) return args[1] as string;
  const provider = optionalFlag(parsed, '--provider');
  const userId = optionalFlag(parsed, '--user-id');
  if (args.length !== 1 || provider === undefined || userId === undefined) throw new Error(USAGE);
  if (provider !== 'microsoft' && provider !== 'github' && provider !== 'discord')
    throw new Error('--provider is microsoft, github or discord');
  const file = optionalFlag(parsed, '--pepper-file') ?? env.registerPepperFile;
  if (file === undefined) throw new Error('--pepper-file (or REGISTER_PEPPER_FILE) is required');
  const pepper = (await readFile(file, 'utf8')).trim();
  if (pepper.length < 32) throw new Error('the register pepper is missing or too short');
  return identityHash(pepper, provider, userId);
}

async function runIdentity(io: Io, env: Env, args: string[], parsed: Parsed): Promise<void> {
  const verb = args[0];
  if (verb === 'ban' || verb === 'unban') {
    const id = await identityIdFrom(args, parsed, env);
    await withSql(env, async (sql) => {
      if (verb === 'ban') {
        const revoked = await banIdentity(sql, id);
        io.out(`banned identity ${id}; revoked ${revoked} live token(s)`);
      } else {
        await unbanIdentity(sql, id);
        io.out(`unbanned identity ${id}`);
      }
    });
    return;
  }
  throw new Error(USAGE);
}

async function runAdmin(io: Io, env: Env, args: string[], parsed: Parsed): Promise<void> {
  const verb = args[0];
  if (verb !== 'grant' && verb !== 'revoke') throw new Error(USAGE);
  const id = await identityIdFrom(args, parsed, env);
  await withSql(env, async (sql) => {
    if (verb === 'grant') {
      await grantKinoAdmin(sql, id);
      io.out(`granted Kino admin to identity ${id}`);
    } else {
      io.out(
        (await revokeKinoAdmin(sql, id))
          ? `revoked Kino admin from identity ${id}`
          : `identity ${id} was not a Kino admin`,
      );
    }
  });
}

async function runPlayer(parsed: Parsed, io: Io, env: Env, args: string[]): Promise<void> {
  const [verb, id] = args;
  if (verb === 'add' && id !== undefined && args.length === 2) {
    const shard = await loadSovereignShard(env.shardFile);
    const identityPath = optionalFlag(parsed, '--identity-file');
    const goalsPath = optionalFlag(parsed, '--goals-file');
    if (goalsPath !== undefined && identityPath === undefined)
      throw new Error('--goals-file needs --identity-file');
    const allowMeta = parsed.flags.has('--allow-meta');
    const player = {
      playerId: id,
      owner: requireFlag(parsed, '--owner'),
      life: requireFlag(parsed, '--life'),
      name: requireFlag(parsed, '--name'),
      harness: requireFlag(parsed, '--harness'),
      allowMeta,
      ...(identityPath === undefined
        ? {}
        : {
            seed: await readSeedFiles(
              resolve(identityPath),
              goalsPath === undefined ? undefined : resolve(goalsPath),
              allowMeta,
            ),
          }),
    };
    const marks =
      player.seed === undefined
        ? []
        : personaMarks(`${player.seed.identity}\n${player.seed.goals}`);
    if (allowMeta && marks.length > 0) io.err(`warning: kept a persona that ${markText(marks)}`);
    await withSql(env, (sql) => addPlayer(sql, player, shard));
    io.out(`added player ${id} (life ${player.life}, owner ${player.owner})`);
    return;
  }
  const action = verb === 'pause' || verb === 'resume' || verb === 'retire' ? verb : undefined;
  if (action !== undefined && id !== undefined && args.length === 2) {
    let life = '';
    await withSql(env, async (sql) => {
      life = await setPlayerStatus(sql, id, action);
    });
    io.out(`player ${id}: ${action}`);
    if (action === 'retire') {
      // Never fails the retire: the removal reports each step, and a failure names the manual command.
      const removeLife = env.removeLife ?? ((lifeId: string) => removeLifeFromShard(lifeId));
      for (const line of await removeLife(life).catch((error: unknown) => [
        `life ${life}: removal failed (${error instanceof Error ? error.message : String(error)})`,
      ]))
        io.out(line);
    }
    return;
  }
  throw new Error(USAGE);
}

async function runToken(parsed: Parsed, io: Io, env: Env, args: string[]): Promise<void> {
  const [verb, target] = args;
  if (verb === 'mint' && target !== undefined && args.length === 2) {
    const out = requireFlag(parsed, '--out');
    checkOutPath(out);
    await withSql(env, async (sql) => {
      const tokenId = await mintTokenFile(sql, env.secretDir, target, out);
      io.out(`minted ${tokenId} for ${target} to ${resolve(out)}`);
    });
    return;
  }
  if (verb === 'list' && args.length === 1) {
    const player = optionalFlag(parsed, '--player');
    await withSql(env, async (sql) => {
      for (const line of await listTokens(sql, player)) io.out(line);
    });
    return;
  }
  if (verb === 'revoke' && target !== undefined && args.length === 2) {
    await withSql(env, async (sql) => {
      await revokeToken(sql, target);
      io.out(`revoked ${target}`);
    });
    return;
  }
  if (verb === 'revoke' && args.length === 1 && parsed.flags.has('--all')) {
    const player = requireFlag(parsed, '--player');
    await withSql(env, async (sql) => {
      const count = await revokePlayerTokens(sql, player);
      io.out(`revoked ${count} token(s) of ${player}`);
    });
    return;
  }
  if (verb === 'rotate' && target !== undefined && args.length === 2) {
    const out = requireFlag(parsed, '--out');
    const grace = optionalFlag(parsed, '--grace-minutes');
    const minutes = grace === undefined ? DEFAULT_GRACE_MINUTES : parseGrace(grace);
    checkOutPath(out);
    await withSql(env, async (sql) => {
      const tokenId = await rotateTokenFile(sql, env.secretDir, target, out, minutes);
      io.out(
        `rotated ${target}: new ${tokenId} written to ${resolve(out)}; old tokens expire within ${minutes} min`,
      );
    });
    return;
  }
  throw new Error(USAGE);
}

/** `persona export <character> --out <dir>`: the approved draft's persona, written outside every repo. */
async function runPersona(parsed: Parsed, io: Io, args: string[]): Promise<void> {
  const [action, character, ...extra] = args;
  if (action !== 'export' || character === undefined || extra.length > 0) throw new Error(USAGE);
  await exportPersona(
    {
      name: character,
      out: requireFlag(parsed, '--out'),
      dryRun: parsed.flags.has('--dry-run'),
      allowMeta: parsed.flags.has('--allow-meta'),
    },
    io,
  );
}

/** Runs one command; returns the process exit code. Errors become a line on stderr, never a stack. */
export async function run(
  argv: readonly string[],
  io: Io,
  env: Env = DEFAULT_ENV,
): Promise<number> {
  const parsed = parseArgs(argv);
  const [command, ...rest] = parsed.positional;
  try {
    if (command === 'init' && rest.length === 0) {
      await runInit(parsed, io, env.secretDir);
    } else if (command === 'owner') {
      await runOwner(parsed, io, env, rest);
    } else if (command === 'identity') {
      await runIdentity(io, env, rest, parsed);
    } else if (command === 'admin') {
      await runAdmin(io, env, rest, parsed);
    } else if (command === 'player') {
      await runPlayer(parsed, io, env, rest);
    } else if (command === 'token') {
      await runToken(parsed, io, env, rest);
    } else if (command === 'persona') {
      await runPersona(parsed, io, rest);
    } else {
      io.err(USAGE);
      return 2;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(message);
    return 1;
  }
}

// Only the command line runs the tool; tests import the functions above.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const io: Io = { out: (line) => console.log(line), err: (line) => console.error(line) };
  try {
    // A refused GELDAR_SHARD_FILE stops every command here, not only the ones that read the shard.
    shardFileFrom();
    run(process.argv.slice(2), io).then((code) => {
      process.exitCode = code;
    });
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
