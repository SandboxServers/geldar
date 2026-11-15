/**
 * The hearing subject ACL (decision 0199, MH-CH): only the plugin (paper) publishes a hearing notice on
 * geldar.<shard>.body.<lifeId>.hearing. body, mind and mcp hold a publish allow that covers it (body.> or geldar.<s>.>),
 * so each is denied it by name. The generator runs for real, as in nats-auth.test.ts. The rendered config holds generated
 * passwords, so the assertions are on subjects and booleans only. It skips when pwsh is not on PATH.
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
const LIFE = 'life_1';
const HEARING = `geldar.${SHARD}.body.${LIFE}.hearing`;
const HEARING_DENY = `geldar.${SHARD}.body.*.hearing`;
/** The roles whose publish allow covers the hearing subject; paper is the only one allowed to publish it. */
const DENIED_ROLES = ['body', 'mind', 'mcp'];

const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

/** NATS subject match for one pattern: `*` is one token, a trailing `>` is one or more tokens. */
function matches(pattern: string, subject: string): boolean {
  const p = pattern.split('.');
  const t = subject.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '>') return i === p.length - 1 && t.length > i;
    if (i >= t.length || (p[i] !== '*' && p[i] !== t[i])) return false;
  }
  return p.length === t.length;
}

/** The quoted strings in one allow or deny list, in order. */
const quoted = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');

interface Entry {
  user: string;
  pub: string[];
  sub: string[];
  deny: string[];
}

/** The user entries of the rendered config. The raw line is not kept: it holds a generated password. */
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
let dir = '';
let status: number | null = null;

// Runs the real generator once for the phase0 shard, in a temp copy of the repo's generator inputs.
beforeAll(() => {
  if (!hasPwsh) return;
  dir = mkdtempSync(join(tmpdir(), 'geldar-nats-hearing-'));
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
  status = run.status;
  if (run.status === 0)
    conf = readFileSync(join(dir, 'compose', 'secrets', 'nats-auth.conf'), 'utf8');
}, 120_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasPwsh)(
  'geldar.ps1 NATS auth: the hearing subject is published by the plugin only',
  () => {
    it('runs the generator without error', () => {
      expect(status).toBe(0);
    });

    it('lets paper publish the hearing subject (geldar.<s>.>), so the plugin can publish a notice', () => {
      const paper = parseEntries(conf).find((e) => e.user === 'paper');
      expect(paper?.pub.some((p) => matches(p, HEARING))).toBe(true);
    });

    it('lets body subscribe to the hearing subject (geldar.<s>.body.>), so a later narrowing fails here', () => {
      const body = parseEntries(conf).find((e) => e.user === 'body');
      expect(body?.sub.some((p) => matches(p, HEARING))).toBe(true);
    });

    it('denies body, mind and mcp publishing the hearing subject by name, and not paper', () => {
      const entries = parseEntries(conf);
      for (const role of DENIED_ROLES) {
        const entry = entries.find((e) => e.user === role);
        expect(entry?.deny ?? [], `${role} deny list`).toContain(HEARING_DENY);
      }
      expect(entries.find((e) => e.user === 'paper')?.deny ?? []).not.toContain(HEARING_DENY);
    });

    it('matches the deny pattern on exactly the life id token', () => {
      expect(matches(HEARING_DENY, HEARING)).toBe(true);
      expect(matches(HEARING_DENY, `geldar.${SHARD}.body.hearing`)).toBe(false);
      expect(matches(HEARING_DENY, `geldar.${SHARD}.body.${LIFE}.x.hearing`)).toBe(false);
    });

    it('leaves exactly the plugin able to publish the hearing subject', () => {
      // A user can publish when an allow matches and no deny does (nats-server takes deny first).
      const canPub = parseEntries(conf)
        .filter(
          (e) => e.pub.some((p) => matches(p, HEARING)) && !e.deny.some((p) => matches(p, HEARING)),
        )
        .map((e) => e.user);
      expect(canPub).toEqual(['paper']);
    });
  },
);
