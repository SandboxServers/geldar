import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = readFileSync(resolve(repo, 'geldar.ps1'), 'utf8');

// A PowerShell 7 that can run the script. Without one the invocation tests are skipped, not passed.
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

/** Runs `pwsh -File geldar.ps1 <args>` from the repo root and returns the exit code and the output. */
function runScript(args: string[]): { status: number | null; output: string } {
  const run = spawnSync('pwsh', ['-NoProfile', '-File', resolve(repo, 'geldar.ps1'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

describe('geldar.ps1 reads its arguments from $args', () => {
  it('has no script-level param block, so PowerShell cannot bind -out or --out to a common parameter', () => {
    expect(script).not.toMatch(/^param\s*\(/m);
    expect(script).not.toMatch(/^\[CmdletBinding\(/m);
  });

  it('sets $Command and $Rest from $args, with help as the default command', () => {
    expect(script).toMatch(
      /^\$Command = if \(\$args\.Count -gt 0\) \{ \[string\] \$args\[0\] \} else \{ 'help' \}$/m,
    );
    expect(script).toMatch(/^\$Rest = \[string\[\]\] @\(\$args \| Select-Object -Skip 1\)$/m);
    expect(script.indexOf('$Command = if')).toBeLessThan(script.indexOf('switch ($Command)'));
  });

  it('prints a usage from Show-Usage that names every command of the dispatch switch', () => {
    const usage =
      /function Show-Usage \{\s*Write-Output @'\r?\n([\s\S]*?)\r?\n'@/.exec(script)?.[1] ?? '';
    expect(usage).toContain('Usage: ./geldar.ps1');
    const dispatch = script.slice(script.indexOf('switch ($Command) {'));
    const labels = [...dispatch.matchAll(/^ {2}'([a-z-]+)' \{/gm)].map((match) => match[1] ?? '');
    const commands = labels.filter((label) => !['help', '-h', '--help'].includes(label));
    expect(commands).toEqual(
      expect.arrayContaining(['players', 'mcp-tokens', 'db', 'setup', 'check', 'shard']),
    );
    for (const command of commands) {
      expect(usage, command).toMatch(new RegExp(`\\b${command}\\b`));
    }
  });
});

describe('geldar.ps1 shard secret files', () => {
  // The function body from its header up to the next top-level function, so the checks stay inside it.
  const body =
    /^function Initialize-ShardSecrets\(\[string\] \$Shard\) \{([\s\S]*?)^\}$/m.exec(script)?.[1] ?? '';
  const acl = /^function Set-OwnerOnlyAcl\(\[string\] \$Path\) \{([\s\S]*?)^\}$/m.exec(script)?.[1] ?? '';

  it('defines Set-OwnerOnlyAcl with inheritance off and the current account granted full control', () => {
    expect(acl).toMatch(/icacls \$Path \/inheritance:r \/grant:r "\$\{user\}:F"/);
    expect(acl).toMatch(/\$env:USERNAME/);
  });

  it('applies the owner-only ACL to each secret file, the new ones before the secret is written', () => {
    const calls = [...body.matchAll(/Set-OwnerOnlyAcl \$path/g)];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(body.indexOf('Set-OwnerOnlyAcl $path', body.indexOf('CreateNew'))).toBeGreaterThan(
      body.indexOf('CreateNew'),
    );
    expect(body.indexOf('Set-OwnerOnlyAcl $path', body.indexOf('CreateNew'))).toBeLessThan(
      body.indexOf('GetBytes($secret)'),
    );
  });
});

describe('geldar.ps1 mcp-tokens database environment', () => {
  // The case body from its label up to the next case, so the checks cannot match another command.
  const block = /^ {2}'mcp-tokens' \{([\s\S]*?)^ {2}'db' \{/m.exec(script)?.[1] ?? '';

  it('sets PGPASSWORD from compose/secrets/postgres.txt and the other PG* variables for the child only', () => {
    expect(block).toMatch(/Join-Path \$Root 'compose\/secrets\/postgres\.txt'/);
    expect(block).toMatch(/\$env:PGPASSWORD = \(Get-Content -Raw -Path \$passwordFile\)\.Trim\(\)/);
    for (const name of ['PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE']) {
      expect(block, name).toMatch(new RegExp(`\\$env:${name} = '[^']+'`));
    }
    expect(block).toMatch(/\$pgNames = 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD'/);
    expect(block).toMatch(
      /finally \{\s*foreach \(\$name in \$pgNames\) \{ \[Environment\]::SetEnvironmentVariable\(\$name, \$saved\[\$name\]\) \}\s*\}/,
    );
  });

  it('never prints the password', () => {
    expect(block).not.toMatch(/Write-(Host|Output)|\becho\b|Out-Host/);
  });
});

describe.skipIf(!hasPwsh)('geldar.ps1 invoked by pwsh', () => {
  it('prints the help and exits 0 when it has no arguments', () => {
    const { status, output } = runScript([]);
    expect(status).toBe(0);
    expect(output).toContain('geldar.ps1');
    expect(output).not.toMatch(/ambiguous/i);
  }, 60_000);

  it('passes --out through to the mcp-tokens CLI, which refuses a path inside the repo', () => {
    const out = resolve(repo, 'geldar-script-guard-probe.txt');
    const { status, output } = runScript([
      'mcp-tokens',
      'token',
      'mint',
      'ag-test-01',
      '--out',
      out,
    ]);
    expect(status).not.toBe(0);
    expect(output).not.toMatch(/ambiguous|cannot be found that matches/i);
    expect(output).toContain('--out must be outside the repo');
  }, 60_000);

  it('passes a single argument through to pnpm as one argument', () => {
    const { status, output } = runScript(['pnpm', '-v']);
    expect(status).toBe(0);
    expect(output).toMatch(/^\d+\.\d+\.\d+/m);
  }, 60_000);

  it('prints the usage with no arguments, and exits 0', () => {
    const { status, output } = runScript([]);
    expect(status).toBe(0);
    expect(output).toContain('Usage: ./geldar.ps1');
    for (const word of ['setup', 'check', 'shard', 'mcp-tokens']) {
      expect(output).toContain(word);
    }
  }, 60_000);

  it('prints an error and the usage for an unknown command, and exits non-zero', () => {
    const { status, output } = runScript(['no-such-command']);
    expect(status).not.toBe(0);
    expect(output).toContain("Unknown command 'no-such-command'");
    expect(output).toContain('Usage: ./geldar.ps1');
  }, 60_000);
});
