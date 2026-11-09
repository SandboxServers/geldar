import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
const realCompose = fileURLToPath(new URL('../../../compose/phase0.yml', import.meta.url));

/** The real compose file, with LF endings as git stores it. */
function realComposeText(): string {
  return readFileSync(realCompose, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Runs the repo-checks CLI, the same way `pnpm check:repo` does, inside a fresh
 * git repo whose only compose file is `compose/phase0.yml` with this text, plus
 * any `extra` files (path to text).
 */
function runCli(
  compose: string,
  extra: Record<string, string> = {},
): { status: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'repo-checks-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    mkdirSync(join(dir, 'compose'));
    writeFileSync(join(dir, 'compose', 'phase0.yml'), compose);
    for (const [path, text] of Object.entries(extra)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '-A'], { cwd: dir });
    try {
      const output = execFileSync(process.execPath, [cliPath], { cwd: dir, encoding: 'utf8' });
      return { status: 0, output };
    } catch (error) {
      const failed = error as { status: number; stdout: string };
      return { status: failed.status, output: failed.stdout };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('repo-checks CLI, compose port wiring', () => {
  it('passes the real compose/phase0.yml', () => {
    const result = runCli(realComposeText());
    expect(result.output).toContain('repo checks: ok');
    expect(result.status).toBe(0);
  });

  it('fails a bare port in the real compose/phase0.yml', () => {
    const text = realComposeText();
    const mutated = text.replace('"127.0.0.1:5432:5432"', '"5432:5432"');
    expect(mutated).not.toBe(text);
    const result = runCli(mutated);
    expect(result.status).toBe(1);
    expect(result.output).toContain('service postgres');
  });

  it('fails network_mode: host in the real compose/phase0.yml', () => {
    const text = realComposeText();
    const mutated = text.replace('  nats:\n', '  nats:\n    network_mode: host\n');
    expect(mutated).not.toBe(text);
    const result = runCli(mutated);
    expect(result.status).toBe(1);
    expect(result.output).toContain('service nats');
  });
});

describe('repo-checks CLI, decision index wiring', () => {
  it('fails a decision record that docs/decisions/README.md does not list', () => {
    const result = runCli(realComposeText(), {
      'docs/decisions/0001-contract.md': '# 0001. Contract\n',
      'docs/decisions/README.md': '# Decisions\n',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not list 0001-contract.md');
  });
});
