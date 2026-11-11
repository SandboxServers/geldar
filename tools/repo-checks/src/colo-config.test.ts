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
  it('has a per-service CPU and memory budget for all nine colo services', () => {
    const { services } = budgets();
    expect(services.sort()).toEqual(
      [
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

  it('sums to exactly 9 CPUs and 18944m, the orchestrator budget', () => {
    const { cpus, memMiB } = budgets();
    expect(cpus).toBe(9);
    expect(memMiB).toBe(18944);
  });
});

const hasPwsh =
  spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

/** The outcome of Read-ColoConfig on one file: the parsed hashtable, or the error message. */
interface Outcome {
  ok: boolean;
  value?: Record<string, string>;
  error?: string;
}

describe.skipIf(!hasPwsh)('geldar.ps1 colo config: Read-ColoConfig under pwsh', () => {
  let dir = '';
  const harness = join(tmpdir(), 'colo-config-harness.ps1');

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'colo-config-'));
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Set-StrictMode -Version Latest',
      `$Root = '${ROOT.replace(/\\$/, '').replaceAll("'", "''")}'`,
      READ,
      'try { ConvertTo-Json -Compress -InputObject @{ ok = $true; value = (Read-ColoConfig -Path $args[0]) } }',
      'catch { ConvertTo-Json -Compress -InputObject @{ ok = $false; error = $_.Exception.Message } }',
    ].join('\n');
    writeFileSync(harness, script, 'utf8');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(harness, { force: true });
  });

  function run(text: string | null, file = 'case.yaml'): Outcome {
    const path = text === null ? COLO_FILE : join(dir, file);
    if (text !== null) writeFileSync(path, text, 'utf8');
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, path], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    return JSON.parse(result.stdout.trim()) as Outcome;
  }

  const GOOD =
    'cpu_limit: 9\nmemory_limit: 18944m\nminecraft_port: 25567\nbind_address: 127.0.0.1\n';

  it('accepts the committed shards/colo.yaml and returns its values', () => {
    const outcome = run(null);
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toEqual({
      cpu_limit: '9',
      memory_limit: '18944m',
      minecraft_port: '25567',
      bind_address: '127.0.0.1',
    });
  });

  it('accepts comments, blank lines and a missing bind_address (loopback by default)', () => {
    const outcome = run(
      '# note\n\ncpu_limit: 9.5   # cores\nmemory_limit: 18944m\nminecraft_port: 25567\n',
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.value?.bind_address).toBe('127.0.0.1');
    expect(outcome.value?.cpu_limit).toBe('9.5');
  });

  it('refuses a memory total below Paper heap (6G) plus 1 GiB', () => {
    const outcome = run(GOOD.replace('16384m', '7000m'));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("below Paper's heap (6G) plus 1 GiB");
  });

  it('refuses a memory total below the sum of the per-service memory budgets', () => {
    const outcome = run(GOOD.replace('16384m', '8192m'));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('below the sum of the per-service memory budgets');
  });

  it('refuses a CPU total below the sum of the per-service CPU budgets', () => {
    const outcome = run(GOOD.replace('cpu_limit: 7.5', 'cpu_limit: 7'));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('below the sum of the per-service CPU budgets');
  });

  it('names an unknown key', () => {
    const outcome = run(`${GOOD}telemetry_urll: http://example.invalid\n`);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("unknown key 'telemetry_urll'");
  });

  it('refuses a missing cpu_limit and names it', () => {
    const outcome = run(GOOD.replace('cpu_limit: 7.5\n', ''));
    expect(outcome.error).toContain('cpu_limit is missing');
  });

  it('refuses a missing memory_limit and names it', () => {
    const outcome = run(GOOD.replace('memory_limit: 16384m\n', ''));
    expect(outcome.error).toContain('memory_limit is missing');
  });

  it('refuses 25565 and 25566 as the Minecraft port', () => {
    expect(run(GOOD.replace('25567', '25565')).error).toContain('minecraft_port 25565 is refused');
    expect(run(GOOD.replace('25567', '25566')).error).toContain('minecraft_port 25566 is refused');
  });

  it('refuses any other Minecraft port, because compose publishes the literal 25567', () => {
    expect(run(GOOD.replace('25567', '25570')).error).toContain('must be 25567');
  });

  it('refuses a non-loopback bind_address', () => {
    expect(run(GOOD.replace('127.0.0.1', '0.0.0.0')).error).toContain(
      'bind_address 0.0.0.0 is refused',
    );
  });

  it('refuses a cpu_limit of 0 and a memory_limit without a unit', () => {
    expect(run(GOOD.replace('cpu_limit: 7.5', 'cpu_limit: 0')).error).toContain('cpu_limit');
    expect(run(GOOD.replace('16384m', '16384')).error).toContain('memory_limit');
    expect(run(GOOD.replace('16384m', '8')).error).toContain('memory_limit');
  });
});
