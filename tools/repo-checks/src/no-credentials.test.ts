import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Files whose content is a fixture, not a credential: a URL with a fake password, asserted by the test. */
const FIXTURE_FILES = new Set(['golem/test/registry.test.ts']);

/** Tracked paths that must never be committed, whatever their content. */
const FORBIDDEN_PATHS = [
  /^compose\/secrets\//,
  /^compose\/nats-auth\.conf$/,
  /\.creds$/,
  /\.nk$/,
];

/** Content that is a credential: a private key, a NATS or URL password, or a NATS user with a password. */
const FORBIDDEN_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /nats:\/\/[^\s/:@]+:[^\s/@]+@/,
  /\bpass(word)?\s*[:=]\s*"[A-Za-z0-9_+/-]{16,}"/i,
  /^\s*(password|pass)\s*:\s*[A-Za-z0-9_+/-]{16,}\s*$/im,
];

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((path) => path.length > 0);
}

function textOf(path: string): string | null {
  const bytes = readFileSync(resolve(root, path));
  if (bytes.includes(0)) return null;
  return bytes.toString('utf8');
}

describe('committed files carry no credentials', () => {
  it('tracks no secret file or credentials file by path', () => {
    const found = trackedFiles().filter((path) => FORBIDDEN_PATHS.some((re) => re.test(path)));
    expect(found).toEqual([]);
  });

  it('tracks no file whose content is a private key or a password', () => {
    const offenders: string[] = [];
    for (const path of trackedFiles()) {
      if (FIXTURE_FILES.has(path)) continue;
      const text = textOf(path);
      if (text === null) continue;
      if (FORBIDDEN_CONTENT.some((re) => re.test(text))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the generated secrets directory out of git', () => {
    const ignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^compose\/secrets\/?$/m);
  });
});
