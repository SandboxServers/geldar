/**
 * Shared fixtures for the NATS auth tests (nats-auth.test.ts and nats-auth-generator.test.ts): the scoped subject table of
 * decision 0087, the subject matcher, the parsed user entries, and the one generator run. It holds no test.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const SCRIPT = readFileSync(join(ROOT, 'geldar.ps1'), 'utf8');
export const SHARD = 'phase0';
/** The compose files that only add to a base: never validated alone (geldar.ps1 Invoke-Check and ci.yml). */
export const OVERLAYS = ['rcon-host.yml', 'nats-auth.yml', 'nats-auth-mcp.yml', 'colo-public.yml'];
export const ROLES = [
  'body',
  'mind',
  'eventsink',
  'mcp',
  'velocity',
  'paper',
  'kino',
  'deploy',
  'supervisor',
  'register',
  'helper',
];
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
/** Velocity is read-only on two buckets (0137 item 3): a KV watch and nothing else. */
const VELOCITY_PUB = [
  ...['geldar-life-registry', 'geldar-skins'].flatMap((b) => [
    `$JS.API.STREAM.INFO.KV_${b}`,
    `$JS.API.CONSUMER.CREATE.KV_${b}`,
    `$JS.API.CONSUMER.CREATE.KV_${b}.>`,
    `$JS.API.CONSUMER.INFO.KV_${b}.>`,
    `$JS.API.CONSUMER.DELETE.KV_${b}.>`,
  ]),
  '$JS.FC.>',
  '_INBOX.>',
];

/** The scoped table of decision 0087 for one shard, the same as the live test's roleAllows. */
export function expectedTable(s: string): Record<string, { pub: string[]; sub: string[] }> {
  return {
    body: {
      pub: [
        `geldar.${s}.>`,
        ...JS,
        kv('geldar-life-registry'),
        kv('geldar-checkpoints'),
        kv('geldar-body-generation'),
        kv('geldar-skins'),
      ],
      sub: [
        `geldar.${s}.body.>`,
        `geldar.${s}.blockowner.changed`,
        `geldar.${s}.state.*.level`,
        '_INBOX.>',
      ],
    },
    mind: {
      pub: [...MIND_TYPES.map((t) => `geldar.${s}.${t}`), ...JS, `geldar.${s}.body.>`],
      sub: ['_INBOX.>'],
    },
    // State (0280, AN-02b): the eventsink publishes the level push on state.<life>.level.
    eventsink: {
      pub: [`geldar.${s}.dlq`, `geldar.${s}.state.>`, ...JS],
      sub: [`geldar.${s}.state.*.proficiency`, '_INBOX.>'],
    },
    mcp: {
      pub: [`geldar.${s}.sovereign_call`, `geldar.${s}.body.>`, kv('geldar-presence'), ...JS],
      sub: ['_INBOX.>'],
    },
    velocity: { pub: [...VELOCITY_PUB], sub: ['_INBOX.>'] },
    // Kino: the plugin reads control and publishes the feed; Glass reads the feed and publishes control (and only that).
    // Maintenance (CD-1c): the plugin subscribes to the notice subject; only the deploy publishes it (CD-1d).
    paper: {
      pub: [`geldar.${s}.>`, ...JS],
      sub: [
        `geldar.${s}.kino.control`,
        `geldar.${s}.maintenance`,
        `geldar.${s}.blockowner.query`,
        '_INBOX.>',
      ],
    },
    kino: { pub: [`geldar.${s}.kino.control`], sub: [`geldar.${s}.kino.*.feed`, '_INBOX.>'] },
    // Deploy (CD-1d): the maintenance subject only; no JetStream API and no Kino subject.
    deploy: { pub: [`geldar.${s}.maintenance`], sub: ['_INBOX.>'] },
    // Body control (C7-03b1): the supervisor answers ctl.body and replies to inboxes; register requests and needs its inbox.
    // Body helper (C7-03c1): the supervisor requests the four verbs on their exact subjects; the helper hears them.
    supervisor: {
      pub: [
        '_INBOX.>',
        ...['start', 'stop', 'status', 'logtail'].map((v) => `geldar.${s}.helper.body.${v}`),
      ],
      sub: [`geldar.${s}.ctl.body.>`, '_INBOX.>'],
    },
    register: { pub: [`geldar.${s}.ctl.body.>`], sub: ['_INBOX.>'] },
    helper: {
      pub: ['_INBOX.>'],
      sub: ['start', 'stop', 'status', 'logtail'].map((v) => `geldar.${s}.helper.body.${v}`),
    },
  };
}

/** NATS subject match for one pattern: `*` is one token, a trailing `>` is one or more tokens. */
export function subjectMatches(pattern: string, subject: string): boolean {
  const p = pattern.split('.');
  const s = subject.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '>') return i === p.length - 1 && s.length > i;
    if (i >= s.length) return false;
    if (p[i] !== '*' && p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}

/** The text of one top-level PowerShell function, from its keyword to the next top-level function. */
export function functionBody(name: string): string {
  const start = SCRIPT.indexOf(`function ${name}`);
  if (start < 0) return '';
  const next = SCRIPT.indexOf('\nfunction ', start + 1);
  return SCRIPT.slice(start, next < 0 ? undefined : next);
}

export const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;
export const hasDocker =
  spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

/** pwsh and docker compose start slowly on loaded machines and can exceed vitest's 5 s test and 10 s hook defaults. */
export const GENERATOR_TIMEOUT_MS = 120_000;

/** The quoted strings in one allow list, in order. */
const quoted = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');

export interface Entry {
  user: string;
  password: string;
  pub: string[];
  sub: string[];
  deny: string[];
  raw: string;
}

/** The user entries of the rendered server config, one per `{ user: ... }` line. */
export function parseEntries(conf: string): Entry[] {
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

export interface Rendered {
  dir: string;
  conf: string;
  status: number | null;
  /** The generator's stderr, trimmed. It names paths and PowerShell errors only: the generator never echoes a secret. */
  stderr: string;
}

/**
 * Runs the real generator for the phase0 shard, in a temp copy of the repo's generator inputs. The caller removes `dir`.
 * The repo's own compose/secrets/ is never written.
 */
export function renderGenerator(): Rendered {
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
  return { dir, conf, status: run.status, stderr: (run.stderr ?? '').trim().slice(0, 1500) };
}
