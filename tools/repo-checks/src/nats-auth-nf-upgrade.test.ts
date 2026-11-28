import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasPwsh, parseEntries, type Rendered, renderGenerator } from './nats-auth-fixtures.ts';

// The upgrade path of the nf NATS set (deploy/nats-auth-nf.ps1). An older node holds the ten-file set: nats-auth.conf and nine
// password files, with no human, mcp or ranger user and none of their files. These tests pin what a re-run does there, in a temp
// checkout (--live --local, never the live checkout). The config is never overwritten, and a re-run refuses when the config exists
// and a password file it needs is missing. The operator procedure is the second test: remove nats-auth.conf only.

const OLD_PASSWORDS = [
  'nats-neoforge.txt',
  'nats-sink.txt',
  'nats-deploy.txt',
  'nats-velocity.txt',
  'nats-seed.txt',
  'nats-body.txt',
  'postgres.txt',
  'velocity-forwarding.txt',
  'rcon.txt',
];
const OLD_USERS = ['neoforge', 'sink', 'deploy', 'velocity', 'seed', 'body'];
/** The files and users the later passes added: the human lane, the MCP door and the rangers. */
const ADDED_USERS = ['human', 'mcp', 'ranger'];
const ADDED_FILES = [
  'nats-human.txt',
  'nats-mcp.txt',
  'nats-ranger.txt',
  'postgres-mcp.txt',
  'mcp-token-pepper.txt',
];

/**
 * Folds pwsh's error view into plain text for a match: strips ANSI colour escapes, then turns each line break with the
 * whitespace and '|' gutter after it into one space, so a message wrapped by the console matches as one line.
 */
function normalisePwshError(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the ANSI colour escape is the input this strips
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r?\n[\s|]*/g, ' ');
}

describe.skipIf(!hasPwsh)('NF NATS set: the upgrade path from the ten-file node', () => {
  let r: Rendered;
  let secrets: string;
  const snapshot = (): Record<string, string> =>
    Object.fromEntries(
      readdirSync(secrets)
        .sort()
        .map((f) => [f, readFileSync(join(secrets, f), 'utf8')]),
    );
  const runGenerator = () =>
    spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        join(r.dir, 'geldar.ps1'),
        'shard',
        'nats-auth',
        'nf',
        '--live',
        '--local',
      ],
      { encoding: 'utf8', cwd: r.dir },
    );

  beforeAll(() => {
    r = renderGenerator('nf', { flags: ['--live', '--local'], checkout: true });
    secrets = join(r.dir, 'compose', 'secrets-nf');
    // Make it the older node: none of the added files, and a config with none of the added entries (the entry lines are
    // one per user, comma-separated, so the last kept entry loses its comma).
    for (const f of ADDED_FILES) rmSync(join(secrets, f));
    const confPath = join(secrets, 'nats-auth.conf');
    const lines = readFileSync(confPath, 'utf8')
      .split('\n')
      .filter((l) => !ADDED_USERS.some((u) => l.startsWith(`      { user: "${u}"`)));
    const entryIdx = lines
      .map((l, i) => (l.startsWith('      { user:') ? i : -1))
      .filter((i) => i >= 0);
    const last = entryIdx[entryIdx.length - 1] ?? -1;
    lines[last] = (lines[last] ?? '').replace(/,$/, '');
    const old = lines.join('\n');
    for (const u of ADDED_USERS) expect(old).not.toContain(`"${u}"`);
    writeFileSync(confPath, old);
  }, 60_000);
  afterAll(() => {
    if (r) rmSync(r.dir, { recursive: true, force: true });
  });

  it('refuses a re-run on the ten-file node: the config exists and the added passwords are missing, so nothing is written', () => {
    const before = snapshot();
    expect(Object.keys(before).sort()).toEqual(['nats-auth.conf', ...OLD_PASSWORDS].sort());
    const again = runGenerator();
    expect(again.status).not.toBe(0);
    // pwsh wraps the error view at the console width (80 columns on CI), so the list may break after a comma with a gutter
    // ("| ") in front of the next name, and CI colours the view with ANSI escapes. pwsh's error text is folded before matching;
    // the names, order and wording are exact.
    const error = normalisePwshError(again.stderr);
    expect(error).toMatch(
      /nats-auth\.conf exists but nats-human\.txt, nats-mcp\.txt, nats-ranger\.txt is missing/,
    );
    expect(error).toMatch(/Nothing was written/);
    for (const f of ADDED_FILES) expect(existsSync(join(secrets, f)), f).toBe(false);
    expect(snapshot()).toEqual(before);
  }, 60_000);

  it('the operator procedure (delete nats-auth.conf only): keeps the nine passwords, adds the added files and a config with every user', () => {
    const before = snapshot();
    rmSync(join(secrets, 'nats-auth.conf'));
    const again = runGenerator();
    expect(again.status, again.stderr).toBe(0);
    const after = snapshot();
    expect(Object.keys(after)).toEqual(['nats-auth.conf', ...ADDED_FILES, ...OLD_PASSWORDS].sort());
    for (const f of OLD_PASSWORDS) expect(after[f], f).toBe(before[f]);
    for (const f of ADDED_FILES.filter((x) => x.startsWith('nats-'))) {
      expect(after[f], f).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(OLD_PASSWORDS.map((p) => before[p])).not.toContain(after[f]);
    }
    expect(after['mcp-token-pepper.txt'] ?? '').toMatch(/^[A-Za-z0-9_-]{64}$/);
    const entries = parseEntries(after['nats-auth.conf'] ?? '');
    expect(entries.map((e) => e.user).sort()).toEqual([...OLD_USERS, ...ADDED_USERS].sort());
    for (const u of OLD_USERS) {
      expect(entries.find((e) => e.user === u)?.password, u).toBe(
        (before[`nats-${u}.txt`] ?? '').trim(),
      );
    }
    for (const u of ADDED_USERS) {
      expect(entries.find((e) => e.user === u)?.password, u).toBe(
        (after[`nats-${u}.txt`] ?? '').trim(),
      );
    }
  }, 60_000);
});

// The refusal's match runs without pwsh: CI's wrapped, ANSI-coloured error view goes through the normaliser to the strict regex.
describe('normalisePwshError on the CI error view', () => {
  const pattern =
    /nats-auth\.conf exists but nats-human\.txt, nats-mcp\.txt, nats-ranger\.txt is missing/;
  const ciStderr =
    '\u001b[31;1mException: \u001b[0mcompose/secrets-nf/nats-auth.conf exists but nats-human.txt,\u001b[0m\n' +
    '\u001b[31;1m\u001b[0m\u001b[36;1m     | \u001b[31;1mnats-mcp.txt, nats-ranger.txt is missing, so the config would not match\u001b[0m';

  it('matches the exact names, order and wording after the wrap and the colour are folded', () => {
    expect(normalisePwshError(ciStderr)).toMatch(pattern);
  });

  it('does not match when the names are out of order', () => {
    const reordered = ciStderr
      .replace('nats-human.txt,', 'nats-mcp.txt,')
      .replace('nats-mcp.txt, nats-ranger', 'nats-human.txt, nats-ranger');
    expect(normalisePwshError(reordered)).not.toMatch(pattern);
  });
});
