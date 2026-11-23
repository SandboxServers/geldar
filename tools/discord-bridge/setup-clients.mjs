// Registers the Discord bridge with the MCP clients through their own CLIs (`claude mcp`,
// `codex mcp`). Only the entry named SERVER_NAME is touched; every other MCP setting stays as is.
// No secret goes into a command line or a client config: the server reads its token from the
// environment or from the repo's .env.discord at launch.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

export const SERVER_NAME = 'geldar-discord';

/**
 * Finds `name` on PATH the way a shell would, honouring PATHEXT on Windows.
 * Returns the absolute path, or null when the program is not installed.
 */
export function findExecutable(name, env = process.env, platform = process.platform) {
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter);
  const exts =
    platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const path = resolve(dir, name + ext.toLowerCase());
      try {
        if (!statSync(path).isFile()) continue;
        if (platform !== 'win32') accessSync(path, constants.X_OK);
        return path;
      } catch {
        // Missing or not executable: keep looking.
      }
    }
  }
  return null;
}

/** Quotes one argument for cmd.exe, which runs the npm `.cmd` shims on Windows. */
function cmdQuote(arg) {
  if (/["%!\r\n]/.test(arg)) {
    throw new Error(
      'The Windows client launcher cannot use paths containing ", %, !, or line breaks.',
    );
  }
  return /[\s&()^|<>,;=]/.test(arg) ? `"${arg}"` : arg;
}

/** Runs a client CLI and captures its output. Never inherits stdin, so it cannot prompt. */
export function runCli(executable, args, env = process.env) {
  const { DISCORD_BOT_TOKEN: _token, ...clientEnv } = env;
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  const result = viaShell
    ? spawnSync([executable, ...args].map(cmdQuote).join(' '), {
        env: clientEnv,
        encoding: 'utf8',
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      })
    : spawnSync(executable, args, {
        env: clientEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message,
  };
}

function failure(label, result) {
  const detail = (result.error ?? result.stderr.trim()) || result.stdout.trim();
  return `${label} failed (exit ${result.status})${detail ? `: ${detail}` : ''}`;
}

/**
 * Claude Code, user scope, so the bridge is available in every checkout and worktree.
 * `claude mcp add` refuses an existing name and `claude mcp get` would start the server for a
 * health check, so the entry is removed from user scope and added again.
 */
export function registerClaude(executable, launch, { run = runCli, dryRun = false } = {}) {
  const remove = ['mcp', 'remove', '--scope', 'user', SERVER_NAME];
  const add = ['mcp', 'add', '--scope', 'user', SERVER_NAME, '--', launch.command, ...launch.args];
  if (dryRun) return { ok: true, action: 'would register', commands: [remove, add] };
  const removed = run(executable, remove);
  const added = run(executable, add);
  if (added.status !== 0) return { ok: false, message: failure('claude mcp add', added) };
  return { ok: true, action: removed.status === 0 ? 'updated' : 'registered' };
}

/**
 * Codex keeps one global config. An identical entry is left alone, so any timeouts or tool
 * filters the developer added to it survive; a different one is replaced by `codex mcp add`.
 */
export function registerCodex(executable, launch, { run = runCli, dryRun = false } = {}) {
  const add = ['mcp', 'add', SERVER_NAME, '--', launch.command, ...launch.args];
  const current = run(executable, ['mcp', 'get', '--json', SERVER_NAME]);
  if (current.status === 0 && sameLaunch(current.stdout, launch)) {
    return { ok: true, action: 'already registered' };
  }
  if (dryRun) return { ok: true, action: 'would register', commands: [add] };
  const added = run(executable, add);
  if (added.status !== 0) return { ok: false, message: failure('codex mcp add', added) };
  return { ok: true, action: current.status === 0 ? 'updated' : 'registered' };
}

function sameLaunch(json, launch) {
  try {
    const transport = JSON.parse(json).transport ?? {};
    return (
      transport.type === 'stdio' &&
      transport.command === launch.command &&
      JSON.stringify(transport.args ?? []) === JSON.stringify(launch.args)
    );
  } catch {
    return false;
  }
}

export const CLIENTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    register: registerClaude,
    verify: 'Restart Claude Code, run /mcp, and check that geldar-discord is connected.',
    install: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    register: registerCodex,
    verify: 'Restart Codex, run /mcp, and check that geldar-discord lists its three tools.',
    install: 'https://developers.openai.com/codex/cli',
  },
];
