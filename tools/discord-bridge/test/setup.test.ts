// Runs setup.mjs in a throwaway copy of the bridge with stub `claude` and `codex` CLIs on PATH.
// The stubs keep their MCP entries in a JSON file in the sandbox, so no real client config,
// network or Discord token is touched.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const bridgeSource = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'sentinel-token-value-never-printed';

// One stub script plays both CLIs; it learns which from its own file name.
const STUB = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const client = path.basename(process.argv[1]);
const argv = process.argv.slice(2);
const file = process.env.STUB_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
state.log.push([client, ...argv]);
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const servers = state[client];
let code = 0;
const dash = argv.indexOf('--');
if (client === 'claude' && argv[1] === 'remove') {
  const name = argv[4];
  if (servers[name]) delete servers[name];
  else { console.error('No MCP server named "' + name + '" in user scope'); code = 1; }
} else if (client === 'claude' && argv[1] === 'add') {
  const name = argv[4];
  if (servers[name]) { console.error('MCP server ' + name + ' already exists'); code = 1; }
  else servers[name] = { command: argv[dash + 1], args: argv.slice(dash + 2) };
} else if (client === 'codex' && argv[1] === 'get') {
  const entry = servers[argv[3]];
  if (entry) console.log(JSON.stringify({ transport: { type: 'stdio', ...entry } }));
  else { console.error('No MCP server found.'); code = 1; }
} else if (client === 'codex' && argv[1] === 'add') {
  servers[argv[2]] = { command: argv[dash + 1], args: argv.slice(dash + 2) };
} else { console.error('unexpected ' + argv.join(' ')); code = 2; }
save();
process.exit(code);
`;

type Entry = { command: string; args: string[] };
type State = { log: string[][]; claude: Record<string, Entry>; codex: Record<string, Entry> };

let sandbox: string;
let repo: string;
let bridge: string;
let bin: string;
let stateFile: string;

function writeState(state: State): void {
  writeFileSync(stateFile, JSON.stringify(state));
}

function readState(): State {
  return JSON.parse(readFileSync(stateFile, 'utf8')) as State;
}

function installStubs(...clients: string[]): void {
  for (const client of clients) {
    writeFileSync(join(bin, client), STUB);
    chmodSync(join(bin, client), 0o755);
  }
}

function runSetup(...args: string[]) {
  const result = spawnSync(process.execPath, [join(bridge, 'setup.mjs'), ...args], {
    encoding: 'utf8',
    env: { PATH: bin, HOME: sandbox, USERPROFILE: sandbox, STUB_STATE: stateFile },
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

const expectedLaunch = (): Entry => ({
  command: process.execPath,
  args: [`--env-file-if-exists=${join(repo, '.env.discord')}`, join(bridge, 'server.mjs')],
});

const unrelated: Entry = { command: '/opt/other/server', args: ['--keep'] };

describe.skipIf(process.platform === 'win32')('discord bridge setup', () => {
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'geldar-discord-setup-'));
    repo = join(sandbox, 'repo');
    bridge = join(repo, 'tools', 'discord-bridge');
    bin = join(sandbox, 'bin');
    stateFile = join(sandbox, 'state.json');
    mkdirSync(bridge, { recursive: true });
    mkdirSync(bin);
    for (const file of ['setup.mjs', 'setup-clients.mjs']) {
      copyFileSync(join(bridgeSource, file), join(bridge, file));
    }
    writeFileSync(join(bridge, 'server.mjs'), '// stub server, never started by setup\n');
    writeFileSync(
      join(bridge, 'package.json'),
      JSON.stringify({ dependencies: { '@scope/stub-dep': '1.0.0' } }),
    );
    mkdirSync(join(bridge, 'node_modules', '@scope', 'stub-dep'), { recursive: true });
    writeFileSync(join(bridge, 'node_modules', '@scope', 'stub-dep', 'package.json'), '{}');
    writeFileSync(join(repo, '.env.discord'), `DISCORD_BOT_TOKEN=${TOKEN}\n`);
    writeState({ log: [], claude: { other: unrelated }, codex: { other: unrelated } });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('registers both clients with absolute paths and keeps their other servers', () => {
    installStubs('claude', 'codex');
    const { status, out } = runSetup();
    expect(status).toBe(0);
    const state = readState();
    expect(state.claude).toEqual({ other: unrelated, 'geldar-discord': expectedLaunch() });
    expect(state.codex).toEqual({ other: unrelated, 'geldar-discord': expectedLaunch() });
    expect(state.log).toContainEqual(expect.arrayContaining(['claude', '--scope', 'user']));
    expect(out).toContain('Claude Code: registered');
    expect(out).toContain('Codex: registered');
    expect(out).toContain('/mcp');
    expect(out).not.toContain('warning');
  });

  it('never puts the token on a command line, in a config or in its output', () => {
    installStubs('claude', 'codex');
    const { out } = runSetup();
    expect(out).not.toContain(TOKEN);
    expect(readFileSync(stateFile, 'utf8')).not.toContain(TOKEN);
  });

  it('is idempotent: a second run leaves the same entries and does not rewrite Codex', () => {
    installStubs('claude', 'codex');
    runSetup();
    writeState({ ...readState(), log: [] });
    const { status, out } = runSetup();
    expect(status).toBe(0);
    const state = readState();
    expect(state.claude['geldar-discord']).toEqual(expectedLaunch());
    expect(state.codex['geldar-discord']).toEqual(expectedLaunch());
    expect(state.log.filter((call) => call[0] === 'codex' && call[2] === 'add')).toEqual([]);
    expect(out).toContain('Claude Code: updated');
    expect(out).toContain('Codex: already registered');
  });

  it.each([
    [
      'another server path',
      (): Entry => ({ command: process.execPath, args: ['/old/server.mjs'] }),
    ],
    ['another Node binary', (): Entry => ({ command: '/old/node', args: expectedLaunch().args })],
  ])('replaces a stale Codex entry with %s', (_, stale) => {
    installStubs('codex');
    writeState({ log: [], claude: {}, codex: { 'geldar-discord': stale() } });
    const { status, out } = runSetup();
    expect(status).toBe(0);
    expect(readState().codex['geldar-discord']).toEqual(expectedLaunch());
    expect(out).toContain('Codex: updated');
  });

  it('sets up the one client that is installed and says the other was skipped', () => {
    installStubs('codex');
    const { status, out } = runSetup();
    expect(status).toBe(0);
    expect(readState().codex['geldar-discord']).toEqual(expectedLaunch());
    expect(out).toContain('Claude Code: not installed, skipped');
  });

  it('fails with install hints when no client is installed', () => {
    const { status, out } = runSetup();
    expect(status).toBe(1);
    expect(out).toContain('no MCP client found on PATH');
    expect(out).toContain('Claude Code');
    expect(out).toContain('Codex');
  });

  it('refuses before touching any client when server.mjs is missing', () => {
    installStubs('claude', 'codex');
    rmSync(join(bridge, 'server.mjs'));
    const { status, out } = runSetup();
    expect(status).toBe(1);
    expect(out).toContain('server.mjs is missing');
    expect(readState().log).toEqual([]);
  });

  it('refuses when the bridge dependencies are not installed', () => {
    installStubs('claude', 'codex');
    rmSync(join(bridge, 'node_modules'), { recursive: true });
    const { status, out } = runSetup();
    expect(status).toBe(1);
    expect(out).toContain('@scope/stub-dep');
    expect(out).toContain('./geldar.ps1 setup');
    expect(readState().log).toEqual([]);
  });

  it('still registers without a token but tells the developer where to put it', () => {
    installStubs('claude');
    rmSync(join(repo, '.env.discord'));
    const { status, out } = runSetup();
    expect(status).toBe(0);
    expect(readState().claude['geldar-discord']).toEqual(expectedLaunch());
    expect(out).toContain('No bot token found');
    expect(out).toContain('.env.discord');
  });

  it('changes nothing on --dry-run', () => {
    installStubs('claude', 'codex');
    const { status, out } = runSetup('--dry-run');
    expect(status).toBe(0);
    const state = readState();
    expect(state.claude).toEqual({ other: unrelated });
    expect(state.codex).toEqual({ other: unrelated });
    expect(out).toContain('would register');
  });

  it('limits setup to the clients named with --client', () => {
    installStubs('claude', 'codex');
    const { status } = runSetup('--client', 'codex');
    expect(status).toBe(0);
    const state = readState();
    expect(state.claude['geldar-discord']).toBeUndefined();
    expect(state.codex['geldar-discord']).toEqual(expectedLaunch());
  });

  it('reports a failing client CLI and exits non-zero', () => {
    installStubs('claude', 'codex');
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude is broken" >&2\nexit 3\n');
    const { status, out } = runSetup();
    expect(status).toBe(1);
    expect(out).toContain('claude mcp add failed (exit 3): claude is broken');
    expect(readState().codex['geldar-discord']).toEqual(expectedLaunch());
  });
});
