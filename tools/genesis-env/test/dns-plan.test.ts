// Tests for tools/genesis-env/src/dns-plan.ts (spawned with a snapshot file; it never runs az) and for the
// dns_ttl_seconds schema rule (G2-06).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/validate.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PLAN = fileURLToPath(new URL('../src/dns-plan.ts', import.meta.url));
const SCHEMA = JSON.parse(
  readFileSync(join(ROOT, 'envs', 'environment.schema.json'), 'utf8'),
) as object;
const EXAMPLE = readFileSync(join(ROOT, 'envs', 'test.example.yaml'), 'utf8');
const BASE = EXAMPLE.endsWith('\n') ? EXAMPLE : `${EXAMPLE}\n`;
const ZONE = 'geldar.invalid';
const GROUP = 'rg-geldar-dns';
const ADDRESS = '192.0.2.10';

let dir: string;
let envDefault: string;
let envTtl600: string;
let snapshotEmpty: string;
let snapshotMatching: string;
let snapshotObject: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dns-plan-'));
  envDefault = join(dir, 'default.yaml');
  envTtl600 = join(dir, 'ttl600.yaml');
  snapshotEmpty = join(dir, 'empty.json');
  snapshotMatching = join(dir, 'matching.json');
  snapshotObject = join(dir, 'object.json');
  writeFileSync(envDefault, BASE);
  writeFileSync(envTtl600, `${BASE}dns_ttl_seconds: 600\n`);
  writeFileSync(snapshotEmpty, '[]');
  writeFileSync(
    snapshotMatching,
    JSON.stringify([
      { name: 'test', ttl: 300, aRecords: [{ ipv4Address: ADDRESS }] },
      { name: 'mcp.test', ttl: 300, aRecords: [{ ipv4Address: ADDRESS }] },
    ]),
  );
  writeFileSync(snapshotObject, '{"records":[]}');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function plan(env: string, snapshot: string, extra: string[] = []) {
  const args = [
    '--env',
    env,
    '--snapshot',
    snapshot,
    '--zone',
    ZONE,
    '--resource-group',
    GROUP,
    '--address',
    ADDRESS,
    ...extra,
  ];
  return spawnSync(process.execPath, [PLAN, ...args], { encoding: 'utf8', timeout: 30_000 });
}

describe('dns-plan.ts', () => {
  it('uses the 300 second default TTL when the definition sets none', () => {
    const r = plan(envDefault, snapshotEmpty);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('(ttl 300s)');
    expect(r.stdout).toContain('2 create, 0 update, 0 none');
    expect(r.stdout).toContain('--ttl 300');
  });

  it('takes dns_ttl_seconds from the definition when it is set', () => {
    const r = plan(envTtl600, snapshotEmpty);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('(ttl 600s)');
    expect(r.stdout).toContain('--ttl 600');
    expect(r.stdout).not.toContain('--ttl 300');
  });

  it('exits 0 and prints no az line when the zone already matches', () => {
    const r = plan(envDefault, snapshotMatching);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('0 create, 0 update, 2 none');
    expect(r.stdout).not.toContain('az network');
  });

  it('exits 1 with a clear message for a snapshot that is not an array', () => {
    const r = plan(envDefault, snapshotObject);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/snapshot is not an array/);
    expect(r.stdout + r.stderr).not.toMatch(/\n\s+at /);
  });

  it('exits 1 when a requested name is outside the zone the caller gave', () => {
    const r = spawnSync(
      process.execPath,
      [
        PLAN,
        '--env',
        envDefault,
        '--snapshot',
        snapshotEmpty,
        '--zone',
        'other.invalid',
        '--resource-group',
        GROUP,
        '--address',
        ADDRESS,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/outside zone other\.invalid/);
  });

  it('exits 1 for an address that is not IPv4, and prints no az line', () => {
    const r = plan(envDefault, snapshotEmpty, []);
    expect(r.status).toBe(0);
    const bad = spawnSync(
      process.execPath,
      [
        PLAN,
        '--env',
        envDefault,
        '--snapshot',
        snapshotEmpty,
        '--zone',
        ZONE,
        '--resource-group',
        GROUP,
        '--address',
        '192.0.2.1; x',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/IPv4/);
    expect(bad.stdout).not.toContain('az network');
  });

  it('exits 2 with usage and no stack trace for an unknown option', () => {
    const r = plan(envDefault, snapshotEmpty, ['--bogus', 'x']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('usage: dns-plan.ts');
    expect(r.stdout + r.stderr).not.toMatch(/\n\s+at /);
  });

  it('exits 2 with usage when a required argument is missing', () => {
    const r = spawnSync(process.execPath, [PLAN, '--env', envDefault], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('usage: dns-plan.ts');
  });
});

describe('dns_ttl_seconds in envs/environment.schema.json', () => {
  it.each([
    ['30', true],
    ['3600', true],
    ['29', false],
    ['3601', false],
    ['300.5', false],
  ])('dns_ttl_seconds %s is valid: %s', (value, valid) => {
    const problems = validateEnvironment(`${BASE}dns_ttl_seconds: ${value}\n`, 'test.yaml', SCHEMA);
    expect(problems.length === 0).toBe(valid);
    if (!valid) expect(problems.join('\n')).toContain('/dns_ttl_seconds');
  });
});
