/**
 * deploy/colo-supervisor.sh checked against the supervisor service in compose/colo.yml (C7-03b2). The script's docker
 * create must pass the same environment names and values, the same labels and the same log options as the compose
 * service, so the two cannot drift apart unnoticed. The runbook (docs/runbooks/supervisor-node-steps.md) must carry its
 * rollback lines and the rule that the desktop never runs the shard NATS auth command.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const readRepo = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

interface ComposeService {
  environment?: Record<string, unknown>;
  labels?: Record<string, unknown> | string[];
  logging?: { driver?: string; options?: Record<string, unknown> };
}

function supervisorService(): ComposeService {
  const parsed = parse(readRepo('compose/colo.yml')) as {
    services?: Record<string, ComposeService>;
  };
  const service = parsed.services?.supervisor;
  if (!service) throw new Error('compose/colo.yml has no supervisor service');
  return service;
}

/** The script's text with the comment lines removed, so only the docker create flags are read. */
function scriptCode(): string {
  return readRepo('deploy/colo-supervisor.sh')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

/** Every "--FLAG NAME=VALUE" pair in the script, as a map from NAME to VALUE. */
function scriptPairs(flag: string): Map<string, string> {
  const pairs = new Map<string, string>();
  const pattern = new RegExp(`--${flag} ([^\\s=]+)=(\\S+)`, 'g');
  for (const match of scriptCode().matchAll(pattern)) {
    const [, key, value] = match;
    if (key === undefined || value === undefined) throw new Error(`cannot read --${flag}`);
    pairs.set(key, value);
  }
  return pairs;
}

/** A compose mapping (object or list of "k=v") as a plain map of string values. */
function asMap(value: Record<string, unknown> | string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const at = entry.indexOf('=');
      map.set(entry.slice(0, at), entry.slice(at + 1));
    }
    return map;
  }
  for (const [key, val] of Object.entries(value ?? {})) map.set(key, String(val));
  return map;
}

function sorted(map: Map<string, string>): [string, string][] {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

describe('deploy/colo-supervisor.sh against the compose supervisor service (C7-03b2)', () => {
  it('passes the same environment names and values as compose', () => {
    const compose = asMap(supervisorService().environment);
    expect(compose.size).toBeGreaterThan(0);
    expect(sorted(scriptPairs('env'))).toEqual(sorted(compose));
  });

  it('passes the same labels as compose', () => {
    const compose = asMap(supervisorService().labels);
    expect(compose.size).toBeGreaterThan(0);
    expect(sorted(scriptPairs('label'))).toEqual(sorted(compose));
  });

  it('passes the same log driver and log options as compose', () => {
    const logging = supervisorService().logging;
    expect(logging?.driver).toBe('json-file');
    expect(scriptCode()).toContain(`--log-driver ${logging?.driver ?? ''}`);
    expect(sorted(scriptPairs('log-opt'))).toEqual(sorted(asMap(logging?.options)));
  });
});

describe('docs/runbooks/supervisor-node-steps.md (C7-03b2)', () => {
  const runbook = readRepo('docs/runbooks/supervisor-node-steps.md');

  it('carries the rollback lines: stop and remove the one container, never a network or compose', () => {
    expect(runbook).toContain('docker stop geldar-colo-supervisor');
    expect(runbook).toContain('docker rm geldar-colo-supervisor');
    expect(runbook).toContain('Never a network remove');
    expect(runbook).toContain('Never a restart');
  });

  it('says the desktop never runs the shard NATS auth command', () => {
    expect(runbook).toContain('Never run `./geldar.ps1 shard nats-auth colo` on the desktop');
  });

  it('names the owner uid variable the script and compose read, and no other', () => {
    expect(runbook).toContain('GELDAR_SERVICE_UID');
    expect(runbook).not.toContain('GELDAR_SUPERVISOR_UID');
  });
});
