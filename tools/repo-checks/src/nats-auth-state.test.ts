// AN-12b: the state subtree in the NATS role table. The eventsink subscribes to the proficiency request and publishes
// the level push; the body requests and hears the pushes; no other role gains a state subject. Rendered by the real
// generator (pwsh), as nats-auth.test.ts does. Booleans and subject lists only: the config holds generated passwords.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SHARD = 'phase0';
const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;
const GENERATOR_TIMEOUT_MS = 120_000;

interface Entry {
  user: string;
  pub: string[];
  sub: string[];
  deny: string[];
}

const quoted = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');

/** The user entries of the rendered config, without the passwords. */
function parseEntries(conf: string): Entry[] {
  return conf
    .split('\n')
    .filter((line) => line.includes('user: "'))
    .map((raw) => ({
      user: /user: "([^"]+)"/.exec(raw)?.[1] ?? '',
      pub: quoted(/publish: \{ allow: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
      sub: quoted(/subscribe: \{ allow: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
      deny: quoted(/publish: \{ allow: \[[^\]]*\], deny: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
    }));
}

let conf = '';
let generatorStatus: number | null = null;

beforeAll(() => {
  if (!hasPwsh) return;
  const dir = mkdtempSync(join(tmpdir(), 'geldar-nats-state-'));
  try {
    copyFileSync(join(ROOT, 'geldar.ps1'), join(dir, 'geldar.ps1'));
    cpSync(join(ROOT, 'shards'), join(dir, 'shards'), { recursive: true });
    mkdirSync(join(dir, 'compose'));
    for (const f of readdirSync(join(ROOT, 'compose'))) {
      if (f.endsWith('.yml')) copyFileSync(join(ROOT, 'compose', f), join(dir, 'compose', f));
    }
    const run = spawnSync(
      'pwsh',
      ['-NoProfile', '-File', join(dir, 'geldar.ps1'), 'shard', 'nats-auth', SHARD],
      { encoding: 'utf8', cwd: dir },
    );
    generatorStatus = run.status;
    if (run.status === 0)
      conf = readFileSync(join(dir, 'compose', 'secrets', 'nats-auth.conf'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, GENERATOR_TIMEOUT_MS);

/** NATS matching: `*` is one token, a trailing `>` is one or more tokens (the rule the other ACL tests use). */
function matches(pattern: string, subject: string): boolean {
  const p = pattern.split('.');
  const t = subject.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '>') return i < t.length;
    if (i >= t.length || (p[i] !== '*' && p[i] !== t[i])) return false;
  }
  return p.length === t.length;
}

describe.skipIf(!hasPwsh)('geldar.ps1 NATS auth: the state subtree (AN-12b)', () => {
  const entries = () => parseEntries(conf);
  const by = (user: string) => entries().find((e) => e.user === user);
  const canPub = (subject: string) =>
    entries()
      .filter(
        (e) => e.pub.some((p) => matches(p, subject)) && !e.deny.some((p) => matches(p, subject)),
      )
      .map((e) => e.user)
      .sort();
  const canSub = (subject: string) =>
    entries()
      .filter((e) => e.sub.some((p) => matches(p, subject)))
      .map((e) => e.user)
      .sort();
  const level = `geldar.${SHARD}.state.life_1.level`;
  const request = `geldar.${SHARD}.state.life_1.proficiency`;

  it('runs the generator and writes the config', () => {
    expect(generatorStatus, 'the generator exit status').toBe(0);
    expect(conf.length).toBeGreaterThan(0);
  });

  it('eventsink may publish and subscribe on the state subtree', () => {
    expect(by('eventsink')?.sub).toContain(`geldar.${SHARD}.state.>`);
    expect(canPub(level)).toEqual(['eventsink']);
    expect(canSub(request)).toContain('eventsink');
    expect(canSub(level)).toContain('eventsink');
  });

  it('lets the body request the proficiency and hear the level push, and denies it publishing the push', () => {
    expect(canPub(request)).toContain('body');
    expect(by('body')?.sub).toContain(`geldar.${SHARD}.state.>`);
    expect(canSub(level)).toContain('body');
    expect(canPub(level)).not.toContain('body');
    expect(by('body')?.deny).toContain(`geldar.${SHARD}.state.*.level`);
  });

  it('denies the paper role a level push and gives it no state subscription', () => {
    expect(canPub(level)).not.toContain('paper');
    expect(by('paper')?.sub).not.toEqual(expect.arrayContaining([`geldar.${SHARD}.state.>`]));
    expect(canSub(request)).not.toContain('paper');
  });

  it('leaves mcp, mind and kino without any state subject', () => {
    for (const user of ['mcp', 'mind', 'kino']) {
      const e = by(user);
      const reach = [...(e?.pub ?? []), ...(e?.sub ?? [])];
      expect(
        reach.some((p) => p.includes('.state.')),
        user,
      ).toBe(false);
      expect(canPub(request), user).not.toContain(user);
      expect(canPub(level), user).not.toContain(user);
    }
  });

  it('widens no other role: only eventsink and body hold a state subject in either direction', () => {
    const holders = entries()
      .filter((e) => [...e.pub, ...e.sub].some((p) => p.includes('.state.')))
      .map((e) => e.user)
      .sort();
    expect(holders).toEqual(['body', 'eventsink']);
  });
});
