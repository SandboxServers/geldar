// Registers the on-demand Discord MCP bridge with Claude Code and Codex on this machine.
//
//   node tools/discord-bridge/setup.mjs [--client claude|codex] [--node <path>] [--dry-run]
//
// Each client gets a stdio entry named geldar-discord that launches
//   <node> --env-file-if-exists=<repo>/.env.discord <repo>/tools/discord-bridge/server.mjs
// with absolute paths. The token never passes through this script: the server reads
// DISCORD_BOT_TOKEN from .env.discord (or the environment) each time a client starts it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { CLIENTS, findExecutable } from './setup-clients.mjs';

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(bridgeDir, '..', '..');
const MIN_NODE = [22, 9];

function parseArgs(argv) {
  const options = { clients: [], node: undefined, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--client' || arg === '--node') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value.`);
      if (arg === '--node') options.node = resolve(value);
      else if (CLIENTS.some((client) => client.id === value)) options.clients.push(value);
      else throw new Error(`Unknown client "${value}". Use claude or codex.`);
    } else throw new Error(`Unknown option "${arg}". Run with --help.`);
  }
  return options;
}

const usage = `Usage: node tools/discord-bridge/setup.mjs [options]

Registers the geldar-discord MCP server with Claude Code and Codex, whichever are installed.

  --client <claude|codex>  Register only this client (repeatable).
  --node <path>            Node binary the clients launch (default: the one running this).
  --dry-run                Print what would change and change nothing.
  -h, --help               Show this help.`;

/** Node the clients should launch: absolute, and not a per-shell fnm path that vanishes. */
function chooseNode(override, warnings) {
  if (override) {
    if (!existsSync(override)) throw new Error(`--node ${override} does not exist.`);
    return override;
  }
  if (/fnm_multishells/i.test(process.execPath)) {
    warnings.push(
      `Node runs from a per-shell fnm path (${process.execPath}) that is deleted when the shell ` +
        'closes, so the clients will launch "node" from their PATH instead. Pass --node with a ' +
        'stable path to pin one.',
    );
    return 'node';
  }
  return process.execPath;
}

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    throw new Error(
      `Node ${process.versions.node} is too old: the bridge needs --env-file-if-exists ` +
        '(Node 22.9 or newer). Install the version in .nvmrc and rerun.',
    );
  }
}

/** The bridge's own files and installed dependencies. Returns problems; empty means ready. */
function checkBridge() {
  const problems = [];
  const server = join(bridgeDir, 'server.mjs');
  if (!existsSync(server)) {
    problems.push(`${server} is missing. Update your checkout (git pull) and rerun.`);
  }
  const manifest = join(bridgeDir, 'package.json');
  if (existsSync(manifest)) {
    const { dependencies = {} } = JSON.parse(readFileSync(manifest, 'utf8'));
    const missing = Object.keys(dependencies).filter(
      (dep) => !existsSync(join(bridgeDir, 'node_modules', dep, 'package.json')),
    );
    if (missing.length > 0) {
      problems.push(
        `Dependencies are not installed (${missing.join(', ')}). From the repo root run ` +
          '`corepack pnpm --filter @geldar/discord-bridge install --frozen-lockfile`, then rerun.',
      );
    }
  }
  return problems;
}

/** Where the token will come from at launch, without ever reading its value out loud. */
function checkToken(envFile, warnings) {
  let fromFile = false;
  if (existsSync(envFile)) {
    try {
      fromFile = Boolean(parseEnv(readFileSync(envFile, 'utf8')).DISCORD_BOT_TOKEN?.trim());
    } catch {
      warnings.push(`${envFile} could not be read as an env file.`);
    }
    if (!fromFile) warnings.push(`${envFile} has no DISCORD_BOT_TOKEN value. Add your bot token.`);
    return fromFile ? 'file' : 'none';
  }
  if (process.env.DISCORD_BOT_TOKEN?.trim()) {
    warnings.push(
      'DISCORD_BOT_TOKEN is set only in this shell. Codex may omit it from MCP servers and a ' +
        `client started elsewhere will not have it. Put it in ${envFile} instead.`,
    );
    return 'env';
  }
  warnings.push(
    `No bot token found. Create ${envFile} containing DISCORD_BOT_TOKEN=<your bot token> ` +
      '(template: tools/discord-bridge/.env.example). Git ignores that file.',
  );
  return 'none';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return 0;
  }
  checkNodeVersion();

  const warnings = [];
  const problems = checkBridge();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    return 1;
  }

  const envFile = join(repoRoot, '.env.discord');
  const launch = {
    command: chooseNode(options.node, warnings),
    args: [`--env-file-if-exists=${envFile}`, join(bridgeDir, 'server.mjs')],
  };
  const token = checkToken(envFile, warnings);

  const wanted = CLIENTS.filter(
    (client) => options.clients.length === 0 || options.clients.includes(client.id),
  );
  const found = wanted.map((client) => ({ client, executable: findExecutable(client.bin) }));
  const installed = found.filter((entry) => entry.executable);
  if (installed.length === 0) {
    const names = wanted.map((client) => `${client.label} (${client.install})`).join(' or ');
    console.error(`error: no MCP client found on PATH. Install ${names}, then rerun.`);
    return 1;
  }

  console.log(`Launch command: ${[launch.command, ...launch.args].join(' ')}`);
  const results = [];
  for (const { client, executable } of found) {
    if (!executable) {
      console.log(`- ${client.label}: not installed, skipped (${client.install}).`);
      continue;
    }
    const result = client.register(executable, launch, { dryRun: options.dryRun });
    results.push({ client, result });
    if (!result.ok) {
      console.error(`- ${client.label}: ${result.message}`);
      continue;
    }
    console.log(`- ${client.label}: ${result.action} (${executable}).`);
    for (const command of result.commands ?? [])
      console.log(`    ${client.bin} ${command.join(' ')}`);
  }

  for (const warning of warnings) console.warn(`warning: ${warning}`);
  const succeeded = results.filter(({ result }) => result.ok);
  if (succeeded.length > 0 && !options.dryRun) {
    console.log('\nNext:');
    if (token === 'none') console.log(`  Add DISCORD_BOT_TOKEN to ${envFile}.`);
    console.log('  From the repo root, check the connection (no message is posted):');
    console.log('    node --env-file-if-exists=.env.discord tools/discord-bridge/check.mjs');
    for (const { client } of succeeded) console.log(`  ${client.verify}`);
  }
  return succeeded.length === results.length ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
