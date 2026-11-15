import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// C7-03b2 (decision 0260, REG-NATS-COMPOSE): the supervisor compose service sits behind its profile, holds no Docker
// socket and no group, mounts only its secret files, and the register service gets its NATS env. Parsed, not grepped.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

type Service = Record<string, unknown>;

const colo = parse(readFileSync(`${ROOT}compose/colo.yml`, 'utf8'), { merge: true }) as {
  services: Record<string, Service>;
  secrets: Record<string, unknown>;
};
const services = colo.services;
const supervisor = services.supervisor ?? {};
const register = services.register ?? {};

function env(service: Service): Record<string, unknown> {
  return (service.environment ?? {}) as Record<string, unknown>;
}

function limitsOf(service: Service): Record<string, unknown> {
  const deploy = (service.deploy ?? {}) as { resources?: { limits?: Record<string, unknown> } };
  return deploy.resources?.limits ?? {};
}

/** The mounts and grants of a service as text, so a socket mount in any form is caught. */
function mountText(service: Service): string {
  return JSON.stringify([service.volumes ?? [], service.devices ?? [], service.group_add ?? []]);
}

describe('compose/colo.yml: the supervisor service (C7-03b2, decision 0260)', () => {
  it('is behind the supervisor profile only, so no default up starts it', () => {
    expect(supervisor.profiles).toEqual(['supervisor']);
  });

  it('publishes no port and has no host mount', () => {
    expect(supervisor.ports).toBeUndefined();
    expect(supervisor.volumes).toBeUndefined();
  });

  it('runs read-only as a non-root uid with every capability dropped and no new privileges', () => {
    expect(supervisor.read_only).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: compose variable syntax must reach the parser as written
    expect(supervisor.user).toBe('${GELDAR_SERVICE_UID:-1000}:${GELDAR_SERVICE_UID:-1000}');
    expect(supervisor.cap_drop).toEqual(['ALL']);
    expect(supervisor.cap_add).toBeUndefined();
    expect(supervisor.security_opt).toEqual(['no-new-privileges:true']);
    expect(supervisor.privileged).toBeUndefined();
    expect(supervisor.network_mode).toBeUndefined();
    expect(supervisor.group_add).toBeUndefined();
  });

  it('has the card budget: 0.25 CPU, 128m, memory swap equal to memory, and a pid cap', () => {
    const limits = limitsOf(supervisor);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: compose variable syntax must reach the parser as written
    expect(limits.cpus).toBe('${GELDAR_COLO_SUPERVISOR_CPUS:-0.25}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: compose variable syntax must reach the parser as written
    expect(limits.memory).toBe('${GELDAR_COLO_SUPERVISOR_MEM:-128m}');
    expect(supervisor.memswap_limit).toBe(limits.memory);
    expect(supervisor.pids_limit).toBe(64);
  });

  it('builds supervisor/Dockerfile from the repo root and takes its image from a deploy variable', () => {
    expect(supervisor.build).toEqual({ context: '..', dockerfile: 'supervisor/Dockerfile' });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: compose variable syntax must reach the parser as written
    expect(supervisor.image).toBe('${GELDAR_SUPERVISOR_IMAGE:-geldar-supervisor:c7}');
  });

  it('sets the settings supervisor/src/config.ts reads and the NATS user the contract connects as', () => {
    expect(env(supervisor).SUPERVISOR_SHARD).toBe('colo');
    expect(env(supervisor).SUPERVISOR_NATS_URL).toBe('nats://nats:4222');
    expect(env(supervisor).SUPERVISOR_DB_PASSWORD_FILE).toBe(
      '/run/secrets/postgres-supervisor.txt',
    );
    expect(env(supervisor).GELDAR_NATS_USER).toBe('supervisor');
    expect(env(supervisor).GELDAR_NATS_PASSWORD_FILE).toBe('/run/secrets/nats-supervisor.txt');
  });

  it('reads its two secrets as files, mounted from declared secrets, and never as an env value', () => {
    expect(supervisor.secrets).toEqual([
      { source: 'supervisor-postgres', target: 'postgres-supervisor.txt' },
      { source: 'supervisor-nats', target: 'nats-supervisor.txt' },
    ]);
    expect(Object.keys(colo.secrets)).toEqual(
      expect.arrayContaining(['supervisor-postgres', 'supervisor-nats']),
    );
    const inline = Object.keys(env(supervisor)).filter(
      (key) => /PASSWORD|SECRET|TOKEN/.test(key) && !key.endsWith('_FILE'),
    );
    expect(inline).toEqual([]);
  });
});

describe('compose/colo.yml: no service mounts the Docker socket (decision 0260)', () => {
  it('no service mounts docker.sock, names the Docker run directory, or gets a group', () => {
    const hits = Object.entries(services)
      .filter(
        ([, service]) =>
          /docker\.sock|\/var\/run\/docker/.test(mountText(service)) ||
          service.group_add !== undefined,
      )
      .map(([name]) => name);
    expect(hits).toEqual([]);
  });
});

describe('compose/colo.yml: the register NATS env (C7-03b2, REG-NATS-COMPOSE)', () => {
  it('sets all three REGISTER_NATS_* variables and mounts the nats-register secret', () => {
    expect(env(register).REGISTER_NATS_URL).toBe('nats://nats:4222');
    expect(env(register).REGISTER_NATS_USER).toBe('register');
    expect(env(register).REGISTER_NATS_PASSWORD_FILE).toBe('/run/secrets/nats-register.txt');
    expect(register.secrets).toContainEqual({
      source: 'nats-register',
      target: 'nats-register.txt',
    });
    expect(Object.keys(colo.secrets)).toContain('nats-register');
  });

  it('no other service has a REGISTER_NATS_* variable', () => {
    const others = Object.entries(services)
      .filter(([name]) => name !== 'register')
      .filter(([, service]) =>
        Object.keys(env(service)).some((key) => key.startsWith('REGISTER_NATS_')),
      )
      .map(([name]) => name);
    expect(others).toEqual([]);
  });
});

describe('compose/colo.yml: the shard budget (C7-03b2)', () => {
  it('the per-service CPU and memory defaults sum to the cpu_limit and memory_limit of shards/colo.yaml', () => {
    const shard = parse(readFileSync(`${ROOT}shards/colo.yaml`, 'utf8')) as {
      cpu_limit: number;
      memory_limit: string;
    };
    let cpus = 0;
    let memory = 0;
    for (const [name, service] of Object.entries(services)) {
      const limits = limitsOf(service);
      const cpuDefault = /:-([\d.]+)\}$/.exec(String(limits.cpus ?? ''));
      const memDefault = /:-(\d+)m\}$/.exec(String(limits.memory ?? ''));
      expect(cpuDefault, `${name} CPU limit default`).not.toBeNull();
      expect(memDefault, `${name} memory limit default`).not.toBeNull();
      cpus += Number(cpuDefault?.[1]);
      memory += Number(memDefault?.[1]);
    }
    expect(cpus).toBeCloseTo(shard.cpu_limit, 6);
    expect(memory).toBe(Number.parseInt(shard.memory_limit, 10));
  });
});
