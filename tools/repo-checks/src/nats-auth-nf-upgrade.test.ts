import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasPwsh, parseEntries, type Rendered, renderGenerator } from './nats-auth-fixtures.ts';

// The upgrade path of the nf NATS set (deploy/nats-auth-nf.ps1). An older node holds the ten-file set: nats-auth.conf and nine
// password files, with no human user and no nats-human.txt. These tests pin what a re-run does there, in a temp checkout
// (--live --local, never the live checkout). The config is never overwritten, and a re-run refuses when the config exists and
// a password file it needs is missing. The operator procedure is the second test: remove nats-auth.conf only.

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
      ['-NoProfile', '-File', join(r.dir, 'geldar.ps1'), 'shard', 'nats-auth', 'nf', '--live', '--local'],
      { encoding: 'utf8', cwd: r.dir },
    );

  beforeAll(() => {
    r = renderGenerator('nf', { flags: ['--live', '--local'], checkout: true });
    secrets = join(r.dir, 'compose', 'secrets-nf');
    // Make it the older node: no nats-human.txt, and a config with no human entry (the human entry is the last one).
    rmSync(join(secrets, 'nats-human.txt'));
    const confPath = join(secrets, 'nats-auth.conf');
    const old = readFileSync(confPath, 'utf8').replace(/,\n {6}\{ user: "human"[^\n]*/, '');
    expect(old).not.toContain('"human"');
    writeFileSync(confPath, old);
  }, 60_000);
  afterAll(() => {
    if (r) rmSync(r.dir, { recursive: true, force: true });
  });

  it('refuses a re-run on the ten-file node: the config exists and nats-human.txt is missing, so nothing is written', () => {
    const before = snapshot();
    expect(Object.keys(before).sort()).toEqual(['nats-auth.conf', ...OLD_PASSWORDS].sort());
    const again = runGenerator();
    expect(again.status).not.toBe(0);
    expect(again.stderr).toMatch(/nats-auth\.conf exists but nats-human\.txt is missing/);
    expect(again.stderr).toMatch(/Nothing was written/);
    expect(existsSync(join(secrets, 'nats-human.txt'))).toBe(false);
    expect(snapshot()).toEqual(before);
  }, 60_000);

  it('the operator procedure (delete nats-auth.conf only): keeps the nine passwords, adds nats-human.txt and a config with the human user', () => {
    const before = snapshot();
    rmSync(join(secrets, 'nats-auth.conf'));
    const again = runGenerator();
    expect(again.status, again.stderr).toBe(0);
    const after = snapshot();
    expect(Object.keys(after)).toEqual(
      ['nats-auth.conf', 'nats-human.txt', ...OLD_PASSWORDS].sort(),
    );
    for (const f of OLD_PASSWORDS) expect(after[f], f).toBe(before[f]);
    const human = after['nats-human.txt'] ?? '';
    expect(human).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(OLD_PASSWORDS.map((f) => before[f])).not.toContain(human);
    const entries = parseEntries(after['nats-auth.conf'] ?? '');
    expect(entries.map((e) => e.user).sort()).toEqual(
      ['deploy', 'human', 'neoforge', 'seed', 'sink', 'velocity', 'body'].sort(),
    );
    for (const u of OLD_USERS) {
      expect(entries.find((e) => e.user === u)?.password, u).toBe(
        (before[`nats-${u}.txt`] ?? '').trim(),
      );
    }
    expect(entries.find((e) => e.user === 'human')?.password).toBe(human.trim());
  }, 60_000);
});
