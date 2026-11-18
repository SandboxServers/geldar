/**
 * The BlueMap web overlay of the live NeoForge project (compose/nf-live-bluemap-web.yml): the bluemap-web-nf service, a
 * read-only Caddy that serves the NeoForge BlueMap tiles on loopback port 8110. It is rendered alone (ci.yml and
 * geldar.ps1 render every compose file with no environment) and merged with compose/nf-live.yml. Nothing here starts a
 * container; the Caddyfile and the README snippet of compose/bluemap-web-nf/ are the BlueMap team's and are only read.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY = 'compose/nf-live-bluemap-web.yml';
const NF = 'compose/nf-live.yml';
const SERVICE = 'bluemap-web-nf';
const OVERLAY_TEXT = readFileSync(`${ROOT}${OVERLAY}`, 'utf8');
const README = readFileSync(`${ROOT}compose/bluemap-web-nf/README.md`, 'utf8');
/** The digest pin of the BlueMap team's snippet: the overlay must use exactly this image. */
const SNIPPET_IMAGE = /image: (caddy@sha256:[0-9a-f]{64})/.exec(README)?.[1];
const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

/** Skips the render tests when docker compose is missing; in CI a missing docker fails the run instead. */
if (!DOCKER && process.env.CI)
  throw new Error(
    'docker compose is not on PATH and CI is set: the BlueMap overlay render tests must run',
  );

interface Svc {
  image?: string;
  user?: string;
  read_only?: boolean;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  tmpfs?: string[];
  networks?: Record<string, unknown>;
  ports?: { host_ip?: string; published?: string; target?: number }[];
  volumes?: Record<string, unknown>[];
  secrets?: unknown;
  depends_on?: unknown;
  env_file?: unknown;
  restart?: string;
  environment?: Record<string, string>;
  labels?: Record<string, string>;
  logging?: { driver?: string };
  memswap_limit?: string;
  pids_limit?: unknown;
  mem_limit?: unknown;
  cpus?: unknown;
  deploy?: { resources?: { limits?: { cpus?: number; memory?: string; pids?: number } } };
}
interface Rendered {
  name?: string;
  services: Record<string, Svc>;
  networks?: Record<string, unknown>;
  volumes?: Record<string, { name?: string }>;
  secrets?: Record<string, unknown>;
}
interface Run {
  status: number | null;
  doc: Rendered | undefined;
}

/** `docker compose -f <files> config --format json` with no NF_ variable set, plus any extra variables. */
function render(files: string[], extra: Record<string, string> = {}): Run {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('NF_')) delete env[key];
  Object.assign(env, extra);
  const run = spawnSync(
    'docker',
    ['compose', ...files.flatMap((f) => ['-f', f]), 'config', '--format', 'json'],
    { cwd: ROOT, encoding: 'utf8', env },
  );
  return {
    status: run.status,
    doc: run.status === 0 ? (JSON.parse(run.stdout) as Rendered) : undefined,
  };
}

describe('the BlueMap web overlay (text)', () => {
  it('uses exactly the digest-pinned image of the BlueMap team snippet', () => {
    expect(SNIPPET_IMAGE).toBeDefined();
    expect(OVERLAY_TEXT).toContain(`image: ${SNIPPET_IMAGE}`);
    expect(OVERLAY_TEXT).not.toMatch(/image: caddy(:|\s|$)/m);
  });

  it('names 8110 in no other compose file, so the loopback port is unique', () => {
    const others = readdirSync(`${ROOT}compose`)
      .filter((f) => /\.ya?ml$/.test(f) && `compose/${f}` !== OVERLAY)
      .filter((f) => readFileSync(`${ROOT}compose/${f}`, 'utf8').includes('8110'));
    expect(others).toEqual([]);
  });
});

describe.skipIf(!DOCKER)('the BlueMap web overlay rendered by docker compose', () => {
  let alone: Run;
  let merged: Run;
  let base: Run;
  let uidOnly: Run;
  let uidAndGid: Run;

  beforeAll(() => {
    alone = render([OVERLAY]);
    merged = render([NF, OVERLAY]);
    base = render([NF]);
    uidOnly = render([OVERLAY], { NF_SERVICE_UID: '1001' });
    uidAndGid = render([OVERLAY], { NF_SERVICE_UID: '1001', NF_SERVICE_GID: '1002' });
  }, 120_000);

  const svc = () => alone.doc?.services[SERVICE] ?? ({} as Svc);

  it('renders alone with no environment, and merged with nf-live.yml', () => {
    expect(alone.status).toBe(0);
    expect(merged.status).toBe(0);
  });

  it('has exactly one service, bluemap-web-nf, when rendered alone', () => {
    expect(Object.keys(alone.doc?.services ?? {})).toEqual([SERVICE]);
  });

  it('merged, adds only bluemap-web-nf to the nf-live.yml services', () => {
    const baseNames = Object.keys(base.doc?.services ?? {}).sort();
    const mergedNames = Object.keys(merged.doc?.services ?? {}).sort();
    expect(mergedNames).toEqual([...baseNames, SERVICE].sort());
  });

  it('has exactly the expected key set', () => {
    expect(Object.keys(svc()).sort()).toEqual(
      [
        'cap_drop',
        'command',
        'deploy',
        'entrypoint',
        'environment',
        'image',
        'labels',
        'logging',
        'memswap_limit',
        'networks',
        'ports',
        'read_only',
        'restart',
        'security_opt',
        'tmpfs',
        'user',
        'volumes',
      ].sort(),
    );
  });

  it('publishes only the literal loopback port 127.0.0.1:8110 to container port 8110', () => {
    const published = (svc().ports ?? []).map((p) => `${p.host_ip}:${p.published}:${p.target}`);
    expect(published).toEqual(['127.0.0.1:8110:8110']);
  });

  it('mounts only the bluemap/web subpath of neoforge-data, read only, at /srv, and the Caddyfile read only', () => {
    expect(svc().volumes).toEqual([
      {
        type: 'volume',
        source: 'neoforge-data',
        target: '/srv',
        read_only: true,
        volume: { subpath: 'bluemap/web' },
      },
      expect.objectContaining({
        type: 'bind',
        target: '/etc/caddy/Caddyfile',
        read_only: true,
      }),
    ]);
    // compose prints the host path of the bind; on Windows it uses backslashes, so the separators are normalised.
    const caddy = (svc().volumes ?? [])[1] as { source?: string } | undefined;
    expect(caddy?.source?.replace(/\\/g, '/').endsWith('compose/bluemap-web-nf/Caddyfile')).toBe(
      true,
    );
  });

  it('never mounts the volume root or /data', () => {
    expect((svc().volumes ?? []).map((v) => v.target)).not.toContain('/data');
    expect((svc().volumes ?? []).filter((v) => v.type === 'volume')).toHaveLength(1);
  });

  it('runs as NF_SERVICE_UID:NF_SERVICE_GID, with the uid as the default gid and 1000 as the default uid', () => {
    expect(svc().user).toBe('1000:1000');
    expect(uidOnly.doc?.services[SERVICE]?.user).toBe('1001:1001');
    expect(uidAndGid.doc?.services[SERVICE]?.user).toBe('1001:1002');
  });

  it('is hardened: read only root, cap_drop ALL with no cap_add, no-new-privileges, a /tmp tmpfs', () => {
    expect(svc().read_only).toBe(true);
    expect(svc().cap_drop).toEqual(['ALL']);
    expect(svc().cap_add).toBeUndefined();
    expect(svc().security_opt).toEqual(['no-new-privileges:true']);
    expect(svc().tmpfs).toEqual(['/tmp']);
    expect(svc().environment).toEqual({
      XDG_CONFIG_HOME: '/tmp/config',
      XDG_DATA_HOME: '/tmp/data',
    });
  });

  it('sets the limits under deploy.resources.limits only: 0.25 CPU, 128 MiB, 64 pids, no swap', () => {
    expect(svc().deploy?.resources?.limits?.cpus).toBe(0.25);
    expect(svc().deploy?.resources?.limits?.memory).toBe('134217728');
    expect(svc().deploy?.resources?.limits?.pids).toBe(64);
    expect(svc().memswap_limit).toBe('134217728');
    expect(svc()).not.toHaveProperty('pids_limit');
    expect(svc()).not.toHaveProperty('mem_limit');
    expect(svc()).not.toHaveProperty('cpus');
  });

  it('restarts unless-stopped, carries the project label, disables watchtower and uses json-file logging', () => {
    expect(svc().restart).toBe('unless-stopped');
    expect(svc().labels).toMatchObject({
      'geldar.project': 'geldar-nf',
      'com.centurylinklabs.watchtower.enable': 'false',
    });
    expect(svc().logging?.driver).toBe('json-file');
  });

  it('is on its own network only: not nf, and never nf-human', () => {
    expect(Object.keys(svc().networks ?? {})).toEqual(['bluemap-web-nf']);
    const mergedNet = Object.keys(merged.doc?.services[SERVICE]?.networks ?? {});
    expect(mergedNet).toEqual(['bluemap-web-nf']);
    expect(Object.keys(merged.doc?.networks ?? {})).not.toContain('nf-human');
  });

  it('has no secret, no depends_on and no env_file, and no top-level secret', () => {
    expect(svc().secrets).toBeUndefined();
    expect(svc().depends_on).toBeUndefined();
    expect(svc().env_file).toBeUndefined();
    expect(alone.doc?.secrets).toBeUndefined();
  });

  it('declares neoforge-data as the same volume as nf-live.yml, named geldar-nf_neoforge-data after the merge', () => {
    expect(base.doc?.volumes?.['neoforge-data']).toEqual(alone.doc?.volumes?.['neoforge-data']);
    expect(alone.doc?.volumes?.['neoforge-data']?.name).toBe('geldar-nf_neoforge-data');
    expect(merged.doc?.volumes?.['neoforge-data']?.name).toBe('geldar-nf_neoforge-data');
  });

  it('is named geldar-nf, alone and merged', () => {
    expect(alone.doc?.name).toBe('geldar-nf');
    expect(merged.doc?.name).toBe('geldar-nf');
  });
});
