import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const schema = JSON.parse(
  readFileSync(join(root, 'envs', 'environment.schema.json'), 'utf8'),
) as object;
const example = readFileSync(join(root, 'envs', 'test.example.yaml'), 'utf8');

/** One line of the valid example, replaced; the test fails loudly if the line moved. */
function mutate(from: string, to: string): string {
  if (!example.includes(from)) throw new Error(`fixture line not found: ${from}`);
  return example.replace(from, to);
}

function problemsOf(text: string): string {
  return validateEnvironment(text, 'envs/fixture.yaml', schema).join('\n');
}

// Built from parts so this file holds no key-shaped text for the repo's credential scan.
const PEM_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const GITHUB_TOKEN = `ghp${'_'}${'A'.repeat(36)}`;

describe('envs/test.example.yaml', () => {
  it('a valid environment passes', () => {
    expect(validateEnvironment(example, 'envs/test.example.yaml', schema)).toEqual([]);
  });

  it('refuses the kill switch set to false', () => {
    const problems = problemsOf(
      mutate('register_kill_switch: true', 'register_kill_switch: false'),
    );
    expect(problems).toContain('/register_kill_switch fails const');
  });

  it('refuses supervisor_enabled true with no supervisor_live_check', () => {
    const problems = problemsOf(mutate('supervisor_enabled: false', 'supervisor_enabled: true'));
    expect(problems).toContain('(document) fails required');
  });

  it('accepts supervisor_enabled true when a live check names a record', () => {
    const text = mutate(
      'supervisor_enabled: false',
      'supervisor_enabled: true\nsupervisor_live_check: C7-03b4-live-2026-11-01',
    );
    expect(problemsOf(text)).toBe('');
  });

  it('refuses an IPv4 address other than 127.0.0.1', () => {
    const text = mutate(
      'register_public_url: https://register.test.geldar.invalid',
      'register_public_url: https://203.0.113.7',
    );
    expect(problemsOf(text)).toContain(
      'an IPv4 address other than 127.0.0.1 found; the value is not shown',
    );
  });

  it('allows 127.0.0.1 as an address', () => {
    const text = mutate(
      'register_public_url: https://register.test.geldar.invalid',
      'register_public_url: https://127.0.0.1:8443',
    );
    expect(problemsOf(text)).toBe('');
  });

  it('refuses a subnet that is not one of the RFC 5737 documentation /24s', () => {
    const problems = problemsOf(mutate('subnet: 198.51.100.0/24', 'subnet: a-named-network'));
    expect(problems).toContain('/subnet fails pattern');
    expect(problems).not.toContain('an IPv4 address other than 127.0.0.1');
  });

  it('refuses a key-shaped value', () => {
    const pem = mutate(
      'register_trusted_peers: []',
      `register_trusted_peers:\n  - "${PEM_HEADER}"`,
    );
    const token = mutate(
      'register_trusted_peers: []',
      `register_trusted_peers:\n  - "${GITHUB_TOKEN}"`,
    );
    expect(problemsOf(pem)).toContain('a PEM key block found');
    expect(problemsOf(token)).toContain('a service token found');
  });

  it('refuses an account name written as an email address', () => {
    const text = mutate(
      'backup_destination: test-offsite',
      'backup_destination: owner@example.invalid',
    );
    expect(problemsOf(text)).toContain('an email address (an account name) found');
  });

  it('refuses an unknown field', () => {
    const text = `${example}extra_field: value\n`;
    expect(problemsOf(text)).toContain('(document) fails additionalProperties');
  });

  it('refuses a duplicate key', () => {
    const text = `${example}name: again\n`;
    expect(problemsOf(text)).toContain('YAML does not parse (DUPLICATE_KEY)');
  });
});
