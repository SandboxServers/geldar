/**
 * The ctl.body subject rules in the rendered NATS auth config (decision 0152, item 3). Split from nats-auth.test.ts to
 * keep each file under 500 lines. It runs the same generator once, on the phase0 shard, in a temporary copy of the
 * generator inputs; it skips when pwsh is not on PATH.
 */
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SHARD = 'phase0';
const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

/** The quoted strings in one allow list, in order. */
const quoted = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');

/** Whether one allow or deny list matches a concrete subject: `*` is one token, `>` the rest (one or more tokens). */
function allowed(list: string[], subject: string): boolean {
  const s = subject.split('.');
  return list.some((p) => {
    const t = p.split('.');
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '>') return i < s.length;
      if (i >= s.length || (t[i] !== '*' && t[i] !== s[i])) return false;
    }
    return t.length === s.length;
  });
}

interface Entry {
  user: string;
  password: string;
  pub: string[];
  sub: string[];
  deny: string[];
  raw: string;
}

function parseEntries(conf: string): Entry[] {
  return conf
    .split('\n')
    .filter((line) => line.includes('user: "'))
    .map((raw) => ({
      user: /user: "([^"]+)"/.exec(raw)?.[1] ?? '',
      password: /password: "([^"]*)"/.exec(raw)?.[1] ?? '',
      pub: quoted(/publish: \{ allow: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
      sub: quoted(/subscribe: \{ allow: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
      deny: quoted(/publish: \{ allow: \[[^\]]*\], deny: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
      raw,
    }));
}

let conf = '';
let dir = '';

beforeAll(() => {
  if (!hasPwsh) return;
  dir = mkdtempSync(join(tmpdir(), 'geldar-nats-ctl-'));
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
  if (run.status === 0)
    conf = readFileSync(join(dir, 'compose', 'secrets', 'nats-auth.conf'), 'utf8');
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasPwsh)('geldar.ps1 NATS auth generator: ctl.body subject rules', () => {
  it('denies a ctl.body publish to every role but supervisor and register, and the body and paper by explicit deny', () => {
    // NATS deny wins over allow: body and paper have a wide allow, so the explicit deny is what keeps them off ctl.body.
    const entries = parseEntries(conf);
    const byUser = (u: string) => entries.find((e) => e.user === u);
    const ctl = `geldar.${SHARD}.ctl.body.start`;
    for (const role of [
      'body',
      'mind',
      'eventsink',
      'mcp',
      'velocity',
      'paper',
      'kino',
      'deploy',
    ]) {
      const e = byUser(role);
      expect(e).toBeDefined();
      expect(allowed(e?.pub ?? [], ctl) && !allowed(e?.deny ?? [], ctl)).toBe(false);
    }
    expect(byUser('body')?.deny).toContain(`geldar.${SHARD}.ctl.body.>`);
    expect(byUser('paper')?.deny).toContain(`geldar.${SHARD}.ctl.body.>`);
  });

  it('lets supervisor subscribe to ctl.body and publish only inbox replies, and lets register publish ctl.body only', () => {
    const entries = parseEntries(conf);
    const sup = entries.find((e) => e.user === 'supervisor');
    const reg = entries.find((e) => e.user === 'register');
    const ctl = `geldar.${SHARD}.ctl.body.start`;
    expect(allowed(sup?.sub ?? [], ctl)).toBe(true);
    expect(allowed(sup?.pub ?? [], ctl)).toBe(false);
    expect(allowed(sup?.pub ?? [], `_INBOX.abc`)).toBe(true);
    expect(allowed(reg?.pub ?? [], ctl)).toBe(true);
    // Widening register's subscribe to geldar.<s>.> would make this true; the deny test catches it.
    expect(allowed(reg?.sub ?? [], ctl)).toBe(false);
    expect(allowed(reg?.pub ?? [], `geldar.${SHARD}.body.x.plan`)).toBe(false);
  });
});
