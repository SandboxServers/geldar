import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// G2 (collector-design sections 11 and 12): the NATS exporter overlay, the gateway's nats and postgresql scrapes, and the Postgres
// monitoring role. The static checks read the files. The render test merges the overlay onto compose/colo.yml with
// `docker compose config`, and runs only where docker is installed (CI must have it).

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY = 'compose/opt-in/colo-nats-exporter.yml';
const GATEWAY = 'deploy/telemetry/gateway.yaml';
const SQL = 'deploy/telemetry/postgres-monitor.sql';
const RUNBOOK = 'docs/runbooks/telemetry-monitors.md';
const README = 'deploy/telemetry/README.md';
const EXPORTER_IMAGE =
  'natsio/prometheus-nats-exporter:0.20.3@sha256:4b8ddc1c86fec360b5cd3d5e1fbc6fb52bdafd5805bba3901cc52926538af255';
const EXPORTER_PORT = '7777';
const MONITOR_URL = 'http://127.0.0.1:8222';
const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
/**
 * The exporter start command: the deploy's overlay set (deploy/common.sh, dc: colo.yml, nats-auth.yml, compose.secrets.yml, then the
 * extra overlay) and --no-deps, so compose converges only the exporter and never nats.
 */
const DEPLOY_CMD =
  'docker compose -p "$' +
  '{GELDAR_PROJECT:-geldar-colo}" -f compose/colo.yml -f compose/nats-auth.yml -f deploy/compose.secrets.yml -f compose/opt-in/colo-nats-exporter.yml up -d --no-deps nats-exporter';
/** The whole role script, statement by statement, in order. Any other statement (a GRANT in particular) fails the exact test. */
const EXPECTED_SQL = [
  'SET log_min_error_statement = panic;',
  '\\if :{?otel_pg_password}',
  '\\else',
  "DO $$ BEGIN RAISE EXCEPTION 'psql variable otel_pg_password is not set, pipe the password in as that variable'; END $$;",
  '\\quit',
  '\\endif',
  "SELECT format('CREATE ROLE geldar_monitor LOGIN') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geldar_monitor') \\gexec",
  "SELECT format('ALTER ROLE geldar_monitor LOGIN PASSWORD %L', :'otel_pg_password') \\gexec",
  'GRANT pg_read_all_stats TO geldar_monitor;',
  'GRANT CONNECT ON DATABASE geldar TO geldar_monitor;',
];

/** The G2 pipeline (node request 08, section 9): the password reaches psql on stdin and never on a command line. Raw, so the quoting is literal. */
const S2_PIPELINE = String.raw`{ printf '\\set otel_pg_password '"'"; sudo -n cat /mnt/nvme/geldar-telemetry/pg-secrets/otel-pg.txt; printf '%s\n' "'"; cat /mnt/nvme/geldar-telemetry/src.new-g2/deploy/telemetry/postgres-monitor.sql; } | docker exec -i geldar-colo-postgres-1 psql -q -v ON_ERROR_STOP=1 -U geldar -d geldar`;
/** Every document that shows the S2 pipeline: the brief, the runbook and the one-page copy for ops. */
const S2_DOCS = [
  'docs/analysis/telemetry/node-requests/08-monitors-g2.md',
  RUNBOOK,
  'docs/analysis/telemetry/node-requests/08-s2-pipeline.md',
];

/** Skips the render test without docker; in CI a missing docker fails the run instead. */
if (!DOCKER && process.env.CI)
  throw new Error(
    'docker compose is not on PATH and CI is set: the NATS exporter render test must run',
  );

type Overlay = {
  services?: Record<
    string,
    {
      image?: string;
      network_mode?: string;
      command?: string[];
      ports?: unknown;
      networks?: unknown;
      deploy?: { resources?: { limits?: { cpus?: unknown; memory?: unknown; pids?: unknown } } };
      memswap_limit?: unknown;
      pids_limit?: unknown;
      restart?: string;
    }
  >;
};

const readText = (rel: string) => readFileSync(`${ROOT}${rel}`, 'utf8');
/** The SQL with its comment lines removed, so a word in a comment never counts as a statement. */
const sqlCode = () =>
  readText(SQL)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
/** The non-comment, non-empty lines of the SQL, trimmed, in file order. */
const sqlStatements = () =>
  sqlCode()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** The exporter's flag list, joined, so checks read the flags as the container gets them. */
function exporterCommand(doc: Overlay): string {
  return (doc.services?.['nats-exporter']?.command ?? []).join(' ');
}

describe('compose/opt-in/colo-nats-exporter.yml (G2, T-09)', () => {
  const doc = parse(readText(OVERLAY)) as Overlay;
  const svc = doc.services?.['nats-exporter'];

  it('defines only the nats-exporter service, in the NATS network namespace', () => {
    expect(Object.keys(doc.services ?? {})).toEqual(['nats-exporter']);
    expect(svc?.network_mode).toBe('service:nats');
    expect(svc?.networks).toBeUndefined();
  });

  it('publishes no port, neither for the exporter nor for the NATS monitor', () => {
    expect(svc?.ports).toBeUndefined();
    expect(readText(OVERLAY)).not.toMatch(/^\s*ports:/m);
  });

  it('pins the exporter image by digest at 0.20.3', () => {
    expect(svc?.image).toBe(EXPORTER_IMAGE);
  });

  it('has its caps: 0.1 CPU, 64m memory and swap, 64 pids', () => {
    expect(svc?.deploy?.resources?.limits?.cpus).toBe('0.1');
    expect(svc?.deploy?.resources?.limits?.memory).toBe('64m');
    expect(svc?.deploy?.resources?.limits?.pids).toBe(64);
    expect(svc?.memswap_limit).toBe('64m');
    expect(svc?.pids_limit).toBe(64);
  });

  it('reads only /varz and /jsz from the monitor', () => {
    const command = exporterCommand(doc);
    expect(command).toContain('-varz');
    expect(command).toContain('-jsz');
    expect(command).toContain(MONITOR_URL);
    expect(command).not.toMatch(/subsz|connz|routez|gatewayz|leafz|accstatz/i);
  });

  it('serves on the port the gateway scrapes', () => {
    const command = exporterCommand(doc);
    expect(command).toContain(`-port ${EXPORTER_PORT}`);
    const gateway = parse(readText(GATEWAY)) as {
      receivers: {
        prometheus: {
          config: {
            scrape_configs: { job_name: string; static_configs: { targets: string[] }[] }[];
          };
        };
      };
    };
    const job = gateway.receivers.prometheus.config.scrape_configs.find(
      (j) => j.job_name === 'nats',
    );
    expect(job?.static_configs[0]?.targets).toEqual([`nats:${EXPORTER_PORT}`]);
  });

  it('restarts unless stopped', () => {
    expect(svc?.restart).toBe('unless-stopped');
  });

  it('is started with the deploy overlay set and --no-deps, in its header and in the runbook', () => {
    expect(readText(OVERLAY)).toContain(DEPLOY_CMD);
    expect(readText(RUNBOOK)).toContain(DEPLOY_CMD);
  });

  it.skipIf(!DOCKER)(
    'renders merged onto the deploy overlay set (colo.yml, nats-auth.yml, compose.secrets.yml) with the same caps, no ports and the same command',
    () => {
      const result = spawnSync(
        'docker',
        [
          'compose',
          '-f',
          'compose/colo.yml',
          '-f',
          'compose/nats-auth.yml',
          '-f',
          'deploy/compose.secrets.yml',
          '-f',
          OVERLAY,
          'config',
          '--format',
          'json',
        ],
        {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, GELDAR_SECRETS_DIR: '/render-only/secrets' },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const rendered = JSON.parse(result.stdout) as {
        services: Record<
          string,
          { network_mode?: string; ports?: unknown; pids_limit?: unknown; command?: string[] }
        >;
      };
      const exporter = rendered.services['nats-exporter'];
      expect(exporter?.network_mode).toBe('service:nats');
      expect(exporter?.ports).toBeUndefined();
      expect(exporter?.pids_limit).toBe(64);
      expect(exporter?.command).toEqual(svc?.command);
    },
  );
});

describe('docs/runbooks/telemetry-monitors.md (G2)', () => {
  const runbook = readText(RUNBOOK);

  it('never starts the exporter without --no-deps', () => {
    expect(runbook).not.toMatch(/up -d (?!--no-deps)nats-exporter/);
  });

  it('says the exporter needs --no-deps and the deploy overlay set, and that it is not run any other way', () => {
    expect(runbook).toContain('--no-deps');
    expect(runbook).toContain(DEPLOY_CMD);
  });

  it('restarts nats-exporter after any nats recreate', () => {
    expect(runbook).toMatch(/restart[^\n]*nats-exporter/);
  });

  it('gives the secret file in GELDAR_SECRETS_DIR, with the owner and mode the gateway user reads', () => {
    expect(runbook).toContain('$GELDAR_SECRETS_DIR/otel-pg.txt');
    expect(runbook).toMatch(/10001:10001/);
    expect(runbook).toMatch(/0400/);
    // Owner option (a): the secret lives in the telemetry secrets directory, never the colo one or a bare placeholder name.
    // The directory the orchestrator named (request 08, section 6): the literal path, and no placeholder left in the runbook.
    expect(runbook).toContain(
      'GELDAR_SECRETS_DIR=/mnt/nvme/geldar-telemetry/pg-secrets docker compose',
    );
    expect(runbook).not.toMatch(/<[A-Z][A-Z_]*>/);
    expect(runbook).not.toContain('<the node secrets directory>');
  });

  it('validates the gateway config before the restage, with the password secret mounted', () => {
    expect(runbook).toContain('validate --config=/etc/otelcol/gateway.yaml');
    expect(runbook).toContain('/run/secrets/otel-pg.txt:ro');
  });

  it('states that /jsz is reachable on nats:7777 from the colo network and is accepted for now', () => {
    expect(runbook).toMatch(/nats:7777[^\n]*\/jsz|\/jsz[^\n]*nats:7777/);
    expect(runbook).toMatch(/accepted for now/i);
  });
});

describe('node request 08 and the runbook name the real colo containers (G2)', () => {
  const BRIEF_08 = 'docs/analysis/telemetry/node-requests/08-monitors-g2.md';
  // Node, 2026-11-20: the colo NATS container is geldar-colo-nats-1 (compose service nats); the exporter is geldar-colo-nats-exporter-1.
  // A docker inspect, stats, port, logs or exec argument must name the container, so a bare `nats` or `nats-exporter` there is wrong.
  const CONTAINER_CMD = /docker (inspect|stats|port|logs|exec)\b/;
  const BARE_NAME = /^[`'"]?(nats|nats-exporter)[`'"]?$/;

  it('names no bare nats or nats-exporter as the container in a docker command of request 08', () => {
    const offenders = readText(BRIEF_08)
      .split('\n')
      .filter((line) => CONTAINER_CMD.test(line))
      .filter((line) => line.split(/\s+/).some((token) => BARE_NAME.test(token)));
    expect(offenders).toEqual([]);
  });

  it('names the verified colo containers in request 08 and in the runbook', () => {
    for (const doc of [readText(BRIEF_08), readText(RUNBOOK)]) {
      expect(doc).toContain('geldar-colo-nats-1');
      expect(doc).toContain('geldar-colo-nats-exporter-1');
    }
  });

  it('says the exporter covers the colo NATS only, and the NeoForge NATS has no exporter', () => {
    for (const doc of [readText(BRIEF_08), readText(RUNBOOK)]) {
      expect(doc).toContain('geldar-nf-nats-1');
      expect(doc).toMatch(/NeoForge[^\n]*no exporter/);
    }
  });
});

describe('deploy/telemetry/README.md (G2)', () => {
  it('no longer calls the postgresql receiver a commented placeholder', () => {
    expect(readText(README)).not.toMatch(/postgresql[^\n]*placeholder/i);
  });
});

describe('deploy/telemetry/gateway.yaml (G2)', () => {
  const gateway = parse(readText(GATEWAY)) as {
    receivers: {
      postgresql?: {
        endpoint?: string;
        username?: string;
        password?: string;
        databases?: string[];
      };
    };
    service: { pipelines: { metrics: { receivers: string[] } } };
  };
  const pg = gateway.receivers.postgresql;

  it('adds the postgresql receiver to the metrics pipeline', () => {
    expect(gateway.service.pipelines.metrics.receivers).toEqual([
      'otlp',
      'prometheus',
      'postgresql',
    ]);
  });

  it('connects as the monitoring role to the colo database', () => {
    expect(pg?.endpoint).toBe('postgres:5432');
    expect(pg?.username).toBe('geldar_monitor');
    expect(pg?.databases).toEqual(['geldar']);
  });

  it('takes the password from a secret file, never a literal', () => {
    // Concatenated: a literal `${` in one string trips biome's noTemplateCurlyInString.
    expect(pg?.password).toBe(`$` + '{file:/run/secrets/otel-pg.txt}');
  });
});

describe('deploy/telemetry/compose.gateway.yml secret mount (G2)', () => {
  const compose = parse(readText('deploy/telemetry/compose.gateway.yml')) as {
    services: Record<string, { secrets?: { source?: string; target?: string }[] }>;
    secrets?: Record<string, { file?: string }>;
  };

  it('mounts the otel-pg secret into geldar-gateway at /run/secrets/otel-pg.txt', () => {
    const mounts = compose.services['geldar-gateway']?.secrets ?? [];
    expect(mounts).toContainEqual({ source: 'otel-pg', target: 'otel-pg.txt' });
  });

  it('takes the secret file from GELDAR_SECRETS_DIR with no default, so an unset variable refuses to render', () => {
    const file = compose.secrets?.['otel-pg']?.file ?? '';
    expect(file).toBe(
      '$' +
        '{GELDAR_SECRETS_DIR:?set GELDAR_SECRETS_DIR to the telemetry pg-secrets directory}/otel-pg.txt',
    );
  });
});

describe('deploy/telemetry compose render without the secrets variable (G2)', () => {
  const RENDER = [
    'compose',
    '-f',
    'deploy/telemetry/compose.yml',
    '-f',
    'deploy/telemetry/compose.gateway.yml',
    'config',
    '--quiet',
  ];
  const render = (secretsDir?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GELDAR_SECRETS_DIR;
    if (secretsDir !== undefined) env.GELDAR_SECRETS_DIR = secretsDir;
    return spawnSync('docker', RENDER, { cwd: ROOT, encoding: 'utf8', env });
  };

  it.skipIf(!DOCKER)(
    'refuses to render the gateway overlay when GELDAR_SECRETS_DIR is unset',
    () => {
      const result = render();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'set GELDAR_SECRETS_DIR to the telemetry pg-secrets directory',
      );
    },
  );

  it.skipIf(!DOCKER)(
    'renders when GELDAR_SECRETS_DIR names a directory holding otel-pg.txt',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'geldar-pg-secrets-'));
      try {
        writeFileSync(join(dir, 'otel-pg.txt'), '');
        const result = render(dir);
        expect(result.status, result.stderr).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('deploy/telemetry/postgres-monitor.sql (G2, T-10)', () => {
  it('has no password literal: the password comes from the psql variable', () => {
    expect(sqlCode()).not.toMatch(/PASSWORD\s+'/i);
    expect(sqlCode()).toContain(":'otel_pg_password'");
  });

  it('takes the password from the preset psql variable, and stops when it is not set', () => {
    expect(sqlCode()).toContain('\\if :{?otel_pg_password}');
    expect(sqlCode()).toContain('\\quit');
    expect(sqlCode()).not.toMatch(/\\set\s+otel_pg_password/);
  });

  it('reads no secret path and has no backtick, so the file runs in the container psql as it is', () => {
    expect(readText(SQL)).not.toContain('GELDAR_SECRETS_DIR');
    expect(readText(SQL)).not.toContain('`');
  });

  it('sets log_min_error_statement to panic, so a failing ALTER never logs the password', () => {
    expect(sqlStatements()[0]).toBe('SET log_min_error_statement = panic;');
  });

  it('has exactly the expected statements, and no other GRANT', () => {
    expect(sqlStatements()).toEqual(EXPECTED_SQL);
  });

  it('grants pg_read_all_stats and CONNECT only', () => {
    const code = sqlCode();
    expect(code).toContain('GRANT pg_read_all_stats TO geldar_monitor;');
    expect(code).toContain('GRANT CONNECT ON DATABASE geldar TO geldar_monitor;');
    expect(code).not.toMatch(
      /pg_monitor\b|pg_write|pg_signal|pg_read_all_settings|pg_stat_scan_tables/i,
    );
  });

  it('cannot write, create, own or escalate', () => {
    expect(sqlCode()).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|TRUNCATE|SUPERUSER|CREATEDB|CREATEROLE|OWNER|REPLICATION|BYPASSRLS|ALL)\b/i,
    );
    expect(sqlCode()).not.toMatch(/\bCREATE\s+(?!ROLE\b)/i);
  });
});

describe('the S2 pipeline in node request 08, the runbook and the ops copy (G2)', () => {
  it('is the exact pipeline in every document that shows S2', () => {
    for (const doc of S2_DOCS) expect(readText(doc), doc).toContain(S2_PIPELINE);
  });

  it('runs the secret read with sudo -n and the container psql with -q -v ON_ERROR_STOP=1 -U geldar -d geldar', () => {
    for (const doc of S2_DOCS) {
      expect(readText(doc), doc).toContain('sudo -n cat');
      expect(readText(doc), doc).toContain('-q -v ON_ERROR_STOP=1 -U geldar -d geldar');
      expect(readText(doc), doc).toContain('docker exec -i geldar-colo-postgres-1 psql');
    }
  });

  it('never shows the host psql route', () => {
    for (const doc of S2_DOCS)
      expect(readText(doc), doc).not.toContain('psql -v ON_ERROR_STOP=1 -d geldar -f');
  });

  it('adds no trace, no echo flag and no PGPASSWORD to the pipeline', () => {
    expect(S2_PIPELINE).not.toMatch(/\s-[aebL]\s/);
    expect(S2_PIPELINE).not.toContain('PGPASSWORD');
    expect(S2_PIPELINE).not.toMatch(/set -x/);
  });
});
