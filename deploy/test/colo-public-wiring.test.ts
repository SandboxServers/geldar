import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// C2-07c2: the public Minecraft port overlay, the Glass login secret and the Glass image, through colo-up.sh with a
// fake docker. Its own small fixtures; colo-up-order.test.ts and colo-deploy.test.ts have the rest.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const posix = (p: string) => p.replace(/\\/g, '/');
const dg = (name: string, c: string) =>
  `registry.example.invalid/geldar/${name}@sha256:${c.repeat(64)}`;
const MANIFEST = [
  `GELDAR_BODY_IMAGE=${dg('body', '1')}`,
  `GELDAR_MIND_IMAGE=${dg('mind', '2')}`,
  `GELDAR_ADMIN_IMAGE=${dg('admin', '6')}`,
];
const GLASS_LINE = `GELDAR_GLASS_IMAGE=${dg('glass', '7')}`;
const SECRET_NAMES = ['postgres.txt', 'postgres-mcp.txt', 'postgres-glass.txt'];

function findSh(): string {
  if (process.env.GELDAR_TEST_SH) return process.env.GELDAR_TEST_SH;
  if (process.platform !== 'win32') return 'sh';
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
    (p): p is string => Boolean(p),
  );
  return (
    roots.map((r) => join(r, 'Git', 'usr', 'bin', 'sh.exe')).find((p) => existsSync(p)) ?? 'sh'
  );
}
const SH = findSh();
vi.setConfig({ testTimeout: 60_000 });

const DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS_LOG"
case "$*" in
  *"config --quiet"*) exit 0 ;;
  *"config"*) cat "$DOCKER_CONFIG_FIXTURE"; exit 0 ;;
esac
exit 0
`;
const STAT_SHIM = `#!/bin/sh
case $2 in %a) echo 600 ;; %u) echo 1000 ;; *) exit 2 ;; esac
`;
const ID_SHIM = '#!/bin/sh\necho 1000\n';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Fx {
  env: Record<string, string>;
  calls: string;
}

function fixture(opts: { manifest?: string[]; skipSecret?: string } = {}): Fx {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-colo-pubwire-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const [n, t] of [
    ['docker', DOCKER_SHIM],
    ['stat', STAT_SHIM],
    ['id', ID_SHIM],
  ]) {
    writeFileSync(join(bin, n as string), t as string);
    chmodSync(join(bin, n as string), 0o755);
  }
  const secrets = join(dir, 'secrets');
  mkdirSync(secrets);
  for (const f of SECRET_NAMES) {
    if (f !== opts.skipSecret) writeFileSync(join(secrets, f), 'test-value\n');
  }
  const release = join(dir, 'release.env');
  writeFileSync(release, `${(opts.manifest ?? [...MANIFEST, GLASS_LINE]).join('\n')}\n`);
  const entries = SECRET_NAMES.map(
    (n) => `  ${n}:\n    file: ${posix(secrets)}/${n}\n    name: geldar-colo_${n}\n`,
  );
  const config = join(dir, 'config.yml');
  writeFileSync(
    config,
    `name: geldar-colo\nservices:\n  postgres:\n    image: ${dg('pg', '5')}\nsecrets:\n${entries.join('')}`,
  );
  const calls = join(dir, 'calls.log');
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.Path;
  for (const k of ['GELDAR_MC_BIND', 'GELDAR_MC_PORT']) delete env[k];
  Object.assign(env, {
    // On Windows the spawn gets only Git for Windows' tools (usr/bin and mingw64/bin for curl), not the full Windows PATH: MSYS
    // converts the whole PATH on every fork, so a long PATH made one deploy run cost over a minute (see the FX-DEPLOY-WIN note).
    PATH: [
      bin,
      SH === 'sh' ? '' : dirname(SH),
      process.platform === 'win32' ? join(dirname(SH), '..', '..', 'mingw64', 'bin') : '',
      process.platform === 'win32' ? '' : (process.env.PATH ?? ''),
    ]
      .filter(Boolean)
      .join(delimiter),
    GELDAR_COLO_COMPOSE: posix(resolve(ROOT, 'compose', 'colo.yml')),
    GELDAR_SECRETS_DIR: posix(secrets),
    GELDAR_RELEASE_FILE: posix(release),
    GELDAR_STATE_DIR: posix(join(dir, 'state')),
    GELDAR_BLUEMAP_LOCK: posix(join(dir, 'no-lock.json')),
    GELDAR_MIN_FREE_KB: '1',
    GELDAR_SERVICE_UID: '1000',
    DEPLOY_DRY_RUN: '0',
    DOCKER_CALLS_LOG: posix(calls),
    DOCKER_CONFIG_FIXTURE: posix(config),
  });
  return { env, calls };
}

function up(fx: Fx, extra: Record<string, string> = {}) {
  const r = spawnSync(SH, [posix(join(DEPLOY, 'colo-up.sh'))], {
    env: { ...fx.env, ...extra },
    encoding: 'utf8',
  });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}
const composeCalls = (fx: Fx): string[] =>
  existsSync(fx.calls)
    ? readFileSync(fx.calls, 'utf8')
        .split('\n')
        .filter((c) => c.startsWith('compose ') && c.includes(' -f '))
    : [];

const OVERLAY = `-f ${posix(resolve(ROOT, 'compose', 'colo-public.yml'))}`;

describe('public port overlay (GELDAR_MC_BIND, GELDAR_MC_PORT)', () => {
  it('is merged only in the last step, after the healthy full up, after the NATS overlay', () => {
    const fx = fixture();
    const r = up(fx, { GELDAR_MC_BIND: '192.0.2.10', GELDAR_MC_PORT: '25999' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('public Minecraft port published on 192.0.2.10:25999');
    const log = composeCalls(fx).filter((c) => !/ run --rm admin|--profile admin config/.test(c));
    const withOverlay = log.filter((c) => c.includes(OVERLAY));
    // Exactly the validation and the velocity up carry the overlay, and they are the last two compose calls.
    expect(withOverlay).toHaveLength(2);
    expect(log.slice(-2)).toEqual(withOverlay);
    expect(withOverlay[0]).toMatch(/ config --quiet$/);
    expect(withOverlay[1]).toMatch(/ up -d --wait velocity$/);
    for (const c of withOverlay) {
      expect(c.indexOf('nats-auth.yml')).toBeLessThan(c.indexOf('colo-public.yml'));
    }
    // The full healthy up comes before the publish.
    const fullUp = log.findIndex((c) => / up -d --wait$/.test(c));
    expect(fullUp).toBeGreaterThan(-1);
    expect(fullUp).toBeLessThan(log.indexOf(withOverlay[1] as string));
  });

  it('is not merged when neither is set', () => {
    const fx = fixture();
    const r = up(fx);
    expect(r.code).toBe(0);
    for (const c of composeCalls(fx)) expect(c).not.toContain('colo-public.yml');
  });

  it('is merged before the extra overlay when that is set too', () => {
    const fx = fixture();
    const extra = posix(join(DEPLOY, 'compose.secrets.yml'));
    const r = up(fx, {
      GELDAR_MC_BIND: '127.0.0.1',
      GELDAR_MC_PORT: '25999',
      GELDAR_COLO_EXTRA_OVERLAY: extra,
    });
    expect(r.code).toBe(0);
    const c = composeCalls(fx)[0] ?? '';
    expect(c.indexOf('colo-public.yml')).toBeLessThan(c.lastIndexOf(extra));
  });

  it.each([
    ['only the bind', { GELDAR_MC_BIND: '127.0.0.1' }, 'GELDAR_MC_PORT'],
    ['only the port', { GELDAR_MC_PORT: '25999' }, 'GELDAR_MC_BIND'],
  ])('refuses when exactly one is set (%s)', (_n, env, named) => {
    const fx = fixture();
    const r = up(fx, env);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(named);
    expect(r.out).toContain('set both or neither');
    expect(composeCalls(fx).some((c) => / (pull|up)\b/.test(c))).toBe(false);
  });

  it.each(['0.0.0.0', '::', '[::]'])('refuses the wildcard bind %s', (bind) => {
    const fx = fixture();
    const r = up(fx, { GELDAR_MC_BIND: bind, GELDAR_MC_PORT: '25999' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('wildcard');
    expect(composeCalls(fx).some((c) => / (pull|up)\b/.test(c))).toBe(false);
  });

  it('refuses a port that is not a number', () => {
    const r = up(fixture(), { GELDAR_MC_BIND: '127.0.0.1', GELDAR_MC_PORT: '25x' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('GELDAR_MC_PORT must be a number');
  });

  it.each([
    'play.example.invalid',
    '2001:db8::1',
    '[2001:db8::1]',
    '192.0.2.1,192.0.2.2',
    '192.0.2',
    '192.0.2.256',
    '192.0.2.01',
    '192.0.2.1 ',
    '::ffff:192.0.2.1',
  ])('refuses the bind %j (not one strict IPv4 literal)', (bind) => {
    const fx = fixture();
    const r = up(fx, { GELDAR_MC_BIND: bind, GELDAR_MC_PORT: '25999' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('GELDAR_MC_BIND must be one IPv4 literal');
    expect(composeCalls(fx).some((c) => / (pull|up)\b/.test(c))).toBe(false);
  });

  it.each([
    ['0', 'between 1 and 65535'],
    ['65536', 'between 1 and 65535'],
    ['999999', 'between 1 and 65535'],
    ['25565', '25565 or 25566'],
    ['25566', '25565 or 25566'],
  ])('refuses the port %s', (port, msg) => {
    const fx = fixture();
    const r = up(fx, { GELDAR_MC_BIND: '192.0.2.10', GELDAR_MC_PORT: port });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(msg);
    expect(composeCalls(fx).some((c) => / (pull|up)\b/.test(c))).toBe(false);
  });

  it.each(['1', '65535', '25999'])('accepts the port %s', (port) => {
    const r = up(fixture(), { GELDAR_MC_BIND: '192.0.2.10', GELDAR_MC_PORT: port });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`192.0.2.10:${port}`);
  });

  it('a failing healthy up publishes nothing: the overlay is never merged', () => {
    const fx = fixture();
    const shim = join(dirname(fx.env.DOCKER_CALLS_LOG as string), 'bin', 'docker');
    writeFileSync(
      shim,
      `${DOCKER_SHIM.replace('exit 0\n', '')}case "$*" in *"up -d --wait"*) [ -f "$DOCKER_CALLS_LOG.x" ] && exit 1; : > "$DOCKER_CALLS_LOG.x" ;; esac\nexit 0\n`,
    );
    // The first up (postgres, nats) passes; every later up is refused, so the stack never turns healthy.
    const r = up(fx, { GELDAR_MC_BIND: '192.0.2.10', GELDAR_MC_PORT: '25999' });
    expect(r.code).not.toBe(0);
    for (const c of composeCalls(fx)) expect(c).not.toContain('colo-public.yml');
    expect(r.out).not.toContain('public Minecraft port published');
  });

  it('does not write state/release.commit (the record is current.env and previous.env)', () => {
    const fx = fixture();
    expect(up(fx).code).toBe(0);
    const state = fx.env.GELDAR_STATE_DIR as string;
    expect(existsSync(join(state, 'current.env'))).toBe(true);
    expect(existsSync(join(state, 'release.commit'))).toBe(false);
  });
});

describe('Glass secret, login step and image', () => {
  it('the glass password file is required: a missing postgres-glass.txt stops the deploy', () => {
    const fx = fixture({ skipSecret: 'postgres-glass.txt' });
    const r = up(fx);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('secret file missing: postgres-glass.txt');
    expect(composeCalls(fx).some((c) => / (pull|up)\b/.test(c))).toBe(false);
  });

  it('sets the geldar_glass login after geldar_mcp and before the full core', () => {
    const fx = fixture();
    expect(up(fx).code).toBe(0);
    const log = composeCalls(fx);
    const at = (re: RegExp) => log.findIndex((c) => re.test(c));
    const mcp = at(/set-role-password geldar_mcp /);
    const glass = at(
      /set-role-password geldar_glass --password-file \/run\/secrets\/postgres-glass\.txt$/,
    );
    const full = at(/ up -d --wait$/);
    expect(mcp).toBeGreaterThanOrEqual(0);
    expect(glass).toBeGreaterThan(mcp);
    expect(full).toBeGreaterThan(glass);
  });

  it('refuses a manifest with no GELDAR_GLASS_IMAGE, before any compose pull', () => {
    const fx = fixture({ manifest: MANIFEST });
    const r = up(fx);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('no GELDAR_GLASS_IMAGE');
    expect(composeCalls(fx).some((c) => / (pull|up)\b/.test(c))).toBe(false);
  });

  it.each([
    ['a tag', 'GELDAR_GLASS_IMAGE=registry.example.invalid/geldar/glass:1.2'],
    ['latest', 'GELDAR_GLASS_IMAGE=registry.example.invalid/geldar/glass:latest'],
    ['a short digest', 'GELDAR_GLASS_IMAGE=registry.example.invalid/geldar/glass@sha256:abc'],
  ])('refuses a GELDAR_GLASS_IMAGE that is %s', (_n, line) => {
    const fx = fixture({ manifest: [...MANIFEST, line] });
    const r = up(fx);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/GELDAR_GLASS_IMAGE (is not a digest reference|uses the latest tag)/);
    expect(composeCalls(fx).some((c) => / (pull|up)\b/.test(c))).toBe(false);
  });
});

describe('colo network subnet (R32)', () => {
  it('pins the colo bridge to a /24 taken from GELDAR_COLO_SUBNET, no private literal', () => {
    const text = readFileSync(join(ROOT, 'compose', 'colo.yml'), 'utf8');
    const net = text.slice(text.indexOf('\nnetworks:'), text.indexOf('\nsecrets:'));
    expect(net).toContain('subnet: "${GELDAR_COLO_SUBNET:-');
  });
});
