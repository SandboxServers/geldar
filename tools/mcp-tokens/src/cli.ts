#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { addOwner, DEFAULT_OWNER_CAP, parseCap, type Sql, setOwnerCap } from './owners.ts';
import { addPlayer, loadSovereignShard, readSeedFiles, setPlayerStatus } from './players.ts';
import { initSecretFiles, REPO_ROOT, SECRET_DIR } from './secret-files.ts';
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

/** The shard config that says whether sovereign players are allowed, and with which harnesses. */
export const SHARD_FILE = join(REPO_ROOT, 'shards', 'phase0.yaml');

export const USAGE = `usage: node tools/mcp-tokens/src/cli.ts <command> [...]

  init [--force --i-understand]         create the pepper and the Postgres password files
  owner add <id> [--cap N]              add an owner (default cap 3, at most 50)
  owner set-cap <id> <N>                change an owner's cap (at most 50)
  player add <id> --owner <o> --life <ag_name_NN> --name <n> --harness <h>
                                        [--identity-file <f> [--goals-file <f>]]
  player pause|resume|retire <id>
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
const SWITCHES = new Set(['--force', '--i-understand', '--all']);

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
  }
}

/** A database session: the query surface plus end(). */
export interface SqlSession extends Sql {
  end(): Promise<void>;
}

/** Where the files and the database are; tests point these at temporary places and a fake. */
export interface Env {
  secretDir: string;
  shardFile: string;
  connect: () => Promise<SqlSession>;
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
  shardFile: SHARD_FILE,
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
    await withSql(env, (sql) =>
      addOwner(sql, id, cap === undefined ? DEFAULT_OWNER_CAP : parseCap(cap)),
    );
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

async function runPlayer(parsed: Parsed, io: Io, env: Env, args: string[]): Promise<void> {
  const [verb, id] = args;
  if (verb === 'add' && id !== undefined && args.length === 2) {
    const shard = await loadSovereignShard(env.shardFile);
    const identityPath = optionalFlag(parsed, '--identity-file');
    const goalsPath = optionalFlag(parsed, '--goals-file');
    if (goalsPath !== undefined && identityPath === undefined)
      throw new Error('--goals-file needs --identity-file');
    const player = {
      playerId: id,
      owner: requireFlag(parsed, '--owner'),
      life: requireFlag(parsed, '--life'),
      name: requireFlag(parsed, '--name'),
      harness: requireFlag(parsed, '--harness'),
      ...(identityPath === undefined
        ? {}
        : {
            seed: await readSeedFiles(
              resolve(identityPath),
              goalsPath === undefined ? undefined : resolve(goalsPath),
            ),
          }),
    };
    await withSql(env, (sql) => addPlayer(sql, player, shard));
    io.out(`added player ${id} (life ${player.life}, owner ${player.owner})`);
    return;
  }
  const action = verb === 'pause' || verb === 'resume' || verb === 'retire' ? verb : undefined;
  if (action !== undefined && id !== undefined && args.length === 2) {
    await withSql(env, (sql) => setPlayerStatus(sql, id, action));
    io.out(`player ${id}: ${action}`);
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
    } else if (command === 'player') {
      await runPlayer(parsed, io, env, rest);
    } else if (command === 'token') {
      await runToken(parsed, io, env, rest);
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
  run(process.argv.slice(2), io).then((code) => {
    process.exitCode = code;
  });
}
