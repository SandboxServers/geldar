// C2-07i: two Colo deploy failures. (1) A service that mounts a file secret must read it as the service uid (the
// secrets are 0600, owned by GELDAR_SERVICE_UID). (2) A service on the Caddy image needs NET_BIND_SERVICE back,
// because the binary's file capability fails exec under cap_drop ALL + no-new-privileges.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
type Service = Record<string, unknown>;
const colo = parse(readFileSync(`${ROOT}compose/colo.yml`, 'utf8'), { merge: true }) as {
  services: Record<string, Service>;
};

const UID = '${GELDAR_SERVICE_UID:-1000}';
// The official Postgres image reads POSTGRES_PASSWORD_FILE as root before it drops to its own postgres user.
const ROOT_THEN_DROP = new Set(['postgres']);

const runsAsServiceUid = (s: Service): boolean => {
  const env = (s.environment ?? {}) as Record<string, unknown>;
  // Either compose `user:` or the itzg images' UID/GID drop (Paper, Velocity).
  return s.user === `${UID}:${UID}` || (env.UID === UID && env.GID === UID);
};

describe('colo.yml services that mount file secrets', () => {
  const mounting = Object.entries(colo.services).filter(
    ([name, s]) => Array.isArray(s.secrets) && s.secrets.length > 0 && !ROOT_THEN_DROP.has(name),
  );

  it('finds the secret-mounting services, velocity among them', () => {
    expect(mounting.map(([n]) => n)).toEqual(
      expect.arrayContaining(['paper', 'velocity', 'glass']),
    );
  });

  it.each(mounting)('%s runs as the service uid', (_name, s) => {
    expect(runsAsServiceUid(s)).toBe(true);
  });
});

describe('colo.yml services on the Caddy image', () => {
  const caddy = Object.entries(colo.services).filter(([, s]) =>
    String(s.image).startsWith('caddy@'),
  );

  it('exists (bluemap-web)', () => {
    expect(caddy.map(([n]) => n)).toContain('bluemap-web');
  });

  it.each(caddy)(
    '%s keeps NET_BIND_SERVICE with cap_drop ALL and no-new-privileges',
    (_name, s) => {
      expect(s.cap_drop).toEqual(['ALL']);
      expect(s.cap_add).toEqual(['NET_BIND_SERVICE']);
      expect(s.security_opt).toContain('no-new-privileges:true');
    },
  );

  it('bluemap-web listens on the port it publishes', () => {
    const s = colo.services['bluemap-web'] ?? {};
    expect(s.command).toContain(':8100');
    expect(s.ports).toEqual(['127.0.0.1:8100:8100']);
  });
});
