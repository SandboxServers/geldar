/**
 * deploy/README.md names every top-level secret file that compose/colo.yml declares. The deploy checks every top-level
 * secret (check_secrets in deploy/common.sh), including the ones behind a profile, so a README that omits one would
 * leave the operator unable to tell why the deploy refuses to start. The test reads the file name of each secret.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const readRepo = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** The file name (basename) of each top-level secret that has a file in compose/colo.yml. */
function composeSecretFiles(composeText: string): string[] {
  const parsed = parse(composeText) as { secrets?: Record<string, { file?: unknown }> };
  const names: string[] = [];
  for (const secret of Object.values(parsed.secrets ?? {})) {
    if (typeof secret.file !== 'string') continue;
    names.push(secret.file.split('/').pop() ?? secret.file);
  }
  return names;
}

/** The secret file names the README omits (not written in backticks). */
function omittedFromReadme(readme: string, names: string[]): string[] {
  return names.filter((name) => !readme.includes(`\`${name}\``));
}

describe('deploy/README.md secret list against compose/colo.yml', () => {
  const composeText = readRepo('compose/colo.yml');
  const readme = readRepo('deploy/README.md');

  it('reads a non-empty list of top-level secret files from compose', () => {
    expect(composeSecretFiles(composeText).length).toBeGreaterThan(0);
  });

  it('names every top-level compose secret file, the C7-03b2 supervisor and register NATS files included', () => {
    expect(omittedFromReadme(readme, composeSecretFiles(composeText))).toEqual([]);
    for (const name of ['postgres-supervisor.txt', 'nats-supervisor.txt', 'nats-register.txt']) {
      expect(readme, name).toContain(`\`${name}\``);
    }
  });

  it('fails with the omitted name when a top-level secret is missing from the README', () => {
    const withExtra = composeText.replace(
      '\nsecrets:\n',
      '\nsecrets:\n  made-up-secret:\n    file: ./secrets/made-up-secret.txt\n',
    );
    expect(withExtra).not.toBe(composeText);
    expect(omittedFromReadme(readme, composeSecretFiles(withExtra))).toEqual([
      'made-up-secret.txt',
    ]);
  });
});
