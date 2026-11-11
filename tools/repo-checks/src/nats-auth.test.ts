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
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = readFileSync(join(ROOT, 'geldar.ps1'), 'utf8');
const SHARD = 'phase0';
/** The compose files that only add to a base: never validated alone (geldar.ps1 Invoke-Check and ci.yml). */
const OVERLAYS = ['rcon-host.yml', 'nats-auth.yml', 'nats-auth-mcp.yml', 'colo-public.yml'];
const ROLES = ['body', 'mind', 'eventsink', 'mcp', 'velocity', 'paper', 'kino'];
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
    velocity: { pub: [...VELOCITY_PUB], sub: ['_INBOX.>'] },
    // Kino: the plugin reads control and publishes the feed; Glass reads the feed and publishes control (and only that).
    paper: { pub: [`geldar.${s}.>`, ...JS], sub: [`geldar.${s}.kino.control`, '_INBOX.>'] },
    kino: { pub: [`geldar.${s}.kino.control`], sub: [`geldar.${s}.kino.*.feed`, '_INBOX.>'] },
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
const hasDocker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

/** `docker compose` over the named files in compose/, rendered as JSON. Offline: no image is pulled. */
function renderCompose(...files: string[]) {
  const args = files.flatMap((f) => ['-f', join(ROOT, 'compose', f)]);
  return spawnSync('docker', ['compose', ...args, 'config', '--format', 'json'], {
    encoding: 'utf8',
  });
}

/** The quoted strings in one allow list, in order. */
const quoted = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '');

interface Entry {
  user: string;
  password: string;
  pub: string[];
  sub: string[];
  deny: string[];
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
      deny: quoted(/publish: \{ allow: \[[^\]]*\], deny: \[([^\]]*)\]/.exec(raw)?.[1] ?? ''),
      raw,
    }));
}

interface Rendered {
  dir: string;
  conf: string;
  status: number | null;
  /** The generator's stderr, trimmed. It names paths and PowerShell errors only: the generator never echoes a secret. */
  stderr: string;
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
  rendered = { dir, conf, status: run.status, stderr: (run.stderr ?? '').trim().slice(0, 1500) };
});

afterAll(() => {
  if (rendered) rmSync(rendered.dir, { recursive: true, force: true });
});

/**
 * In one merged render, the services that set GELDAR_NATS_PASSWORD_FILE, and those whose file is not the target of one of
 * their own secrets (so the container would start without its password). Service names only: no value is returned.
 */
function natsPasswordGaps(...files: string[]) {
  const run = renderCompose(...files);
  type Svc = { environment?: Record<string, string>; secrets?: { target?: string }[] };
  const services: Record<string, Svc> = JSON.parse(run.stdout || '{}').services ?? {};
  const named = Object.entries(services).filter(
    ([, s]) => s.environment?.GELDAR_NATS_PASSWORD_FILE,
  );
  // A relative secret target mounts under /run/secrets/, as compose does for the long form.
  const mountedAt = (target = '') => (target.startsWith('/') ? target : `/run/secrets/${target}`);
  const gaps = named.filter(
    ([, s]) =>
      !(s.secrets ?? []).some(
        (x) => mountedAt(x.target) === s.environment?.GELDAR_NATS_PASSWORD_FILE,
      ),
  );
  return { status: run.status, checked: named.map(([name]) => name), gaps: gaps.map(([n]) => n) };
}

describe.skipIf(!hasDocker)('compose NATS auth overlays merge offline', () => {
  it('merges colo.yml with nats-auth.yml, which adds no service of its own', () => {
    const run = renderCompose('colo.yml', 'nats-auth.yml');
    expect(run.status).toBe(0);
  });

  it('points every NATS password file in the merged colo config at a secret its service mounts', () => {
    const { status, checked, gaps } = natsPasswordGaps('colo.yml', 'nats-auth.yml');
    expect(status).toBe(0);
    expect(checked).toContain('golem-body');
    expect(gaps).toEqual([]);
  });

  it('points every NATS password file in the merged phase0 config at a secret its service mounts', () => {
    const { status, checked, gaps } = natsPasswordGaps(
      'phase0.yml',
      'mcp.yml',
      'nats-auth.yml',
      'nats-auth-mcp.yml',
    );
    expect(status).toBe(0);
    expect(checked).toEqual(
      expect.arrayContaining(['paper', 'velocity', 'eventsink', 'geldar-mcp']),
    );
    expect(gaps).toEqual([]);
  });

  it('keeps the -js -sd /data flags colo sets on nats when the overlay is merged', () => {
    const run = renderCompose('colo.yml', 'nats-auth.yml');
    const command = JSON.parse(run.stdout || '{}').services?.nats?.command ?? [];
    expect(command).toEqual(expect.arrayContaining(['-js', '-sd', '/data']));
  });

  it('sets the store dir once: -sd in the merged command of both stacks, no store_dir in the generator', () => {
    for (const base of ['colo.yml', 'phase0.yml']) {
      const merged = renderCompose(base, 'nats-auth.yml');
      const command: string[] = JSON.parse(merged.stdout || '{}').services?.nats?.command ?? [];
      expect(command.filter((a) => a === '-sd')).toHaveLength(1);
      expect(command).toEqual(expect.arrayContaining(['-js', '-sd', '/data', '-c']));
    }
    expect(functionBody('Initialize-NatsAuth')).not.toContain('store_dir');
  });

  it('merges phase0.yml with mcp.yml, nats-auth.yml and nats-auth-mcp.yml', () => {
    const run = renderCompose('phase0.yml', 'mcp.yml', 'nats-auth.yml', 'nats-auth-mcp.yml');
    expect(run.status).toBe(0);
  });
});

describe('geldar.ps1 NATS auth generator: static wiring', () => {
  it('defines Initialize-NatsAuth and Get-NatsUsers, and dispatches nats-auth to it', () => {
    expect(functionBody('Initialize-NatsAuth')).not.toBe('');
    expect(functionBody('Get-NatsUsers')).not.toBe('');
    expect(SCRIPT).toMatch(/'nats-auth' \{ Initialize-NatsAuth \$shard \}/);
  });

  it('skips every overlay when validating compose files alone, and merges nats-auth-mcp.yml into the Phase 0 chain', () => {
    // An overlay has no image of its own, so validating it alone fails. Each skip list must name all of them.
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const psSkip = /-notin @\(([^)]*rcon-host[^)]*)\)/.exec(SCRIPT)?.[1] ?? '';
    const ciSkip = /case "\$\(basename "\$f"\)" in ([\w.|-]+)\)/.exec(ci)?.[1]?.split('|') ?? [];
    for (const overlay of OVERLAYS) {
      expect(psSkip).toContain(`'${overlay}'`);
      expect(ciSkip).toContain(overlay);
    }
    expect(SCRIPT).toMatch(/-f \(Join-Path \$Root 'compose\/nats-auth-mcp\.yml'\) config --quiet/);
    expect(
      ci
        .split('\n')
        .some((l) =>
          l.includes(
            '-f compose/phase0.yml -f compose/mcp.yml -f compose/nats-auth.yml -f compose/nats-auth-mcp.yml',
          ),
        ),
    ).toBe(true);
  });
});

describe.skipIf(!hasPwsh)('geldar.ps1 NATS auth generator: rendered output', () => {
  it('runs the generator without error', () => {
    // The message carries the exit code and stderr, so a CI failure says why. No secret is printed: see Rendered.
    expect(rendered?.status, `exit ${rendered?.status}: ${rendered?.stderr}`).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'makes each NATS secret file and the server config owner-only (mode 0600)',
    () => {
      // Off Windows the owner-only step is chmod 600; on Windows the ACL is checked by the icacls step, not here.
      const dir = join(rendered?.dir ?? '', 'compose', 'secrets');
      const names = [
        ...ROLES.map((role) => `nats-${role}.txt`),
        'thinker-token.txt',
        'nats-auth.conf',
      ];
      const modes = names.map((name) => statSync(join(dir, name)).mode & 0o777);
      expect(modes).toEqual(names.map(() => 0o600));
    },
  );

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

  it('writes one password file per role, and the config carries the same password', () => {
    const dir = join(rendered?.dir ?? '', 'compose', 'secrets');
    const entries = parseEntries(rendered?.conf ?? '');
    const files = ROLES.map((role) => ({
      role,
      // A value check, not a print: the test reports booleans only.
      text: readFileSync(join(dir, `nats-${role}.txt`), 'utf8'),
    }));
    expect(files.map((f) => /^[A-Za-z0-9_-]{32}$/.test(f.text))).toEqual(ROLES.map(() => true));
    const same = entries.map((e) => e.password === files.find((f) => f.role === e.user)?.text);
    expect(same).toEqual(entries.map(() => true));
  });

  it('writes exactly the seven role users, with no ops user the overlay does not mount', () => {
    const names = parseEntries(rendered?.conf ?? '').map((e) => e.user);
    expect(names).toEqual(ROLES);
  });

  it('emits the scoped subject table of decision 0087 for each role, with no bare * token', () => {
    const entries = parseEntries(rendered?.conf ?? '');
    const want = expectedTable(SHARD);
    // Subject lists only: the entries carry passwords, and a failing expect prints its value.
    const actual = entries
      .filter((e) => ROLES.includes(e.user))
      .map((e) => ({
        user: e.user,
        pub: [...e.pub].sort(),
        sub: [...e.sub].sort(),
      }));
    const expected = ROLES.map((role) => ({
      user: role,
      pub: [...(want[role]?.pub ?? [])].sort(),
      sub: [...(want[role]?.sub ?? [])].sort(),
    }));
    expect(actual).toEqual(expected);
    // The one wildcard token is the agent id in Glass's feed subscription: geldar.<shard>.kino.*.feed.
    const bare = entries.some((e) =>
      [...e.pub, ...e.sub].some(
        (s) => s.split('.').includes('*') && s !== `geldar.${SHARD}.kino.*.feed`,
      ),
    );
    expect(bare).toBe(false);
  });

  it('keeps the Kino subjects to the plugin and to Glass: only paper publishes the feed, only kino publishes control', () => {
    const entries = parseEntries(rendered?.conf ?? '');
    const by = (u: string) => entries.find((e) => e.user === u);
    const feed = `geldar.${SHARD}.kino.ag_x.feed`;
    const control = `geldar.${SHARD}.kino.control`;
    // body may publish geldar.<s>.> but its deny list takes the whole kino tree off it; paper is denied control only.
    expect(by('body')?.deny).toEqual([`geldar.${SHARD}.kino.>`]);
    expect(by('paper')?.deny).toEqual([control]);
    expect(by('kino')?.deny).toEqual([]);
    const reach = (subject: string, list: string[]) =>
      list.some((p) => subject === p || (p.endsWith('.>') && subject.startsWith(p.slice(0, -1))));
    const pubs = entries
      .filter((e) => reach(control, e.pub) && !reach(control, e.deny))
      .map((e) => e.user);
    const feedPubs = entries
      .filter((e) => reach(feed, e.pub) && !reach(feed, e.deny))
      .map((e) => e.user);
    const subsControl = entries.filter((e) => reach(control, e.sub)).map((e) => e.user);
    expect(pubs).toEqual(['kino']);
    expect(feedPubs).toEqual(['paper']);
    expect(subsControl).toEqual(['paper']);
    const subsFeed = entries
      .filter((e) => e.sub.includes(`geldar.${SHARD}.kino.*.feed`))
      .map((e) => e.user);
    expect(subsFeed).toEqual(['kino']);
  });
});

/** The subset of a compose service this file reads: environment (map or KEY=VALUE list) and secrets (short or long). */
interface ServiceDoc {
  environment?: Record<string, string> | string[];
  secrets?: (string | { source?: string; target?: string })[];
}

/** The environment of one service as a map. */
function envMap(env: ServiceDoc['environment']): Record<string, string> {
  if (!env) return {};
  if (!Array.isArray(env)) return env;
  return Object.fromEntries(
    env.map((entry) => {
      const cut = entry.indexOf('=');
      return cut < 0 ? [entry, ''] : [entry.slice(0, cut), entry.slice(cut + 1)];
    }),
  );
}

/** Where compose mounts one secret: a short entry at /run/secrets/<name>, a long one at its target (relative or absolute). */
function mountOf(s: string | { source?: string; target?: string }): string {
  if (typeof s === 'string') return `/run/secrets/${s}`;
  const name = s.target ?? s.source ?? '';
  return name.startsWith('/') ? name : `/run/secrets/${name}`;
}

/**
 * The services of the given compose files, merged the way `docker compose -f a -f b` merges an overlay: environment keys
 * and secret entries accumulate per service. Read from the YAML files, so no docker is needed.
 */
function mergeComposeFiles(
  ...files: string[]
): Record<string, { env: Record<string, string>; mounts: string[] }> {
  const out: Record<string, { env: Record<string, string>; mounts: string[] }> = {};
  for (const file of files) {
    const doc = parse(readFileSync(join(ROOT, 'compose', file), 'utf8')) as {
      services?: Record<string, ServiceDoc>;
    };
    for (const [name, svc] of Object.entries(doc.services ?? {})) {
      const cur = out[name] ?? { env: {}, mounts: [] };
      Object.assign(cur.env, envMap(svc.environment));
      cur.mounts.push(...(svc.secrets ?? []).map(mountOf));
      out[name] = cur;
    }
  }
  return out;
}

describe('colo NATS auth wiring, static (no docker needed)', () => {
  it('points every NATS password file in colo.yml merged with nats-auth.yml at a secret the service mounts', () => {
    const services = mergeComposeFiles('colo.yml', 'nats-auth.yml');
    const named = Object.entries(services).filter(([, s]) => s.env.GELDAR_NATS_PASSWORD_FILE);
    // Names only: a failing expect prints the service names, never a value.
    expect(named.map(([n]) => n)).toEqual(
      expect.arrayContaining(['golem-body', 'animus', 'paper', 'velocity', 'eventsink']),
    );
    const gaps = named
      .filter(([, s]) => !s.mounts.includes(s.env.GELDAR_NATS_PASSWORD_FILE ?? ''))
      .map(([n]) => n);
    expect(gaps).toEqual([]);
  });

  it('gives animus the mind user and a password file mounted from the nats-mind secret', () => {
    const animus = mergeComposeFiles('colo.yml').animus;
    expect(animus?.env.GELDAR_NATS_USER).toBe('mind');
    expect(animus?.env.GELDAR_NATS_URL).toBe('nats://nats:4222');
    expect(animus?.mounts).toContain('/run/secrets/nats-mind.txt');
  });

  it('merges nats-auth.yml into `shard up colo` in Invoke-Shard', () => {
    const invoke = functionBody('Invoke-Shard');
    expect(invoke).toMatch(
      /if \(\$shard -eq 'colo' -and \$action -eq 'up'\) \{ \$files \+= @\('-f', \(Join-Path \$Root 'compose\/nats-auth\.yml'\)\) \}/,
    );
  });
});
