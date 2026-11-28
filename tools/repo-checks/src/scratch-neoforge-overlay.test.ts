/**
 * The NeoForge scratch variant (suffix nf): its overlay (compose/opt-in/scratch-neoforge.yml), its entrypoint
 * (compose/neoforge/neoforge-entrypoint.sh) and its port file (deploy/scratch/nf.env). The overlay is parsed with the
 * yaml package, the !override tag as a custom tag. The script's behaviour under sh is in scratch-neoforge-script.test.ts.
 * Nothing here starts a container.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CollectionTag, parse } from 'yaml';
import { skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, 'utf8');
const NF_TEXT = read('compose/opt-in/scratch-neoforge.yml');
const SCRATCH_TEXT = read('compose/opt-in/scratch.yml');
const ENTRY_TEXT = read('compose/neoforge/neoforge-entrypoint.sh');
const NF_ENV_TEXT = read('deploy/scratch/nf.env');
const TELEMETRY_TEXT = read('deploy/scratch/telemetry.env');

/** compose replaces the list under !override instead of appending to it; the parsed value is marked. */
const OVERRIDE: CollectionTag = {
  tag: '!override',
  collection: 'seq',
  resolve: (node: unknown) => ({ override: true, items: (node as { toJSON(): unknown }).toJSON() }),
};

interface Tagged {
  override: boolean;
  items: string[];
}
interface NfPaper {
  environment: Record<string, string>;
  entrypoint: Tagged;
  volumes: Tagged;
  ports: Tagged;
  healthcheck: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period: string;
  };
  deploy?: unknown;
  memswap_limit?: unknown;
}
interface ScratchPaper {
  ports?: Tagged | string[];
  deploy: { resources: { limits: { memory: string; cpus: string } } };
  memswap_limit: string;
  restart: string;
  labels: Record<string, string>;
}

const NF = parse(NF_TEXT, { customTags: [OVERRIDE] }) as { services: Record<string, unknown> };
const SCRATCH = parse(SCRATCH_TEXT, { customTags: [OVERRIDE] }) as {
  services: Record<string, ScratchPaper>;
};
const paper = NF.services.paper as NfPaper;
const NEOFORGE_BUILD = ['26', '1', '2', '126'].join('.');

/** The scratch.yml defaults of the four SCRATCH_*_PORT keys, read from the overlay text. */
const SCRATCH_DEFAULTS = Object.fromEntries(
  [...SCRATCH_TEXT.matchAll(/(SCRATCH_\w+_PORT):-(\d+)/g)].map((m) => [m[1], Number(m[2])]),
);
const NF_RCON_DEFAULT = Number(/SCRATCH_RCON_PORT:-(\d+)/.exec(NF_TEXT)?.[1]);

describe('NeoForge overlay: the service', () => {
  it('changes only the paper service', () => {
    expect(Object.keys(NF.services)).toEqual(['paper']);
  });

  it('runs NeoForge at the pinned version, never latest or a range', () => {
    expect(paper.environment.TYPE).toBe('NEOFORGE');
    // The template is 26.1.2 plus a build default; the default must be the pinned build 126, never another value or latest.
    const version = paper.environment.NEOFORGE_VERSION;
    if (version === undefined) throw new Error('the overlay sets no NEOFORGE_VERSION');
    const match = /^26\.1\.2\.\$\{SCRATCH_NEOFORGE_BUILD:-(\d+)\}$/.exec(version);
    expect(match?.[1]).toBe('126');
    expect(['26', '1', '2', match?.[1] ?? ''].join('.')).toBe(NEOFORGE_BUILD);
    expect(paper.environment.NEOFORGE_VERSION).not.toMatch(/latest/i);
    expect(NF_TEXT).not.toMatch(/latest/i);
  });

  it('replaces the entrypoint with the NeoForge script', () => {
    expect(paper.entrypoint).toEqual({
      override: true,
      items: ['/bin/sh', '/geldar/neoforge-entrypoint.sh'],
    });
  });

  it('mounts the world volume and the NeoForge entrypoint only, never geldar-core', () => {
    expect(paper.volumes).toEqual({
      override: true,
      items: [
        'paper-data:/data',
        './neoforge/neoforge-entrypoint.sh:/geldar/neoforge-entrypoint.sh:ro',
      ],
    });
  });

  it('publishes RCON only on 127.0.0.1 with the run port, and no game port', () => {
    expect(paper.ports).toEqual({
      override: true,
      items: [`127.0.0.1:\${SCRATCH_RCON_PORT:-35575}:25575`],
    });
    for (const mapping of paper.ports.items) expect(mapping.startsWith('127.0.0.1:')).toBe(true);
    expect(NF_TEXT).not.toMatch(/0\.0\.0\.0|\[::\]/);
    expect(paper.ports.items.join(' ')).not.toMatch(/25565/);
  });

  it('checks health with mc-health alone, with a 15 minute start period', () => {
    expect(paper.healthcheck).toEqual({
      test: ['CMD-SHELL', 'mc-health'],
      interval: '30s',
      timeout: '10s',
      retries: 5,
      start_period: '15m',
    });
  });

  it('sets no container name and no caps of its own', () => {
    expect(NF_TEXT).not.toMatch(/container_name/);
    expect(paper.deploy).toBeUndefined();
    expect(paper.memswap_limit).toBeUndefined();
  });

  it('leaves the merged paper caps at scratch.yml values: 3072m, 1.5 CPUs, no swap, restart no', () => {
    const base = SCRATCH.services.paper;
    expect(base?.deploy.resources.limits).toEqual({ memory: '3072m', cpus: '1.5' });
    expect(base?.memswap_limit).toBe('3072m');
    expect(base?.restart).toBe('no');
    expect(base?.labels['geldar.scratch']).toBe('true');
  });

  it('keeps the NeoForge RCON default equal to the base overlay default, and never names the live secrets', () => {
    expect(NF_RCON_DEFAULT).toBe(35575);
    expect(SCRATCH_DEFAULTS.SCRATCH_RCON_PORT).toBe(NF_RCON_DEFAULT);
    expect(NF_TEXT).not.toMatch(/compose\/secrets/);
  });
});

describe('NeoForge entrypoint script', () => {
  const lines = ENTRY_TEXT.split('\n');

  it('pins the mod by URL and sha512', () => {
    expect(ENTRY_TEXT).toContain(
      'https://cdn.modrinth.com/data/vDyrHl8l/versions/qiZ49HIW/proxy-compatible-forge-1.3.1.jar',
    );
    expect(ENTRY_TEXT).toMatch(/MOD_SHA512=\$\{GELDAR_NF_MOD_SHA512:-dba5b70f[0-9a-f]{120}\}/);
  });

  it('builds the installer URL from NEOFORGE_VERSION and never writes the build number out', () => {
    expect(ENTRY_TEXT).toMatch(
      /INSTALLER_URL="\$\{GELDAR_NF_INSTALLER_URL:-https:\/\/maven\.neoforged\.net\/releases\/net\/neoforged\/neoforge\/\$\{NEOFORGE_VERSION\}\/neoforge-\$\{NEOFORGE_VERSION\}-installer\.jar\}"/,
    );
    expect(ENTRY_TEXT).not.toContain(NEOFORGE_BUILD);
  });

  it('guards NEOFORGE_VERSION to the 26.1.2 line before anything is fetched', () => {
    expect(ENTRY_TEXT).toContain("grep -Eq '^26\\.1\\.2\\.[0-9]+$'");
    expect(ENTRY_TEXT.indexOf('grep -Eq')).toBeLessThan(ENTRY_TEXT.indexOf('fetch "$MOD_URL"'));
  });

  it('pins the installer sha256, which refuses any other build', () => {
    expect(ENTRY_TEXT).toMatch(
      /INSTALLER_SHA256=\$\{GELDAR_NF_INSTALLER_SHA256:-1184ffee[0-9a-f]{56}\}/,
    );
    expect(ENTRY_TEXT).toMatch(
      /fetch "\$INSTALLER_URL" "\$installer" "\$INSTALLER_SHA256" sha256sum/,
    );
  });

  it.skipIf(skipWithoutSh())(
    'exits 1 before any download when NEOFORGE_VERSION is unset or not 26.1.2 build N',
    // Five sh starts: under load one start can pass vitest's 5 s default, so this test gets its own budget.
    { timeout: 30_000 },
    () => {
      for (const version of [
        undefined,
        '',
        ['26', '1', '3', '1'].join('.'),
        '26.1.2.x',
        `${NEOFORGE_BUILD}; rm -rf /`,
      ]) {
        const env: Record<string, string> = {
          PATH: process.env.PATH ?? '',
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        };
        if (version !== undefined) env.NEOFORGE_VERSION = version;
        const run = spawnSync('sh', [slash(`${ROOT}compose/neoforge/neoforge-entrypoint.sh`)], {
          encoding: 'utf8',
          env,
        });
        expect(run.status, `version ${JSON.stringify(version)}`).toBe(1);
        expect(run.stderr).toContain('NEOFORGE_VERSION is unset or not 26.1.2 build N');
      }
    },
  );

  it('checks the mod with sha512sum and fails closed: a mismatch is deleted and exits 1', () => {
    expect(ENTRY_TEXT).toMatch(/fetch\(\) \{/);
    expect(ENTRY_TEXT).toMatch(/fetch "\$MOD_URL" "\$mod" "\$MOD_SHA512" sha512sum/);
    expect(ENTRY_TEXT).toMatch(
      /if ! printf '%s {2}%s\\n' "\$3" "\$2\.part" \| "\$4" -c --status; then/,
    );
    expect(ENTRY_TEXT).toMatch(/rm -f "\$2\.part" "\$2"\n\s+echo [^\n]*\n\s+exit 1/);
  });

  it('installs NeoForge from the verified local installer, not by version alone', () => {
    expect(ENTRY_TEXT).toMatch(/export NEOFORGE_INSTALLER="\$installer"/);
    expect(ENTRY_TEXT).toMatch(
      /fetch "\$INSTALLER_URL" "\$installer" "\$INSTALLER_SHA256" sha256sum/,
    );
  });

  it('never echoes the secret value (echo lines may name the file only)', () => {
    const leaks = lines.filter((l) => /echo/.test(l) && /\$\{?secret\}?(?![\w])/.test(l));
    expect(leaks).toEqual([]);
  });

  it('reads the secret from /run/secrets only, with the paper entrypoint checks', () => {
    expect(ENTRY_TEXT).toMatch(
      /secret_file=\$\{GELDAR_NF_SECRET_FILE:-\/run\/secrets\/velocity-forwarding\}/,
    );
    expect(ENTRY_TEXT).toMatch(/\*\[!a-zA-Z0-9_-\]\*\)/);
    expect(ENTRY_TEXT).toMatch(/umask 077/);
  });

  it('writes the PCF config from its README layout, rewrites it each start with the secret in the environment, keeps a .bak and guards the result', () => {
    // (a) the first-start file under the data dir, from the README layout
    expect(ENTRY_TEXT).toMatch(/data=\$\{GELDAR_NF_DATA_DIR:-\/data\}/);
    expect(ENTRY_TEXT).toMatch(
      /config=\$\{GELDAR_NF_CONFIG:-\$data\/config\/proxy-compatible-forge\.toml\}/,
    );
    expect(ENTRY_TEXT).toContain("echo '[forwarding]'");
    expect(ENTRY_TEXT).toContain("echo 'enabled = true'");
    expect(ENTRY_TEXT).toContain('echo \'mode = "MODERN"\'');
    expect(ENTRY_TEXT).toContain('printf \'secret = "%s"\\n\' "$secret"');
    expect(ENTRY_TEXT).toContain('echo \'modernForwardingVersion = "NO_OVERRIDE"\'');
    // (b) the secret reaches awk in its environment, never on an awk command line (argv leaks in ps)
    expect(ENTRY_TEXT).not.toMatch(/awk\s+-v\s+secret=/);
    const argvLeaks = lines.filter(
      (l) =>
        /awk/.test(l) &&
        /"\$\{?secret\}?"/.test(l) &&
        !/NF_PCF_SECRET="\$secret" (LC_ALL=C )?awk/.test(l),
    );
    expect(argvLeaks).toEqual([]);
    expect(ENTRY_TEXT).toMatch(/NF_PCF_SECRET="\$secret" awk '/);
    expect(ENTRY_TEXT).toContain('ENVIRON["NF_PCF_SECRET"]');
    // (c) the previous file is kept as .bak, and the section-scoped guard checks the result after the rewrite
    expect(ENTRY_TEXT).toContain('cp "$config" "$config.bak"');
    expect(ENTRY_TEXT).toMatch(/chmod 600 "\$config\.bak"/);
    expect(ENTRY_TEXT).toMatch(/inforwarding && \$0 == "enabled = true"/);
    expect(ENTRY_TEXT).toContain('if ! NF_PCF_SECRET="$secret" awk \'');
    expect(ENTRY_TEXT).toContain(
      'does not hold MODERN forwarding with the current secret after the rewrite',
    );
    expect(ENTRY_TEXT).toMatch(/chmod 600 "\$config"/);
  });

  it('writes no Paper config and no spark config, and ends by starting the image script', () => {
    expect(ENTRY_TEXT).not.toMatch(/online-mode|paper-global|spark/);
    expect(ENTRY_TEXT).toMatch(/\nexec "\$\{GELDAR_NF_START:-\/image\/scripts\/start\}" "\$@"\n$/);
  });

  it('is LF only and under the 500-line soft cap', () => {
    expect(ENTRY_TEXT).not.toMatch(/\r/);
    expect(lines.length).toBeLessThan(500);
  });
});

describe('nf.env: the port block of scratch-nf', () => {
  const pairs = NF_ENV_TEXT.split('\n')
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map((l) => l.split('=') as [string, string]);
  const env = Object.fromEntries(pairs);

  it('has exactly the six allowed keys, with the table values', () => {
    expect(pairs.map(([k]) => k)).toEqual([
      'SCRATCH_PG_PORT',
      'SCRATCH_NATS_PORT',
      'SCRATCH_NATS_MON_PORT',
      'SCRATCH_MC_PORT',
      'SCRATCH_RCON_PORT',
      'SCRATCH_HUMAN_PORT',
    ]);
    expect(env).toEqual({
      SCRATCH_PG_PORT: '35432',
      SCRATCH_NATS_PORT: '34222',
      SCRATCH_NATS_MON_PORT: '38222',
      SCRATCH_MC_PORT: '55565',
      SCRATCH_RCON_PORT: '55575',
      SCRATCH_HUMAN_PORT: '55566',
    });
  });

  it('has digits only, in 1 to 65535', () => {
    for (const [, value] of pairs) {
      expect(value).toMatch(/^\d+$/);
      expect(Number(value)).toBeGreaterThanOrEqual(1);
      expect(Number(value)).toBeLessThanOrEqual(65535);
    }
  });

  it('is the scratch-a default plus 20000 for each key, and differs from telemetry.env', () => {
    for (const key of [
      'SCRATCH_PG_PORT',
      'SCRATCH_NATS_PORT',
      'SCRATCH_NATS_MON_PORT',
      'SCRATCH_MC_PORT',
    ]) {
      expect(Number(env[key])).toBe((SCRATCH_DEFAULTS[key] ?? NaN) + 20000);
    }
    expect(Number(env.SCRATCH_RCON_PORT)).toBe(NF_RCON_DEFAULT + 20000);
    const telemetry = Object.fromEntries(
      TELEMETRY_TEXT.split('\n')
        .filter((l) => l.startsWith('SCRATCH_'))
        .map((l) => l.split('=') as [string, string]),
    );
    for (const [key, value] of pairs) {
      expect(value).not.toBe(telemetry[key]);
    }
  });
});
