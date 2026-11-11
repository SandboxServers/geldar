// The C1-03 wiring in compose/colo.yml: the Body (golem-body) and the Mind (animus) services. Parsed, not grepped,
// so a change to a key or a value fails here, not in a deploy. Decisions 0078 (Mind placement) and 0083 (images).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

type Service = Record<string, unknown>;

/** A compose interpolation with a default, as written in the file: ${NAME:-value}. */
const composeDefault = (name: string, value: string) => `\${${name}:-${value}}`;
// The service uid is one deploy variable (GELDAR_SERVICE_UID, default 1000); the deploy checks secret owners against it.
const UID_DEFAULT = composeDefault('GELDAR_SERVICE_UID', '1000');
/** The value compose shows once GELDAR_SERVICE_UID is set (or the default when it is not). */
const withUid = (value: unknown, uid = '1000') => String(value).split(UID_DEFAULT).join(uid);

const colo = parse(readFileSync(`${ROOT}compose/colo.yml`, 'utf8'), { merge: true }) as {
  services: Record<string, Service>;
  secrets: Record<string, unknown>;
};
const body = colo.services['golem-body'] ?? {};
const mind = colo.services.animus ?? {};

function env(service: Service): Record<string, unknown> {
  return (service.environment ?? {}) as Record<string, unknown>;
}

describe('compose/colo.yml: the Body and Mind services (C1-03)', () => {
  it('defines golem-body and animus, both on the colo network', () => {
    expect(colo.services['golem-body']).toBeDefined();
    expect(colo.services.animus).toBeDefined();
    expect(body.networks).toEqual(['colo']);
    expect(mind.networks).toEqual(['colo']);
  });

  it('takes each image from a deploy variable, with the local tag as the offline default', () => {
    expect(body.image).toBe(composeDefault('GELDAR_BODY_IMAGE', 'geldar-body:c1'));
    expect(mind.image).toBe(composeDefault('GELDAR_MIND_IMAGE', 'geldar-mind:c1'));
    expect(colo.services.eventsink?.image).toBe(
      composeDefault('GELDAR_EVENTSINK_IMAGE', 'geldar-eventsink:c1'),
    );
  });

  it('gives every service in the colo file an image key (C1-04: the node refuses a build-only service)', () => {
    for (const [name, service] of Object.entries(colo.services)) {
      expect(service, name).toHaveProperty('image');
    }
  });

  it('builds each image locally from the repo root, so the digest rule treats it as a local build', () => {
    expect(body.build).toEqual({ context: '..', dockerfile: 'golem/Dockerfile' });
    expect(mind.build).toEqual({ context: '..', dockerfile: 'animus/Dockerfile.mind' });
  });

  it('runs the entry points the images define (golem/Dockerfile and animus/Dockerfile.mind)', () => {
    expect(body.entrypoint).toEqual(['node', 'src/adam/main.ts']);
    expect(mind.entrypoint).toEqual(['node', 'src/main.ts']);
  });

  it('publishes no port, so neither service is reachable from outside the node', () => {
    expect(body).not.toHaveProperty('ports');
    expect(mind).not.toHaveProperty('ports');
  });

  it('mounts the Mind shard file read only at /opt/geldar/shards/colo.yaml (decision 0131)', () => {
    // The budget file shards/colo.yaml is never mounted: the Body and the Mind read the Mind's blocks.
    expect(body.volumes).toContain('../shards/colo-mind.yaml:/opt/geldar/shards/colo.yaml:ro');
    expect(mind.volumes).toContain('../shards/colo-mind.yaml:/opt/geldar/shards/colo.yaml:ro');
  });

  it('gives the Body its NATS user and a password file, and declares that secret', () => {
    expect(env(body).GELDAR_NATS_USER).toBe('body');
    expect(env(body).GELDAR_NATS_PASSWORD_FILE).toBe('/run/secrets/nats-body.txt');
    // The long form mounts the secret at the path the env names; the short form mounts it at /run/secrets/nats-body.
    expect(body.secrets).toEqual([{ source: 'nats-body', target: 'nats-body.txt' }]);
    expect(colo.secrets['nats-body']).toEqual({ file: './secrets/nats-body.txt' });
  });

  it('gives the Mind its Postgres password from a file (the postgres secret)', () => {
    expect(env(mind).POSTGRES_PASSWORD_FILE).toBe('/run/secrets/postgres');
    // The Mind also takes its NATS password as a file (decision 0080), declared like the Body's.
    expect(mind.secrets).toEqual(['postgres', { source: 'nats-mind', target: 'nats-mind.txt' }]);
    expect(colo.secrets['nats-mind']).toEqual({ file: './secrets/nats-mind.txt' });
  });

  it('bakes in no credential: every PASSWORD or TOKEN variable is a *_FILE path', () => {
    for (const service of [body, mind]) {
      for (const key of Object.keys(env(service))) {
        if (/PASSWORD|TOKEN/.test(key)) expect(key).toMatch(/_FILE$/);
      }
    }
  });

  it('passes GELDAR_TELEMETRY_URL through from the host, unset by default (C1-07)', () => {
    // A null value in the map form is resolved from the host environment; with no host value it stays unset.
    expect(env(body)).toHaveProperty('GELDAR_TELEMETRY_URL', null);
    expect(env(mind)).toHaveProperty('GELDAR_TELEMETRY_URL', null);
  });

  it('caps each service with its own budget, no swap, a pids limit and log rotation (decision 0082)', () => {
    const budgets: [Service, string, string, string][] = [
      [body, 'GOLEM_BODY', '1', '2048m'],
      [mind, 'ANIMUS', '1', '2048m'],
    ];
    for (const [service, name, cpus, memory] of budgets) {
      expect(service.deploy).toEqual({
        resources: {
          limits: {
            cpus: composeDefault(`GELDAR_COLO_${name}_CPUS`, cpus),
            memory: composeDefault(`GELDAR_COLO_${name}_MEM`, memory),
            pids: 256,
          },
        },
      });
      expect(service.memswap_limit).toBe(composeDefault(`GELDAR_COLO_${name}_MEM`, memory));
      expect(service.pids_limit).toBe(256);
      expect(service.logging).toEqual({
        driver: 'json-file',
        options: { 'max-size': '10m', 'max-file': '3' },
      });
    }
  });
});

// Every colo service, not only the Body and the Mind: the per-service budget (the default of each variable), no swap,
// the pids limit in both forms (compose needs deploy.resources.limits.pids beside pids_limit), and log rotation.
const SHARED_CAPS: Record<string, [string, string, string, number]> = {
  paper: ['PAPER', '3', '8192m', 512],
  velocity: ['VELOCITY', '0.5', '1024m', 256],
  postgres: ['POSTGRES', '1', '2048m', 256],
  nats: ['NATS', '0.5', '512m', 256],
  eventsink: ['EVENTSINK', '0.5', '512m', 256],
  'golem-body': ['GOLEM_BODY', '1', '2048m', 256],
  animus: ['ANIMUS', '1', '2048m', 256],
  'geldar-mcp': ['GELDAR_MCP', '0.5', '512m', 128],
  'players-host': ['PLAYERS_HOST', '1', '2048m', 256],
  admin: ['ADMIN', '0.5', '512m', 128],
};

describe('compose/colo.yml: every service has its caps (decision 0082)', () => {
  it('names exactly the ten services the budget totals cover', () => {
    expect(Object.keys(colo.services).sort()).toEqual(Object.keys(SHARED_CAPS).sort());
  });

  it('gives every service the Watchtower opt-out label and the stack label (FX-WATCHTOWER)', () => {
    for (const [name, service] of Object.entries(colo.services)) {
      expect(service.labels, name).toEqual({
        'com.centurylinklabs.watchtower.enable': 'false',
        'com.geldar.stack': 'colo',
      });
    }
  });

  for (const [name, [budget, cpus, memory, pids]] of Object.entries(SHARED_CAPS)) {
    it(`${name}: its CPU, memory, pids and log limits`, () => {
      const service = colo.services[name] ?? {};
      const deployLimits = (service.deploy as { resources: { limits: Service } }).resources.limits;
      expect(deployLimits.cpus).toBe(composeDefault(`GELDAR_COLO_${budget}_CPUS`, cpus));
      expect(deployLimits.memory).toBe(composeDefault(`GELDAR_COLO_${budget}_MEM`, memory));
      expect(deployLimits.pids).toBe(pids);
      expect(service.memswap_limit).toBe(composeDefault(`GELDAR_COLO_${budget}_MEM`, memory));
      expect(service.pids_limit).toBe(pids);
      expect(service.logging).toEqual({
        driver: 'json-file',
        options: { 'max-size': '10m', 'max-file': '3' },
      });
    });
  }

  it('publishes no database or NATS port; Velocity is the only listener and keeps 127.0.0.1:25567', () => {
    expect(colo.services.postgres).not.toHaveProperty('ports');
    expect(colo.services.nats).not.toHaveProperty('ports');
    expect(colo.services.velocity?.ports).toEqual(['127.0.0.1:25567:25565']);
  });
});

// The C1-11a services: the MCP (the sovereign players' door) and the player host (one Body per ranger).
const mcp = colo.services['geldar-mcp'] ?? {};
const players = colo.services['players-host'] ?? {};

describe('compose/colo.yml: the MCP service (C1-11a)', () => {
  it('publishes only the loopback MCP port, as a literal (the loopback rule rejects interpolation)', () => {
    expect(mcp.ports).toEqual(['127.0.0.1:8788:8788']);
  });

  it('takes its image from a deploy variable, built from threshold/mcp/Dockerfile offline', () => {
    expect(mcp.image).toBe(composeDefault('GELDAR_MCP_IMAGE', 'geldar-mcp:c1'));
    expect(mcp.build).toEqual({ context: '..', dockerfile: 'threshold/mcp/Dockerfile' });
  });

  it('reads Postgres as the geldar_mcp role from a file and never mounts a token file', () => {
    expect(env(mcp).POSTGRES_HOST).toBe('postgres');
    expect(env(mcp).GELDAR_MCP_DB_PASSWORD_FILE).toBe('/run/secrets/postgres-mcp.txt');
    expect(mcp.secrets).toContainEqual({ source: 'nats-mcp', target: 'nats-mcp.txt' });
    expect(JSON.stringify(mcp.volumes ?? [])).not.toMatch(/token/i);
  });

  it('connects to NATS as the mcp user with its password file, and declares the secrets it names', () => {
    expect(env(mcp).GELDAR_NATS_USER).toBe('mcp');
    expect(env(mcp).GELDAR_NATS_PASSWORD_FILE).toBe('/run/secrets/nats-mcp.txt');
    for (const name of ['postgres-mcp.txt', 'mcp-token-pepper.txt', 'nats-mcp']) {
      expect(colo.secrets).toHaveProperty([name]);
    }
  });

  it('runs read-only as uid 1000 with no capability, the compose/mcp.yml hardening', () => {
    expect(mcp.user).toBe(`${UID_DEFAULT}:${UID_DEFAULT}`);
    expect(mcp.read_only).toBe(true);
    expect(mcp.cap_drop).toEqual(['ALL']);
    expect(mcp.security_opt).toEqual(['no-new-privileges:true']);
  });

  it('mounts the Mind shard file, which carries the sovereign block, as the shard file', () => {
    expect(mcp.volumes).toEqual(['../shards/colo-mind.yaml:/opt/geldar/shards/colo.yaml:ro']);
  });
});

describe('compose/colo.yml: the player host (C1-11a)', () => {
  it('runs the player entry point of the Body image, with the player id as a compose variable', () => {
    expect(players.entrypoint).toEqual(['node', 'src/players/main.ts']);
    expect(players.command).toEqual(['--player', '${GELDAR_PLAYER_ID:-}']);
    expect(players.image).toBe(composeDefault('GELDAR_BODY_IMAGE', 'geldar-body:c1'));
  });

  it('is gated behind the sovereign profile, so a plain shard up does not start it', () => {
    expect(players.profiles).toEqual(['sovereign']);
  });

  it('reaches Velocity for the game and Paper for RCON, by service name, with the opt-in', () => {
    expect(env(players).GELDAR_MC_HOST).toBe('velocity');
    expect(env(players).GELDAR_RCON_HOST).toBe('paper');
    expect(env(players).GELDAR_IN_NETWORK_HOSTS).toBe('1');
    expect(players.secrets).toContainEqual({ source: 'nats-body', target: 'nats-body.txt' });
    expect(players.secrets).toContain('rcon');
  });

  it('publishes no port and joins only the colo network', () => {
    expect(players).not.toHaveProperty('ports');
    expect(players.networks).toEqual(['colo']);
  });
});

// The service uid (decision 0084 follow-up): the services run as GELDAR_SERVICE_UID, so the secret files the deploy
// checks must be owned by the same uid. Paper's itzg image takes UID and GID; Velocity's image does not (no change there).
describe('compose/colo.yml: the service uid (GELDAR_SERVICE_UID)', () => {
  const uidServices = ['golem-body', 'players-host', 'animus', 'geldar-mcp', 'admin', 'eventsink'];

  it.each(uidServices)(
    '%s runs as the service uid, default 1000 (rendered as 1001 when set)',
    (name) => {
      const user = colo.services[name]?.user;
      expect(user).toBe(`${UID_DEFAULT}:${UID_DEFAULT}`);
      expect(withUid(user)).toBe('1000:1000');
      expect(withUid(user, '1001')).toBe('1001:1001');
    },
  );

  it('gives Paper UID and GID from the service uid, the itzg variables (default 1000)', () => {
    expect(env(colo.services.paper ?? {}).UID).toBe(UID_DEFAULT);
    expect(env(colo.services.paper ?? {}).GID).toBe(UID_DEFAULT);
    expect(withUid(env(colo.services.paper ?? {}).UID, '1001')).toBe('1001');
    expect(withUid(env(colo.services.paper ?? {}).GID, '1001')).toBe('1001');
  });

  it.each(['postgres', 'nats'])('leaves %s on its own image user (no user: key)', (name) => {
    expect(colo.services[name]).not.toHaveProperty('user');
  });
});
