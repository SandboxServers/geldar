/**
 * The colo NATS auth wiring, read from the compose YAML and geldar.ps1 without docker (decision 0087). Split from
 * nats-auth.test.ts to keep each file under the line cap.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = readFileSync(join(ROOT, 'geldar.ps1'), 'utf8');

/** The text of one top-level PowerShell function, from its keyword to the next top-level function. */
function functionBody(name: string): string {
  const start = SCRIPT.indexOf(`function ${name}`);
  if (start < 0) return '';
  const next = SCRIPT.indexOf('\nfunction ', start + 1);
  return SCRIPT.slice(start, next < 0 ? undefined : next);
}

/** The subset of a compose service this file reads: environment (map or KEY=VALUE list) and secrets (short or long). */
interface ServiceDoc {
  environment?: Record<string, string> | string[];
  secrets?: (string | { source?: string; target?: string })[];
}

/** The environment of one service as a map. */
function envMap(env: ServiceDoc['environment']): Record<string, string> {
  if (!env) return {};
  if (!Array.isArray(env)) return env;
  return Object.fromEntries(
    env.map((entry) => {
      const cut = entry.indexOf('=');
      return cut < 0 ? [entry, ''] : [entry.slice(0, cut), entry.slice(cut + 1)];
    }),
  );
}

/** Where compose mounts one secret: a short entry at /run/secrets/<name>, a long one at its target (relative or absolute). */
function mountOf(s: string | { source?: string; target?: string }): string {
  if (typeof s === 'string') return `/run/secrets/${s}`;
  const name = s.target ?? s.source ?? '';
  return name.startsWith('/') ? name : `/run/secrets/${name}`;
}

/**
 * The services of the given compose files, merged the way `docker compose -f a -f b` merges an overlay: environment keys
 * and secret entries accumulate per service. Read from the YAML files, so no docker is needed.
 */
function mergeComposeFiles(
  ...files: string[]
): Record<string, { env: Record<string, string>; mounts: string[] }> {
  const out: Record<string, { env: Record<string, string>; mounts: string[] }> = {};
  for (const file of files) {
    const doc = parse(readFileSync(join(ROOT, 'compose', file), 'utf8')) as {
      services?: Record<string, ServiceDoc>;
    };
    for (const [name, svc] of Object.entries(doc.services ?? {})) {
      const cur = out[name] ?? { env: {}, mounts: [] };
      Object.assign(cur.env, envMap(svc.environment));
      cur.mounts.push(...(svc.secrets ?? []).map(mountOf));
      out[name] = cur;
    }
  }
  return out;
}

describe('colo NATS auth wiring, static (no docker needed)', () => {
  it('points every NATS password file in colo.yml merged with nats-auth.yml at a secret the service mounts', () => {
    const services = mergeComposeFiles('colo.yml', 'nats-auth.yml');
    const named = Object.entries(services).filter(([, s]) => s.env.GELDAR_NATS_PASSWORD_FILE);
    // Names only: a failing expect prints the service names, never a value.
    expect(named.map(([n]) => n)).toEqual(
      expect.arrayContaining(['golem-body', 'animus', 'paper', 'velocity', 'eventsink']),
    );
    const gaps = named
      .filter(([, s]) => !s.mounts.includes(s.env.GELDAR_NATS_PASSWORD_FILE ?? ''))
      .map(([n]) => n);
    expect(gaps).toEqual([]);
  });

  it('gives animus the mind user and a password file mounted from the nats-mind secret', () => {
    const animus = mergeComposeFiles('colo.yml').animus;
    expect(animus?.env.GELDAR_NATS_USER).toBe('mind');
    expect(animus?.env.GELDAR_NATS_URL).toBe('nats://nats:4222');
    expect(animus?.mounts).toContain('/run/secrets/nats-mind.txt');
  });

  it('merges nats-auth.yml into `shard up colo` in Invoke-Shard', () => {
    const invoke = functionBody('Invoke-Shard');
    expect(invoke).toMatch(
      /if \(\$shard -eq 'colo' -and \$action -eq 'up'\) \{ \$files \+= @\('-f', \(Join-Path \$Root 'compose\/nats-auth\.yml'\)\) \}/,
    );
  });
});
