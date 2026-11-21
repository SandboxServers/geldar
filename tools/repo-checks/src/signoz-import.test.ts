// G1: the SigNoz import (deploy/signoz/import.sh, runbook docs/runbooks/signoz-import.md). Every dashboard and alert file
// must parse, every metric name they read must be one the repo emits, and the script may carry no URL, token or account
// literal beyond the loopback end of the SSH tunnel. The run tests execute the script under bash with a fake curl first
// on PATH, so no request ever leaves the test.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
 * Metric ids the repo emits: quoted geldar_ literals (double or single quotes) in the main sources of each Ledger plugin
 * directory under plugin/ (the ledger-core module holds Names.java) and in the golem metrics module. A prefix such as
 * "geldar_publisher_" ends in an underscore and is not a metric id, so the pattern requires a letter or digit last.
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
    for (const match of readFileSync(file, 'utf8').matchAll(
      /["'](geldar_[a-z0-9_]*[a-z0-9])["']/g,
    )) {
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

/** Metric names a file reads: every geldar_ name that appears in any string of its queries, upper case included. */
function metricNamesIn(name: string): string[] {
  return stringLeaves(readJson(name)).flatMap((text) => text.match(/geldar_[A-Za-z0-9_]+/g) ?? []);
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
    // A single-quoted literal in golem/src/metrics.ts: the scan must see both quote styles.
    expect(emitted.has('geldar_wakeups_total')).toBe(true);

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

/** Whether the run tests can run: the bash that runs the script must have jq and curl (on Windows that is WSL or Git Bash). */
const RUNNABLE =
  spawnSync('bash', ['-c', 'command -v jq >/dev/null && command -v curl >/dev/null'], {
    stdio: 'ignore',
  }).status === 0;

/** A path bash can open for a local path: on Windows bash is WSL or Git Bash, so ask it where the directory is. */
function bashPath(path: string): string {
  const out = spawnSync('bash', ['-c', 'pwd -P'], { cwd: dirname(path), encoding: 'utf8' });
  return `${out.stdout.trim()}/${basename(path)}`;
}

/** Runs import.sh through the runner that writeFakeCurl wrote: the fake curl directory is first on PATH. */
function runScript(work: string, args: string[]) {
  return spawnSync('bash', [bashPath(join(work, 'run.sh')), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

/**
 * Writes work/bin/curl, a fake curl that logs each call's arguments to work/curl.log and answers a GET with getBody,
 * and work/run.sh, which puts bin first on PATH and runs the real script. No quoting crosses the Node-to-bash boundary.
 */
function writeFakeCurl(work: string, getBody: string): void {
  const bin = join(work, 'bin');
  mkdirSync(bin);
  const log = bashPath(join(work, 'curl.log'));
  const curl = [
    '#!/usr/bin/env bash',
    `printf '%s\\n' "$*" >> '${log}'`,
    'case "$*" in',
    `  *'-X GET'*) printf '%s' '${getBody}' ;;`,
    'esac',
    '',
  ].join('\n');
  writeFileSync(join(bin, 'curl'), curl);
  chmodSync(join(bin, 'curl'), 0o755);
  const runner = [
    '#!/usr/bin/env bash',
    `PATH=${bashPath(bin)}:$PATH`,
    `exec bash ${bashPath(SCRIPT)} "$@"`,
    '',
  ].join('\n');
  writeFileSync(join(work, 'run.sh'), runner);
}

describe.skipIf(!RUNNABLE)('import.sh run (fake curl on PATH)', () => {
  let work = '';

  const setup = (getBody = '{"status":"success","data":[]}') => {
    writeFileSync(join(work, 'curl.log'), '');
    writeFakeCurl(work, getBody);
  };
  const readLog = () => readFileSync(join(work, 'curl.log'), 'utf8');

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'signoz-import-'));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('refuses a non-loopback --url in dry-run', () => {
    setup();
    // The documentation range, built at runtime so the script scan above never sees the literal.
    const url = `http://${['203', '0', '113', '5'].join('.')}:80`;
    const run = runScript(work, ['--dry-run', '--url', url]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/--url must be/);
    expect(readLog()).toBe('');
  });

  it('refuses a token file under the repo checkout before any request', () => {
    setup();
    const run = runScript(work, ['--token-file', bashPath(join(ROOT, 'package.json'))]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/outside the repo checkout/);
    expect(readLog()).toBe('');
  });

  it('dry-run against a loopback url makes zero curl calls', () => {
    setup();
    const run = runScript(work, ['--dry-run', '--url', 'http://127.0.0.1:8095']);
    expect(run.status).toBe(0);
    expect(readLog()).toBe('');
  });

  it('refuses a token file whose first line is empty before any request', () => {
    setup();
    writeFileSync(join(work, 'token.txt'), '\nfake-token-for-test\n');
    const run = runScript(work, ['--token-file', bashPath(join(work, 'token.txt'))]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/first line is empty/);
    expect(readLog()).toBe('');
  });

  it('a real run reads a list with no data key as empty, posts, and sends --noproxy on every call', () => {
    setup('{"status":"success"}');
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, ['--token-file', bashPath(join(work, 'token.txt'))]);
    expect(run.status).toBe(0);
    const calls = readLog()
      .split('\n')
      .filter((line) => line !== '');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((line) => /--noproxy \*/.test(line))).toBe(true);
    expect(readLog()).toMatch(/-X POST .*\/api\/v2\/dashboards\n/);
  });

  const PAPER = (readJson('paper-dashboard.json') as { title: string }).title;
  const PAPER_ID = '0c1f0000-0000-4000-8000-000000000001';

  /** A v2 list body: each item is [id, display name]. Titles hold no single quote, so the fake curl can print them. */
  const listBody = (items: [string, string][], total = items.length) =>
    JSON.stringify({
      status: 'success',
      data: {
        dashboards: items.map(([id, name]) => ({ id, name: 'x', spec: { display: { name } } })),
        total,
        tags: [],
        reservedKeywords: [],
      },
    });

  it('skips a dashboard whose title is already listed: no POST for it, and no PUT anywhere', () => {
    setup(listBody([[PAPER_ID, PAPER]]));
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, ['--token-file', bashPath(join(work, 'token.txt'))]);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/skipped dashboard "Geldar Paper"/);
    const log = readLog();
    expect(log).not.toMatch(/-X PUT/);
    expect(log).not.toMatch(/-X POST .*paper-dashboard\.json/);
    expect(log).toMatch(/-X POST .*neoforge-dashboard\.json.*\/api\/v2\/dashboards\n/);
  });

  it('with --replace, deletes the listed dashboard by id before posting it again, and never PUTs', () => {
    setup(listBody([[PAPER_ID, PAPER]]));
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, ['--token-file', bashPath(join(work, 'token.txt')), '--replace']);
    expect(run.status).toBe(0);
    const lines = readLog().split('\n');
    const del = lines.findIndex((l) =>
      new RegExp(`-X DELETE .*/api/v2/dashboards/${PAPER_ID}$`).test(l),
    );
    const post = lines.findIndex((l) =>
      /-X POST .*paper-dashboard\.json.*\/api\/v2\/dashboards$/.test(l),
    );
    expect(del).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(del);
    expect(readLog()).not.toMatch(/-X PUT/);
  });

  it('refuses a dashboard list that is not the v2 shape, before any write', () => {
    setup('{"status":"success","data":[{"id":"x","data":{"title":"Geldar Paper"}}]}');
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, ['--token-file', bashPath(join(work, 'token.txt'))]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/not the v2 shape/);
    expect(readLog()).not.toMatch(/-X (POST|PUT|DELETE)/);
  });

  it('refuses a title that two listed dashboards share, before any write', () => {
    setup(
      listBody([
        ['a', PAPER],
        ['b', PAPER],
      ]),
    );
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, ['--token-file', bashPath(join(work, 'token.txt'))]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/more than one dashboard titled/);
    expect(readLog()).not.toMatch(/-X (POST|PUT|DELETE)/);
  });

  it('pages the dashboard list until the total is reached', () => {
    // The fake server returns the same one-item page for every offset; total 2 means two page requests.
    setup(listBody([['c', 'Other']], 2));
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, ['--token-file', bashPath(join(work, 'token.txt'))]);
    expect(run.status).toBe(0);
    expect(readLog()).toMatch(/GET .*offset=0/);
    expect(readLog()).toMatch(/GET .*offset=1/);
  });

  it('without --dashboards-only the rules are still listed before any write', () => {
    setup('{"status":"success"}');
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, ['--token-file', bashPath(join(work, 'token.txt'))]);
    expect(run.status).toBe(0);
    expect(readLog()).toMatch(/-X GET .*\/api\/v1\/rules\n/);
    expect(run.stdout).not.toMatch(/alert rules skipped/);
  });

  it('--dashboards-only makes no rules or channel call, lists and posts the dashboards, and says the rules were skipped', () => {
    setup(listBody([]));
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, [
      '--token-file',
      bashPath(join(work, 'token.txt')),
      '--dashboards-only',
    ]);
    expect(run.status).toBe(0);
    const log = readLog();
    expect(log).not.toMatch(/\/api\/v1\/rules/);
    expect(log).not.toMatch(/channels/);
    expect(log).toMatch(/-X GET .*\/api\/v2\/dashboards\?limit=200&offset=0/);
    expect(log).toMatch(/-X POST .*paper-dashboard\.json.*\/api\/v2\/dashboards\n/);
    expect(log).toMatch(/-X POST .*neoforge-dashboard\.json.*\/api\/v2\/dashboards\n/);
    expect(run.stdout).toMatch(/alert rules skipped \(--dashboards-only\)/);
  });

  it('--dashboards-only skips a listed dashboard title (no --replace) and makes no rules call', () => {
    setup(listBody([[PAPER_ID, PAPER]]));
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, [
      '--token-file',
      bashPath(join(work, 'token.txt')),
      '--dashboards-only',
    ]);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/skipped dashboard "Geldar Paper"/);
    const log = readLog();
    expect(log).not.toMatch(/\/api\/v1\/rules|channels|-X (PUT|DELETE)/);
    expect(log).toMatch(/-X POST .*neoforge-dashboard\.json/);
  });

  it('--dashboards-only dry run makes zero calls (no rules, no channels) and names the skipped rules', () => {
    setup();
    const run = runScript(work, ['--dry-run', '--dashboards-only']);
    expect(run.status).toBe(0);
    expect(readLog()).toBe('');
    expect(run.stdout).toMatch(/dry-run: dashboard "Geldar Paper"/);
    expect(run.stdout).not.toMatch(/rule\(s\) from/);
    expect(run.stdout).toMatch(/alert rules skipped \(--dashboards-only\)/);
  });

  it('--dashboards-only still refuses a dashboard list that is not the v2 shape, before any write', () => {
    setup('{"status":"success","data":[{"id":"x"}]}');
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, [
      '--token-file',
      bashPath(join(work, 'token.txt')),
      '--dashboards-only',
    ]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/not the v2 shape/);
    expect(readLog()).not.toMatch(/-X (POST|PUT|DELETE)/);
  });

  it('--dashboards-only still refuses a title that two listed dashboards share, before any write', () => {
    setup(
      listBody([
        ['a', PAPER],
        ['b', PAPER],
      ]),
    );
    writeFileSync(join(work, 'token.txt'), 'fake-token-for-test\n');
    const run = runScript(work, [
      '--token-file',
      bashPath(join(work, 'token.txt')),
      '--dashboards-only',
    ]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/more than one dashboard titled/);
    expect(readLog()).not.toMatch(/-X (POST|PUT|DELETE)/);
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

  it('names the notification channel the alert files need, as a prerequisite', () => {
    expect(runbook).toMatch(/geldar-owner-channel/);
  });

  it('documents the dashboards-only run, the held alert import and the jq and curl check', () => {
    expect(runbook).toMatch(/--dashboards-only/);
    expect(runbook).toMatch(/command -v jq curl/);
    expect(runbook).toMatch(/HELD/);
  });
});
