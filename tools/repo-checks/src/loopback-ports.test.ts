import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLO_PATH, findPublicPorts, isComposeFile } from './loopback-ports.ts';

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
    expect(coloProblems(text)).toEqual([
      'paper: has no deploy.resources.limits with cpus and memory; every colo service needs one',
      'nats: has no deploy.resources.limits with cpus and memory; every colo service needs one',
    ]);
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
      '    ports: ["127.0.0.1:25567:25565"]',
    ].join('\n');
    expect(coloProblems(text)).toEqual([]);
  });

  it('applies the colo rules to colo only: phase0 keeps its published 25565 for velocity', () => {
    const text = 'services:\n  velocity:\n    ports: ["127.0.0.1:25565:25565"]';
    expect(findPublicPorts('compose/phase0.yml', text)).toEqual([]);
  });
});
