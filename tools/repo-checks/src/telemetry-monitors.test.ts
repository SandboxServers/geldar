import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const EXPORTER_IMAGE =
  'natsio/prometheus-nats-exporter:0.20.3@sha256:4b8ddc1c86fec360b5cd3d5e1fbc6fb52bdafd5805bba3901cc52926538af255';
const EXPORTER_PORT = '7777';
const MONITOR_URL = 'http://127.0.0.1:8222';
const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;

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
/** The SQL with its comment lines removed, so a word in a comment never counts as a grant. */
const sqlCode = () =>
  readText(SQL)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

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

  it.skipIf(!DOCKER)(
    'renders merged onto compose/colo.yml with the same caps, no ports and the same command',
    () => {
      const result = spawnSync(
        'docker',
        ['compose', '-f', 'compose/colo.yml', '-f', OVERLAY, 'config', '--format', 'json'],
        { cwd: ROOT, encoding: 'utf8' },
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

  it('takes the secret file from a node secrets path variable, with no literal path to a real secret', () => {
    const file = compose.secrets?.['otel-pg']?.file ?? '';
    expect(file.startsWith(`$` + '{GELDAR_SECRETS_DIR')).toBe(true);
    expect(file.endsWith('/otel-pg.txt')).toBe(true);
  });
});

describe('deploy/telemetry/postgres-monitor.sql (G2, T-10)', () => {
  it('has no password literal: the password comes from the psql variable', () => {
    expect(sqlCode()).not.toMatch(/PASSWORD\s+'/i);
    expect(sqlCode()).toContain(":'otel_pg_password'");
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
