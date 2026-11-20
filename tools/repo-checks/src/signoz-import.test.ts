// G1: the SigNoz import (deploy/signoz/import.sh, runbook docs/runbooks/signoz-import.md). Every dashboard and alert file
// must parse, every metric name they read must be one the repo emits, and the script may carry no URL, token or account
// literal beyond the loopback end of the SSH tunnel.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SIGNOZ = join(ROOT, 'deploy', 'signoz');
const SCRIPT = join(SIGNOZ, 'import.sh');
const RUNBOOK = join(ROOT, 'docs', 'runbooks', 'signoz-import.md');

const DASHBOARD_FILES = readdirSync(SIGNOZ)
  .filter((name) => /-dashboard\.json$/.test(name))
  .sort();
const ALERT_FILES = readdirSync(SIGNOZ)
  .filter((name) => /-alerts-.*\.json$/.test(name))
  .sort();

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/**
 * Metric ids the repo emits: quoted geldar_ literals in the main sources of each Ledger plugin directory under plugin/
 * (the ledger-core module holds Names.java) and in the golem metrics module. A prefix such as "geldar_publisher_" ends in
 * an underscore and is not a metric id, so the pattern requires a letter or digit last.
 */
function emittedMetricNames(): Set<string> {
  const pluginDirs = readdirSync(join(ROOT, 'plugin'))
    .filter((name) => name.startsWith('ledger'))
    .map((name) => join(ROOT, 'plugin', name, 'src', 'main'));
  const sources = [
    ...pluginDirs.flatMap((dir) => walk(dir)),
    join(ROOT, 'golem', 'src', 'metrics.ts'),
  ];
  const names = new Set<string>();
  for (const file of sources) {
    for (const match of readFileSync(file, 'utf8').matchAll(/"(geldar_[a-z0-9_]*[a-z0-9])"/g)) {
      names.add(match[1] as string);
    }
  }
  return names;
}

/** Every string leaf of a parsed JSON value. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value !== null && typeof value === 'object')
    return Object.values(value).flatMap(stringLeaves);
  return [];
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(SIGNOZ, name), 'utf8'));
}

/** Metric names a file reads: every geldar_ name that appears in any string of its queries. */
function metricNamesIn(name: string): string[] {
  return stringLeaves(readJson(name)).flatMap((text) => text.match(/geldar_[a-z0-9_]+/g) ?? []);
}

describe('SigNoz import files', () => {
  it('finds the dashboard and alert files the import covers', () => {
    expect(DASHBOARD_FILES).toEqual(['neoforge-dashboard.json', 'paper-dashboard.json']);
    expect(ALERT_FILES).toEqual([
      'neoforge-alerts-capacity.json',
      'neoforge-alerts-server.json',
      'paper-alerts-capacity.json',
      'paper-alerts-server.json',
    ]);
  });

  it.each(DASHBOARD_FILES)('%s parses and has a title', (name) => {
    const dashboard = readJson(name) as { title?: unknown };
    expect(typeof dashboard.title).toBe('string');
    expect(dashboard.title).not.toBe('');
  });

  it.each(ALERT_FILES)('%s parses and every rule has an alert name', (name) => {
    const file = readJson(name) as { rules?: { alert?: unknown }[] };
    expect(Array.isArray(file.rules)).toBe(true);
    for (const rule of file.rules ?? []) {
      expect(typeof rule.alert).toBe('string');
    }
  });

  it('reads only metric names the repo emits', () => {
    const emitted = emittedMetricNames();
    // Sanity: the scan finds the names the packet's dashboards depend on, so an empty scan cannot pass.
    expect(emitted.has('geldar_tps')).toBe(true);
    expect(emitted.has('geldar_mods_loaded')).toBe(true);

    const missing = [...DASHBOARD_FILES, ...ALERT_FILES].flatMap((name) =>
      metricNamesIn(name)
        .filter((metric) => !emitted.has(metric))
        .map((metric) => `${name}: ${metric}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('import.sh', () => {
  const script = readFileSync(SCRIPT, 'utf8');

  it('has no URL except the loopback tunnel end', () => {
    const urls = script.match(/https?:\/\/[^\s"'$)]+/g) ?? [];
    // The script's own loopback check is a regex, so 127.0.0.1 may appear with escaped dots.
    expect(urls.filter((url) => !/^http:\/\/127\\?\.0\\?\.0\\?\.1:/.test(url))).toEqual([]);
  });

  it('has no IPv4 literal except 127.0.0.1', () => {
    const addresses = script.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    expect(addresses.filter((address) => address !== '127.0.0.1')).toEqual([]);
  });

  it('has no token or account literal', () => {
    expect(script).not.toMatch(/Bearer [A-Za-z0-9._-]{8,}/);
    expect(script).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/);
  });

  it('has a dry-run flag and removes its temp dir on exit', () => {
    expect(script).toMatch(/--dry-run\)/);
    expect(script).toMatch(/mktemp -d/);
    expect(script).toMatch(/trap 'rm -rf "\$TMP"' EXIT/);
  });
});

describe('signoz-import runbook', () => {
  const runbook = readFileSync(RUNBOOK, 'utf8');

  it('gives the steps, the rollback and the data check', () => {
    expect(runbook).toMatch(/import\.sh/);
    expect(runbook).toMatch(/--dry-run/);
    expect(runbook).toMatch(/[Rr]ollback/);
    expect(runbook).toMatch(/show data|shows data|data check/i);
  });

  it('marks the unverified SigNoz routes as UNVERIFIED', () => {
    expect(runbook).toMatch(/UNVERIFIED/);
  });
});
