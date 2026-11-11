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

  it('mounts the shard file read only at /opt/geldar/shards/colo.yaml', () => {
    expect(body.volumes).toContain('../shards/colo.yaml:/opt/geldar/shards/colo.yaml:ro');
    expect(mind.volumes).toContain('../shards/colo.yaml:/opt/geldar/shards/colo.yaml:ro');
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
    expect(mind.secrets).toEqual(['postgres']);
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
