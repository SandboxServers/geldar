/**
 * The NATS auth generator (`./geldar.ps1 shard nats-auth`, decisions 0067, 0080 and 0087). The behaviour part runs the
 * real generator under pwsh in a temporary copy of geldar.ps1, shards/ and the compose/*.yml files, so the repo's own
 * compose/secrets/ is never written. It skips when pwsh is not on PATH.
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
const SCRIPT = readFileSync(join(ROOT, 'geldar.ps1'), 'utf8');
const SHARD = 'phase0';
const ROLES = ['body', 'mind', 'eventsink', 'mcp', 'velocity', 'paper'];
const MIND_TYPES = [
  'wake',
  'intent',
  'action',
  'plan_result',
  'reflex_fired',
  'speech',
  'damage',
  'death',
  'sleep',
];
const JS = ['$JS.API.>', '$JS.ACK.>', '_INBOX.>'];
const kv = (bucket: string) => `$KV.${bucket}.>`;

/** The scoped table of decision 0087 for one shard, the same as the live test's roleAllows. */
function expectedTable(s: string): Record<string, { pub: string[]; sub: string[] }> {
  return {
    body: {
      pub: [
        `geldar.${s}.>`,
        ...JS,
        kv('geldar-life-registry'),
        kv('geldar-checkpoints'),
        kv('geldar-body-generation'),
      ],
      sub: [`geldar.${s}.body.>`, '_INBOX.>'],
    },
    mind: {
      pub: [...MIND_TYPES.map((t) => `geldar.${s}.${t}`), ...JS, `geldar.${s}.body.>`],
      sub: ['_INBOX.>'],
    },
    eventsink: { pub: [`geldar.${s}.dlq`, ...JS], sub: ['_INBOX.>'] },
    mcp: {
      pub: [`geldar.${s}.sovereign_call`, `geldar.${s}.body.>`, kv('geldar-presence'), ...JS],
      sub: ['_INBOX.>'],
    },
    velocity: { pub: [kv('geldar-life-registry'), kv('geldar-skins'), ...JS], sub: ['_INBOX.>'] },
    paper: { pub: [`geldar.${s}.>`, ...JS], sub: ['_INBOX.>'] },
  };
}

/** The text of one top-level PowerShell function, from its keyword to the next top-level function. */
function functionBody(name: string): string {
  const start = SCRIPT.indexOf(`function ${name}`);
  if (start < 0) return '';
  const next = SCRIPT.indexOf('\nfunction ', start + 1);
  return SCRIPT.slice(start, next < 0 ? undefined : next);
}

const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

/** The quoted strings in one allow list, in order. */
const quoted = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');

interface Entry {
  user: string;
  password: string;
  pub: string[];
  sub: string[];
  raw: string;
}

/** The user entries of the rendered server config, one per `{ user: ... }` line. */
function parseEntries(conf: string): Entry[] {
  return conf
    .split('\n')
    .filter((line) => line.includes('user: "'))
    .map((raw) => ({
      user: /user: "([^"]+)"/.exec(raw)?.[1] ?? '',
      password: /password: "([^"]*)"/.exec(raw)?.[1] ?? '',
      pub: quoted(/publish: \{ allow: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
      sub: quoted(/subscribe: \{ allow: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
      raw,
    }));
}

interface Rendered {
  dir: string;
  conf: string;
  status: number | null;
}

let rendered: Rendered | undefined;

// Runs the real generator once for the phase0 shard, in a temp copy of the repo's generator inputs.
beforeAll(() => {
  if (!hasPwsh) return;
  const dir = mkdtempSync(join(tmpdir(), 'geldar-nats-auth-'));
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
  const confPath = join(dir, 'compose', 'secrets', 'nats-auth.conf');
  const conf = run.status === 0 ? readFileSync(confPath, 'utf8') : '';
  rendered = { dir, conf, status: run.status };
});

afterAll(() => {
  if (rendered) rmSync(rendered.dir, { recursive: true, force: true });
});

describe('geldar.ps1 NATS auth generator: static wiring', () => {
  it('defines Initialize-NatsAuth and Get-NatsUsers, and dispatches nats-auth to it', () => {
    expect(functionBody('Initialize-NatsAuth')).not.toBe('');
    expect(functionBody('Get-NatsUsers')).not.toBe('');
    expect(SCRIPT).toMatch(/'nats-auth' \{ Initialize-NatsAuth \$shard \}/);
  });
});

describe.skipIf(!hasPwsh)('geldar.ps1 NATS auth generator: rendered output', () => {
  it('runs the generator without error', () => {
    expect(rendered?.status).toBe(0);
  });

  it('puts allow_responses inside each user permissions, never on the user block', () => {
    // Booleans, not toMatch: a failing matcher would print the config, and the config holds generated passwords.
    const entries = parseEntries(rendered?.conf ?? '');
    expect(entries.length).toBeGreaterThan(0);
    expect(/password: "[^"]*", allow_responses/.test(rendered?.conf ?? '')).toBe(false);
    const inPermissions = entries.map((e) =>
      /permissions: \{.*allow_responses: true \} \},?$/.test(e.raw),
    );
    expect(inPermissions).toEqual(entries.map(() => true));
  });
});
