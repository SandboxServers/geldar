import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COLO_PATH,
  coloRole,
  findPublicPorts,
  isComposeFile,
  PUBLIC_OVERLAY_PATH,
  PUBLIC_OVERLAY_PORT,
} from './loopback-ports.ts';

/** The findings for one compose file, as `service: reason` strings. */
function problems(text: string): string[] {
  return findPublicPorts('compose/phase0.yml', text).map((f) => `${f.service}: ${f.reason}`);
}

/** A one-service file whose `ports:` value is the given YAML text. */
function withPorts(ports: string): string {
  return ['services:', '  db:', `    ${ports}`].join('\n');
}

describe('isComposeFile', () => {
  it('covers compose files only', () => {
    expect(isComposeFile('compose/phase0.yml')).toBe(true);
    expect(isComposeFile('compose/velocity/velocity.toml')).toBe(false);
    expect(isComposeFile('compose/sub/extra.yml')).toBe(false);
    expect(isComposeFile('docs/compose.yml')).toBe(false);
  });
});

describe('findPublicPorts: passes', () => {
  it('accepts short entries that start with the loopback prefix', () => {
    const text = [
      'services:',
      '  postgres:',
      '    ports:',
      '      - "127.0.0.1:5432:5432"',
      '      - 127.0.0.1:4222:4222',
    ].join('\n');
    expect(problems(text)).toEqual([]);
  });

  it('accepts port ranges on loopback', () => {
    expect(problems(withPorts('ports: ["127.0.0.1:3000-3005:3000-3005"]'))).toEqual([]);
  });

  it('accepts long-form mappings with host_ip 127.0.0.1', () => {
    const text = [
      'services:',
      '  db:',
      '    ports:',
      '      - target: 5432',
      '        published: "5432"',
      '        host_ip: 127.0.0.1',
    ].join('\n');
    expect(problems(text)).toEqual([]);
  });

  it('ignores expose, which publishes nothing to the host', () => {
    expect(problems(withPorts('expose: ["5432", "25565"]'))).toEqual([]);
  });

  it('accepts a service with no ports key and bridge networking', () => {
    expect(problems('services:\n  nats:\n    image: nats:2.15.1-alpine')).toEqual([]);
  });

  it('reads a merge key and an anchor that both resolve to loopback', () => {
    const text = [
      'x-base: &base',
      '  ports:',
      '    - "127.0.0.1:5432:5432"',
      'x-list: &list',
      '  - "127.0.0.1:4222:4222"',
      'services:',
      '  db:',
      '    <<: *base',
      '  cache:',
      '    ports: *list',
    ].join('\n');
    expect(problems(text)).toEqual([]);
  });
});

describe('findPublicPorts: bypass cases fail', () => {
  it('fails a same-indent dash list (a valid YAML block list)', () => {
    const text = ['services:', '  db:', '    ports:', '    - "5432:5432"'].join('\n');
    expect(problems(text)).toEqual(['db: port "5432:5432" must start with 127.0.0.1:']);
  });

  it('fails a bare port under a !override tag', () => {
    const text = withPorts('ports: !override\n      - "5432:5432"');
    expect(problems(text)).not.toEqual([]);
  });

  it('fails a bare port in a multi-line flow list', () => {
    const text = withPorts('ports: [\n        "127.0.0.1:1:1",\n        "5432:5432"\n      ]');
    expect(problems(text)).toEqual(['db: port "5432:5432" must start with 127.0.0.1:']);
  });

  it('fails a quoted ports key', () => {
    expect(problems(withPorts('"ports": ["5432:5432"]'))).toEqual([
      'db: port "5432:5432" must start with 127.0.0.1:',
    ]);
  });

  it('fails a bare port reached through an anchor and an alias', () => {
    const text = ['x-ports: &p', '  - "5432:5432"', 'services:', '  db:', '    ports: *p'].join(
      '\n',
    );
    expect(problems(text)).toEqual(['db: port "5432:5432" must start with 127.0.0.1:']);
  });

  it('fails a bare port in a merged anchor', () => {
    const text = [
      'x-base: &base',
      '  ports: ["5432:5432"]',
      'services:',
      '  db:',
      '    <<: *base',
    ].join('\n');
    expect(problems(text)).toEqual(['db: port "5432:5432" must start with 127.0.0.1:']);
  });

  it('fails a bare dash line whose value is on the next line', () => {
    const text = ['services:', '  db:', '    ports:', '      -', '        "5432:5432"'].join('\n');
    expect(problems(text)).toEqual(['db: port "5432:5432" must start with 127.0.0.1:']);
  });

  it('fails a non-loopback address and a variable host, naming the service', () => {
    const text = withPorts('ports: ["0.0.0.0:25565:25565", "$HOST:8222:8222"]');
    expect(problems(text)).toEqual([
      'db: port "0.0.0.0:25565:25565" must start with 127.0.0.1:',
      'db: port "$HOST:8222:8222" uses interpolation, which is rejected',
    ]);
  });

  it('fails a range that is not on loopback', () => {
    expect(problems(withPorts('ports: ["3000-3005:3000-3005"]'))).toEqual([
      'db: port "3000-3005:3000-3005" must start with 127.0.0.1:',
    ]);
  });

  it('fails dollar-brace interpolation even after the loopback prefix', () => {
    expect(problems(withPorts('ports: ["127.0.0.1:$' + '{PORT}:5432"]'))).toEqual([
      'db: port "127.0.0.1:$' + '{PORT}:5432" uses interpolation, which is rejected',
    ]);
    expect(problems(withPorts('ports: ["$' + '{HOST}:5432:5432"]'))).toEqual([
      'db: port "$' + '{HOST}:5432:5432" uses interpolation, which is rejected',
    ]);
  });

  it('fails an IPv6 loopback host, which is not supported', () => {
    expect(problems(withPorts('ports: ["[::1]:5432:5432"]'))).toEqual([
      'db: port "[::1]:5432:5432" must start with 127.0.0.1:',
    ]);
  });

  it('fails network_mode: host, with or without ports', () => {
    expect(problems('services:\n  paper:\n    network_mode: host')).toEqual([
      'paper: network_mode: host shares the host network and is rejected',
    ]);
    expect(
      problems('services:\n  paper:\n    network_mode: "host"\n    ports: ["127.0.0.1:1:1"]'),
    ).toEqual(['paper: network_mode: host shares the host network and is rejected']);
  });

  it('fails a network_mode that is interpolated, not a string, or could resolve to host', () => {
    expect(problems('services:\n  paper:\n    network_mode: $' + '{NM:-bridge}')).toEqual([
      'paper: network_mode "$' + '{NM:-bridge}" uses interpolation, which is rejected',
    ]);
    expect(problems('services:\n  paper:\n    network_mode: $' + '{NM}')).toEqual([
      'paper: network_mode "$' + '{NM}" uses interpolation, which is rejected',
    ]);
    expect(problems('services:\n  paper:\n    network_mode: [host]')).toEqual([
      'paper: network_mode ["host"] must be a string',
    ]);
  });

  it('accepts a plain bridge or service:<name> network_mode', () => {
    expect(problems('services:\n  paper:\n    network_mode: bridge')).toEqual([]);
    expect(problems('services:\n  paper:\n    network_mode: service:foo')).toEqual([]);
  });

  it('fails host networking written as a plain host string', () => {
    expect(problems('services:\n  paper:\n    network_mode: host')).toEqual([
      'paper: network_mode: host shares the host network and is rejected',
    ]);
  });

  it('fails extends on a service and include at the top level, which are not followed', () => {
    expect(
      problems('services:\n  paper:\n    extends:\n      file: other.yml\n      service: base'),
    ).toEqual(['paper: extends is not followed, so it is rejected']);
    expect(problems('include:\n  - other.yml\nservices:\n  db:\n    image: postgres:17')).toEqual([
      '(file): include is not followed, so it is rejected',
    ]);
  });

  it('passes a normal file with bridge networking and loopback ports', () => {
    const text = [
      'services:',
      '  postgres:',
      '    image: postgres:17',
      '    network_mode: bridge',
      '    ports:',
      '      - "127.0.0.1:5432:5432"',
      '  paper:',
      '    image: itzg/minecraft-server:2026.1',
      '    network_mode: service:postgres',
      '    expose:',
      '      - "25565"',
    ].join('\n');
    expect(problems(text)).toEqual([]);
  });

  it('fails a long-form mapping without host_ip, naming the service and mapping', () => {
    const text = [
      'services:',
      '  db:',
      '    ports:',
      '      - target: 5432',
      '        published: 5432',
    ];
    const [finding] = problems(text.join('\n'));
    expect(finding).toBe(
      'db: long-form mapping {"target":5432,"published":5432} must set host_ip: 127.0.0.1',
    );
  });

  it('fails a long-form mapping that binds another address', () => {
    const text = [
      'services:',
      '  db:',
      '    ports:',
      '      - target: 5432',
      '        published: 5432',
      '        host_ip: 0.0.0.0',
    ].join('\n');
    expect(problems(text)).toEqual([
      'db: long-form mapping {"target":5432,"published":5432,"host_ip":"0.0.0.0"} must set host_ip: 127.0.0.1',
    ]);
  });

  it('fails a long-form mapping whose host_ip is interpolated', () => {
    const text = [
      'services:',
      '  db:',
      '    ports:',
      '      - target: 5432',
      '        host_ip: $' + '{BIND}',
    ].join('\n');
    expect(problems(text)).toHaveLength(1);
  });

  it('fails an unexpected ports shape: a string, a bare number, or an empty key', () => {
    expect(problems(withPorts('ports: "127.0.0.1:1:1"'))).toEqual(['db: ports must be a list']);
    expect(problems(withPorts('ports: [5432]'))).toEqual([
      'db: port 5432 is not a string or a long-form mapping',
    ]);
    expect(problems(withPorts('ports:'))).toEqual(['db: ports must be a list']);
  });

  it('fails a service that is not a mapping', () => {
    expect(problems('services:\n  db:')).toEqual(['db: service is not a mapping']);
  });

  it('fails a file it cannot read as one YAML document', () => {
    expect(problems('services: [')).toHaveLength(1);
    expect(problems('services:\n  db:\n    ports: []\n    ports: ["5432:5432"]')).toHaveLength(1);
    expect(problems('services: {}\n---\nservices: {}')).toHaveLength(1);
    expect(problems('services:\n  db:\n    ports: *missing')).toHaveLength(1);
  });

  it('fails when the root or services is not a mapping', () => {
    expect(problems('- a\n- b')).toEqual(['(file): is not a YAML mapping']);
    expect(problems('services: ["a"]')).toEqual(['(file): services is not a mapping']);
  });
});

/** The findings for compose/colo.yml, as `service: reason` strings. */
function coloProblems(text: string): string[] {
  return findPublicPorts(COLO_PATH, text).map((f) => `${f.service}: ${f.reason}`);
}

/** A one-service colo file: the `ports:` lines and an optional `deploy:` block, both given as YAML text. */
function coloService(ports: string[], deploy = LIMITS): string {
  return [
    'services:',
    '  paper:',
    '    pids_limit: 256',
    '    memswap_limit: 2048m',
    '    logging: {}',
    WATCHTOWER_OFF,
    ...ports,
    ...deploy.split('\n').map((line) => `    ${line}`),
  ].join('\n');
}

const LIMITS = [
  'deploy:',
  '  resources:',
  '    limits:',
  '      cpus: "4"',
  '      memory: 8192m',
].join('\n');

/** The Watchtower opt-out line that every colo service carries (FX-WATCHTOWER), in the map form. */
const WATCHTOWER_OFF = '    labels: { com.centurylinklabs.watchtower.enable: "false" }';

/** A one-service colo file with every required key and a limit, plus `extra` lines; `drop` removes keys by name. */
function hardened(extra: string[] = [], drop: string[] = []): string {
  const base = [
    '    image: x',
    '    pids_limit: 256',
    '    memswap_limit: 2048m',
    '    logging: {}',
    WATCHTOWER_OFF,
    '    deploy:',
    '      resources:',
    '        limits:',
    '          cpus: "1"',
    '          memory: 512m',
  ];
  const kept = base.filter((line) => !drop.some((key) => line.startsWith(`    ${key}:`)));
  return ['services:', '  paper:', ...kept, ...extra].join('\n');
}

describe('coloRole', () => {
  it('applies the base rules to colo.yml and any colo*.yml, and the overlay rules to nats-auth.yml', () => {
    expect(coloRole('compose/colo.yml')).toBe('base');
    expect(coloRole('compose/colo-dev.yaml')).toBe('base');
    expect(coloRole('compose/nats-auth.yml')).toBe('overlay');
    expect(coloRole('compose/phase0.yml')).toBeNull();
    expect(coloRole('compose/nats-auth-mcp.yml')).toBeNull();
  });
});

describe('findPublicPorts: colo hardening rules', () => {
  it('passes a service with every required key, a limit and no denied key', () => {
    expect(coloProblems(hardened())).toEqual([]);
  });

  it('accepts a VAR-default limit when the default is positive', () => {
    const text = hardened().replace('cpus: "1"', `cpus: "\${GELDAR_X_CPUS:-0.5}"`);
    expect(coloProblems(text)).toEqual([]);
  });

  it('accepts named volumes and the allowlisted relative sources', () => {
    const volumes = [
      '    volumes:',
      '      - data:/data',
      '      - ../sql:/docker-entrypoint-initdb.d:ro',
      '      - ../plugin/core/build/libs/x.jar:/plugins/x.jar:ro',
      '      - ./paper/entry.sh:/entry.sh:ro',
      '      - ./secrets/nats.conf:/etc/nats.conf:ro',
    ];
    expect(coloProblems(hardened(volumes))).toEqual([]);
  });

  it.each([
    ['privileged: true', 'privileged'],
    ['cap_add: [NET_ADMIN]', 'cap_add'],
    ['pid: host', 'pid'],
    ['ipc: host', 'ipc'],
    ['userns_mode: host', 'userns_mode'],
    ['devices: ["/dev/fuse:/dev/fuse"]', 'devices'],
    ['sysctls: { net.core.somaxconn: 1024 }', 'sysctls'],
  ])('denies %s on any colo service', (line, key) => {
    expect(coloProblems(hardened([`    ${line}`]))).toEqual([
      `paper: ${key} is not allowed in colo`,
    ]);
  });

  it('allows exactly cap_add: [NET_BIND_SERVICE] (the Caddy file capability) and nothing wider', () => {
    expect(coloProblems(hardened(['    cap_add: [NET_BIND_SERVICE]']))).toEqual([]);
    for (const line of [
      'cap_add: [NET_BIND_SERVICE, NET_ADMIN]',
      'cap_add: [ALL]',
      'cap_add: NET_BIND_SERVICE',
    ]) {
      expect(coloProblems(hardened([`    ${line}`]))).toEqual([
        'paper: cap_add is not allowed in colo',
      ]);
    }
  });

  it('denies network_mode on a colo service, even one that names a service', () => {
    expect(coloProblems(hardened(['    network_mode: "service:nats"']))).toEqual([
      'paper: network_mode is not allowed in colo; a service joins the colo network',
    ]);
  });

  it('denies a docker.sock volume, naming the service and not the path', () => {
    const found = coloProblems(
      hardened(['    volumes:', '      - /var/run/docker.sock:/var/run/docker.sock']),
    );
    expect(found).toEqual([
      'paper: volume "/var/run/docker.sock" mounts docker.sock, which is rejected',
    ]);
  });

  it('denies a docker.sock long-form volume', () => {
    const long = [
      '    volumes:',
      '      - type: bind',
      '        source: /var/run/docker.sock',
      '        target: /s',
    ];
    expect(coloProblems(hardened(long))).toEqual([
      'paper: volume "/var/run/docker.sock" mounts docker.sock, which is rejected',
    ]);
  });

  it('denies an absolute host path and a Windows drive path', () => {
    const abs = coloProblems(hardened(['    volumes:', '      - /etc:/host-etc']));
    const drive = coloProblems(hardened(['    volumes:', '      - C:\\data:/d']));
    expect(abs).toEqual(['paper: volume "/etc" is an absolute host path, which is rejected']);
    expect(drive).toEqual([
      'paper: volume "C:\\\\data:/d" is an absolute host path, which is rejected',
    ]);
  });

  it('denies a relative source outside the allowlist, including a prefix that only looks like one', () => {
    const lines = ['    volumes:', '      - ../secrets-elsewhere:/x', '      - ../sqlx:/y'];
    expect(coloProblems(hardened(lines))).toEqual([
      'paper: volume "../secrets-elsewhere" is not in the colo allowlist',
      'paper: volume "../sqlx" is not in the colo allowlist',
    ]);
  });

  it('denies climbing out of an allowed directory with ..', () => {
    const lines = ['    volumes:', '      - ../sql/../../etc:/x'];
    expect(coloProblems(hardened(lines))).toEqual([
      'paper: volume "../sql/../../etc" climbs out of its directory, which is rejected',
    ]);
  });

  it('denies cpus of 0, which is not a positive limit', () => {
    const text = hardened().replace('cpus: "1"', 'cpus: "0"');
    expect(coloProblems(text)).toEqual(['paper: cpus "0" must be a positive number']);
  });

  it(`denies a \${VAR:-default} limit whose default is zero`, () => {
    const text = hardened().replace('memory: 512m', `memory: "\${GELDAR_X_MEM:-0m}"`);
    expect(coloProblems(text)).toEqual([
      `paper: memory "\${GELDAR_X_MEM:-0m}" has a default that is not a positive size such as 512m`,
    ]);
  });

  it('denies a service with no pids_limit', () => {
    expect(coloProblems(hardened([], ['pids_limit']))).toEqual([
      'paper: has no pids_limit; every colo service needs one',
    ]);
  });

  it('denies a service with no memswap_limit or no logging', () => {
    expect(coloProblems(hardened([], ['memswap_limit']))).toEqual([
      'paper: has no memswap_limit; every colo service needs one',
    ]);
    expect(coloProblems(hardened([], ['logging']))).toEqual([
      'paper: has no logging; every colo service needs one',
    ]);
  });

  it('applies the presence rules to colo files only: the NATS overlay without limits passes', () => {
    const overlay = 'services:\n  paper:\n    environment:\n      GELDAR_NATS_USER: paper';
    expect(findPublicPorts('compose/nats-auth.yml', overlay)).toEqual([]);
    const denied = 'services:\n  paper:\n    privileged: true';
    expect(findPublicPorts('compose/nats-auth.yml', denied).map((f) => f.reason)).toEqual([
      'privileged is not allowed in colo',
    ]);
  });
});

describe('findPublicPorts: the Watchtower opt-out label (FX-WATCHTOWER)', () => {
  it('passes a service whose label is the map form or the list form, set to false', () => {
    expect(coloProblems(hardened())).toEqual([]);
    const list = hardened().replace(
      WATCHTOWER_OFF,
      '    labels:\n      - com.centurylinklabs.watchtower.enable=false',
    );
    expect(coloProblems(list)).toEqual([]);
  });

  it('accepts a YAML false, which compose writes as "false"', () => {
    expect(coloProblems(hardened().replace('"false"', 'false'))).toEqual([]);
  });

  it('reads the label through a shared anchor, as compose/colo.yml does', () => {
    const text = [
      'x-labels: &colo-labels',
      '  com.centurylinklabs.watchtower.enable: "false"',
      hardened(['    labels: *colo-labels'], ['labels']),
    ].join('\n');
    expect(coloProblems(text)).toEqual([]);
  });

  it('fails a service with no label, naming the service', () => {
    expect(coloProblems(hardened([], ['labels']))).toEqual([
      'paper: has no com.centurylinklabs.watchtower.enable label; every colo service needs it set to "false"',
    ]);
  });

  it('fails a label set to true, in the map form and the list form', () => {
    const map = hardened().replace('"false"', '"true"');
    const list = hardened().replace(
      WATCHTOWER_OFF,
      '    labels:\n      - com.centurylinklabs.watchtower.enable=true',
    );
    const reason = 'paper: com.centurylinklabs.watchtower.enable must be "false", not "true"';
    expect(coloProblems(map)).toEqual([reason]);
    expect(coloProblems(list)).toEqual([reason]);
  });

  it('fails a misspelled key, which leaves the real label missing and names the misspelled one', () => {
    const text = hardened().replace('watchtower.enable:', 'watchtower.enabled:');
    expect(coloProblems(text)).toEqual([
      'paper: has no com.centurylinklabs.watchtower.enable label; it has "com.centurylinklabs.watchtower.enabled", which is not that key',
    ]);
  });

  it('fails a labels value that is neither a mapping nor a list of strings', () => {
    expect(coloProblems(hardened().replace(WATCHTOWER_OFF, '    labels: [1]'))).toEqual([
      'paper: labels must be a mapping or a list of KEY=VALUE strings',
    ]);
  });

  it('applies the label rule to the NATS overlay only where it sets the label', () => {
    const omitted = 'services:\n  paper:\n    environment:\n      GELDAR_NATS_USER: paper';
    expect(findPublicPorts('compose/nats-auth.yml', omitted)).toEqual([]);
    const on =
      'services:\n  paper:\n    labels:\n      com.centurylinklabs.watchtower.enable: "true"';
    expect(findPublicPorts('compose/nats-auth.yml', on).map((f) => f.reason)).toEqual([
      'com.centurylinklabs.watchtower.enable must be "false", not "true"',
    ]);
  });

  it('applies the label rule to colo only: phase0 has no label requirement', () => {
    expect(findPublicPorts('compose/phase0.yml', 'services:\n  db:\n    image: x')).toEqual([]);
  });
});

describe('findPublicPorts: compose/colo.yml', () => {
  it('passes the committed compose/colo.yml', () => {
    const text = readFileSync(
      fileURLToPath(new URL('../../../compose/colo.yml', import.meta.url)),
      'utf8',
    );
    expect(coloProblems(text)).toEqual([]);
  });

  it('passes a loopback Minecraft port 25567 and a limit on the service', () => {
    expect(coloProblems(coloService(['    ports: ["127.0.0.1:25567:25565"]']))).toEqual([]);
  });

  it('refuses a published 25565 in the short form', () => {
    const found = coloProblems(coloService(['    ports: ["127.0.0.1:25565:25565"]']));
    expect(found).toEqual([
      'paper: publishes host port 25565, which the colo stack never publishes',
    ]);
  });

  it('refuses a published 25566 in the long form, whatever the host_ip', () => {
    const ports = [
      '    ports:',
      '      - target: 25565',
      '        published: "25566"',
      '        host_ip: 127.0.0.1',
    ];
    expect(coloProblems(coloService(ports))).toEqual([
      'paper: publishes host port 25566, which the colo stack never publishes',
    ]);
  });

  it('refuses a range that covers a reserved port', () => {
    expect(coloProblems(coloService(['    ports: ["127.0.0.1:25560-25570:25560-25570"]']))).toEqual(
      ['paper: publishes host port 25565, which the colo stack never publishes'],
    );
  });

  it('refuses a published port it cannot read as a number or a range', () => {
    const found = coloProblems(coloService(['    ports: ["127.0.0.1:mc:25565"]']));
    expect(found).toEqual(['paper: host port "mc" cannot be read as a number or a range']);
  });

  it('refuses a service with no deploy.resources.limits, naming the service', () => {
    const text =
      'services:\n  paper:\n    image: x\n  nats:\n    image: y\n    deploy:\n      resources:\n        limits:\n          cpus: "1"';
    // The services also lack pids_limit, memswap_limit and logging, which the other rules name.
    expect(coloProblems(text)).toEqual(
      expect.arrayContaining([
        'paper: has no deploy.resources.limits with cpus and memory; every colo service needs one',
        'nats: has no deploy.resources.limits with cpus and memory; every colo service needs one',
      ]),
    );
  });

  it('refuses limits that name cpus but not memory', () => {
    const deploy = ['deploy:', '  resources:', '    limits:', '      cpus: "4"'].join('\n');
    expect(coloProblems(coloService([], deploy))).toHaveLength(1);
  });

  it('accepts limits that come through a merge key from an anchor', () => {
    const text = [
      'x-limits: &limits',
      '  deploy:',
      '    resources:',
      '      limits:',
      '        cpus: "4"',
      '        memory: 8192m',
      'services:',
      '  paper:',
      '    <<: *limits',
      '    pids_limit: 256',
      '    memswap_limit: 2048m',
      '    logging: {}',
      WATCHTOWER_OFF,
      '    ports: ["127.0.0.1:25567:25565"]',
    ].join('\n');
    expect(coloProblems(text)).toEqual([]);
  });

  it('applies the colo rules to colo only: phase0 keeps its published 25565 for velocity', () => {
    const text = 'services:\n  velocity:\n    ports: ["127.0.0.1:25565:25565"]';
    expect(findPublicPorts('compose/phase0.yml', text)).toEqual([]);
  });
});

// The one public publish (decision 0096): velocity in compose/colo-public.yml, with the bind address and port from env.
describe('findPublicPorts: the public Minecraft overlay (C2-07a2)', () => {
  const overlay = (service: string, port: string) =>
    `services:\n  ${service}:\n    ports:\n      - "${port}"\n`;
  const reasons = (path: string, text: string) =>
    findPublicPorts(path, text).map((f) => `${f.service}: ${f.reason}`);

  it('passes the committed compose/colo-public.yml', () => {
    const text = readFileSync(
      fileURLToPath(new URL('../../../compose/colo-public.yml', import.meta.url)),
      'utf8',
    );
    expect(findPublicPorts(PUBLIC_OVERLAY_PATH, text)).toEqual([]);
  });

  it('is an overlay for the colo rules', () => {
    expect(coloRole(PUBLIC_OVERLAY_PATH)).toBe('overlay');
  });

  it('allows the env-interpolated publish on velocity in that file', () => {
    expect(reasons(PUBLIC_OVERLAY_PATH, overlay('velocity', PUBLIC_OVERLAY_PORT))).toEqual([]);
  });

  it('rejects the same entry on another service in that file', () => {
    const found = reasons(PUBLIC_OVERLAY_PATH, overlay('paper', PUBLIC_OVERLAY_PORT));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((line) => line.startsWith('paper: '))).toBe(true);
    expect(found.join('\n')).toContain('uses interpolation');
  });

  it('rejects the same entry on velocity in any other file', () => {
    expect(reasons(COLO_PATH, overlay('velocity', PUBLIC_OVERLAY_PORT)).join('\n')).toContain(
      'uses interpolation',
    );
    expect(
      reasons('compose/nats-auth.yml', overlay('velocity', PUBLIC_OVERLAY_PORT)).join('\n'),
    ).toContain('uses interpolation');
  });

  it('rejects a literal 0.0.0.0, a different interpolation and an extra entry on velocity', () => {
    const literal = reasons(PUBLIC_OVERLAY_PATH, overlay('velocity', '0.0.0.0:8080:25565'));
    expect(literal).toEqual([expect.stringContaining('must start with 127.0.0.1:')]);
    const other = reasons(
      PUBLIC_OVERLAY_PATH,
      overlay('velocity', '${GELDAR_MC_BIND}:25565:25565'),
    );
    expect(other.join('\n')).toContain('uses interpolation');
    const two = `${overlay('velocity', PUBLIC_OVERLAY_PORT)}      - "0.0.0.0:1:1"\n`;
    expect(reasons(PUBLIC_OVERLAY_PATH, two)).toEqual([expect.stringContaining('must start with')]);
  });
});
