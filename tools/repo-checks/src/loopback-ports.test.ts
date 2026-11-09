import { describe, expect, it } from 'vitest';
import { findPublicPorts, isComposeFile } from './loopback-ports.ts';

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
