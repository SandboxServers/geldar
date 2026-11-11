/**
 * The colo shard config (shards/colo.yaml) and the geldar.ps1 code that reads it. The static part always runs: it
 * checks where the function sits and who calls it. The behaviour part runs the real Read-ColoConfig under pwsh when
 * pwsh is on PATH, and skips otherwise.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = readFileSync(join(ROOT, 'geldar.ps1'), 'utf8');
const COLO_FILE = join(ROOT, 'shards', 'colo.yaml');

/** The text of one top-level PowerShell function, from its keyword to the next top-level function. */
function functionBody(name: string): string {
  const start = SCRIPT.indexOf(`function ${name}`);
  if (start < 0) return '';
  const next = SCRIPT.indexOf('\nfunction ', start + 1);
  return SCRIPT.slice(start, next < 0 ? undefined : next);
}

const READ = functionBody('Read-ColoConfig');

describe('geldar.ps1 colo config: static wiring', () => {
  it('defines Read-ColoConfig before Invoke-Check', () => {
    expect(READ).not.toBe('');
    expect(SCRIPT.indexOf('function Read-ColoConfig')).toBeLessThan(
      SCRIPT.indexOf('function Invoke-Check'),
    );
  });

  it('is called from Invoke-Check, so check validates the colo config', () => {
    expect(functionBody('Invoke-Check')).toMatch(/\$null = Read-ColoConfig/);
  });

  it('is called from Invoke-Shard up for colo, before anything starts', () => {
    const shard = functionBody('Invoke-Shard');
    expect(shard).toMatch(/if \(\$shard -eq 'colo'\) \{[\s\S]*\$null = Read-ColoConfig/);
    expect(shard.indexOf('$null = Read-ColoConfig')).toBeLessThan(
      shard.indexOf('start shard $shard'),
    );
  });

  it('no longer exports the limits: compose/colo.yml holds the per-service budgets as literals', () => {
    expect(SCRIPT).not.toContain('GELDAR_COLO_CPU_LIMIT');
    expect(SCRIPT).not.toContain('GELDAR_COLO_MEMORY_LIMIT');
    expect(READ).toContain('$paperHeapMiB + 1024');
  });

  it('names the reserved ports and the loopback rule in the function', () => {
    expect(READ).toContain("'25565', '25566'");
    expect(READ).toContain("-ne '127.0.0.1'");
  });

  it('keeps Paper heap in step: compose sets MEMORY 6G, the value the function floors the total on', () => {
    const compose = readFileSync(join(ROOT, 'compose', 'colo.yml'), 'utf8');
    expect(compose).toMatch(/MEMORY: 6G\n/);
    expect(READ).toContain('$paperHeapMiB = 6144');
  });
});

/** The per-service budgets literal in compose/colo.yml, and the totals in shards/colo.yaml, read without pwsh. */
function budgets(): { cpus: number; memMiB: number; services: string[] } {
  const compose = readFileSync(join(ROOT, 'compose', 'colo.yml'), 'utf8');
  // memory and memswap_limit both read _MEM, so each service's CPUS and MEM is counted once, at its first reference.
  const services = new Set<string>();
  const cpuSeen = new Set<string>();
  const memSeen = new Set<string>();
  let cpus = 0;
  let memMiB = 0;
  for (const match of compose.matchAll(/GELDAR_COLO_([A-Z_]+)_(CPUS|MEM):-([0-9.]+[mg]?)\}/g)) {
    const service = match[1] ?? '';
    services.add(service);
    const value = match[3] ?? '';
    if (match[2] === 'CPUS') {
      if (!cpuSeen.has(service)) {
        cpuSeen.add(service);
        cpus += Number(value);
      }
    } else if (!memSeen.has(service)) {
      memSeen.add(service);
      memMiB += value.endsWith('g')
        ? Number(value.slice(0, -1)) * 1024
        : Number(value.slice(0, -1));
    }
  }
  return { cpus, memMiB, services: [...services] };
}

describe('shards/colo.yaml: the total covers the per-service budgets (always checked)', () => {
  it('has a per-service CPU and memory budget for all ten colo services', () => {
    const { services } = budgets();
    expect(services.sort()).toEqual(
      [
        'ADMIN',
        'ANIMUS',
        'EVENTSINK',
        'GELDAR_MCP',
        'GOLEM_BODY',
        'NATS',
        'PAPER',
        'PLAYERS_HOST',
        'POSTGRES',
        'VELOCITY',
      ].sort(),
    );
  });

  it('sets cpu_limit and memory_limit to at least the sum of the per-service budgets', () => {
    const shard = readFileSync(COLO_FILE, 'utf8');
    const cpuTotal = Number(/^cpu_limit:\s*([0-9.]+)/m.exec(shard)?.[1]);
    const memTotal = /^memory_limit:\s*(\d+)m/m.exec(shard)?.[1];
    const { cpus, memMiB } = budgets();
    expect(cpuTotal).toBeGreaterThanOrEqual(cpus);
    expect(Number(memTotal)).toBeGreaterThanOrEqual(memMiB);
  });

  it('sums to exactly 9.5 CPUs and 19456m, the orchestrator budget', () => {
    const { cpus, memMiB } = budgets();
    expect(cpus).toBe(9.5);
    expect(memMiB).toBe(19456);
  });
});

const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

/**
 * Read-ColoConfig has no TypeScript equivalent, so it runs under pwsh. pwsh starts ONCE for the whole file: the
 * harness takes a manifest of config files and prints one outcome per file. Each `it` below asserts on its own outcome.
 */
const GOOD =
  'cpu_limit: 9.5\nmemory_limit: 19456m\nminecraft_port: 25567\nbind_address: 127.0.0.1\n';

/** Case id to config text; null means the committed shards/colo.yaml. */
const CASES: Record<string, string | null> = {
  committed: null,
  comments: '# note\n\ncpu_limit: 9.5   # cores\nmemory_limit: 19456m\nminecraft_port: 25567\n',
  heap: GOOD.replace('19456m', '7000m'),
  memSum: GOOD.replace('19456m', '8192m'),
  cpuSum: GOOD.replace('cpu_limit: 9.5\n', 'cpu_limit: 8\n'),
  unknownKey: `${GOOD}telemetry_urll: http://example.invalid\n`,
  noCpu: GOOD.replace('cpu_limit: 9.5\n', ''),
  noMem: GOOD.replace('memory_limit: 19456m\n', ''),
  port25565: GOOD.replace('25567', '25565'),
  port25566: GOOD.replace('25567', '25566'),
  port25570: GOOD.replace('25567', '25570'),
  bind: GOOD.replace('127.0.0.1', '0.0.0.0'),
  cpuZero: GOOD.replace('cpu_limit: 9.5', 'cpu_limit: 0'),
  memNoUnit: GOOD.replace('19456m', '19456'),
  memTiny: GOOD.replace('19456m', '8'),
};

/** The outcome of Read-ColoConfig on one file: the parsed hashtable, or the error message. */
interface Outcome {
  ok: boolean;
  value?: Record<string, string>;
  error?: string;
}

describe.skipIf(!hasPwsh)('geldar.ps1 colo config: Read-ColoConfig under pwsh', () => {
  let dir = '';
  const outcomes: Record<string, Outcome> = {};

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'colo-config-'));
    const harness = join(dir, 'harness.ps1');
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Set-StrictMode -Version Latest',
      `$Root = '${ROOT.replace(/\\$/, '').replaceAll("'", "''")}'`,
      READ,
      '$manifest = Get-Content -Raw -LiteralPath $args[0] | ConvertFrom-Json',
      '$results = @()',
      'foreach ($case in $manifest) {',
      '  try { $results += @{ id = $case.id; ok = $true; value = (Read-ColoConfig -Path $case.path) } }',
      '  catch { $results += @{ id = $case.id; ok = $false; error = $_.Exception.Message } }',
      '}',
      'ConvertTo-Json -Compress -InputObject @($results)',
    ].join('\n');
    writeFileSync(harness, script, 'utf8');
    const manifest = Object.entries(CASES).map(([id, text]) => {
      const path = join(dir, `${id}.yaml`);
      if (text !== null) writeFileSync(path, text, 'utf8');
      return { id, path: text === null ? COLO_FILE : path };
    });
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    const result = spawnSync(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-File', harness, manifestPath],
      { encoding: 'utf8' },
    );
    expect(result.stderr).toBe('');
    for (const entry of JSON.parse(result.stdout.trim()) as (Outcome & { id: string })[]) {
      outcomes[entry.id] = entry;
    }
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function outcome(id: string): Outcome {
    const found = outcomes[id];
    if (!found) throw new Error(`no outcome for case ${id}`);
    return found;
  }

  it('accepts the committed shards/colo.yaml and returns its values', () => {
    const result = outcome('committed');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      cpu_limit: '9.5',
      memory_limit: '19456m',
      minecraft_port: '25567',
      bind_address: '127.0.0.1',
    });
  });

  it('accepts comments, blank lines and a missing bind_address (loopback by default)', () => {
    const result = outcome('comments');
    expect(result.ok).toBe(true);
    expect(result.value?.bind_address).toBe('127.0.0.1');
    expect(result.value?.cpu_limit).toBe('9.5');
  });

  it('refuses a memory total below Paper heap (6G) plus 1 GiB', () => {
    const result = outcome('heap');
    expect(result.ok).toBe(false);
    expect(result.error).toContain("below Paper's heap (6G) plus 1 GiB");
  });

  it('refuses a memory total below the sum of the per-service memory budgets', () => {
    const result = outcome('memSum');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('below the sum of the per-service memory budgets');
  });

  it('refuses a CPU total below the sum of the per-service CPU budgets', () => {
    const result = outcome('cpuSum');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('below the sum of the per-service CPU budgets');
  });

  it('names an unknown key', () => {
    const result = outcome('unknownKey');
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unknown key 'telemetry_urll'");
  });

  it('refuses a missing cpu_limit and names it', () => {
    expect(outcome('noCpu').error).toContain('cpu_limit is missing');
  });

  it('refuses a missing memory_limit and names it', () => {
    expect(outcome('noMem').error).toContain('memory_limit is missing');
  });

  it('refuses 25565 and 25566 as the Minecraft port', () => {
    expect(outcome('port25565').error).toContain('minecraft_port 25565 is refused');
    expect(outcome('port25566').error).toContain('minecraft_port 25566 is refused');
  });

  it('refuses any other Minecraft port, because compose publishes the literal 25567', () => {
    expect(outcome('port25570').error).toContain('must be 25567');
  });

  it('refuses a non-loopback bind_address', () => {
    expect(outcome('bind').error).toContain('bind_address 0.0.0.0 is refused');
  });

  it('refuses a cpu_limit of 0 and a memory_limit without a unit', () => {
    expect(outcome('cpuZero').error).toContain('cpu_limit');
    expect(outcome('memNoUnit').error).toContain('memory_limit');
    expect(outcome('memTiny').error).toContain('memory_limit');
  });
});
