#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSecretFiles, SECRET_DIR } from './secret-files.ts';

export const USAGE = `usage: node tools/mcp-tokens/src/cli.ts <command> [...]

  init [--force --i-understand]         create the pepper and the Postgres password files
  owner add <id> [--cap N]              add an owner (default cap 3, at most 50)
  owner set-cap <id> <N>                change an owner's cap (at most 50)
  player add <id> --owner <o> --life <ag_name_NN> --name <n> --harness <h> [--seed-file <f>]
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

/** Where the secret files live; tests point this at a temporary directory. */
export interface Env {
  secretDir: string;
}

/** Runs one command; returns the process exit code. Errors become a line on stderr, never a stack. */
export async function run(
  argv: readonly string[],
  io: Io,
  env: Env = { secretDir: SECRET_DIR },
): Promise<number> {
  const parsed = parseArgs(argv);
  const [command, ...rest] = parsed.positional;
  try {
    if (command === 'init' && rest.length === 0) {
      await runInit(parsed, io, env.secretDir);
      return 0;
    }
    io.err(USAGE);
    return 2;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
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
