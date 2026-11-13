import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyIpv4, findIpLiterals, isIpScanned, parseIpAllowlist } from './ip-literals.ts';

/**
 * Dotted quads are built from octets so that this file holds no literal address
 * for the check to read; the strings are the same at run time.
 */
const ip = (...octets: number[]): string => octets.join('.');

const realAllowlist = new Set(
  parseIpAllowlist(
    readFileSync(fileURLToPath(new URL('./ip-literal-allowlist.json', import.meta.url)), 'utf8'),
    'ip-literal-allowlist.json',
  ).paths,
);

const PRIVATE_PATH = 'threshold/mcp/src/config.ts';

describe('findIpLiterals', () => {
  it('allows loopback, 0.0.0.0 and the RFC 5737 documentation ranges in any file', () => {
    const text = [
      `host ${ip(127, 0, 0, 1)}`,
      `bind ${ip(0, 0, 0, 0)}`,
      `doc ${ip(203, 0, 113, 7)} ${ip(192, 0, 2, 1)} ${ip(198, 51, 100, 2)}`,
    ].join('\n');
    expect(findIpLiterals('docs/any.md', text, new Set())).toEqual([]);
  });

  it('allows a private literal in an allowlisted file', () => {
    expect(findIpLiterals(PRIVATE_PATH, `cidr ${ip(10, 0, 0, 5)}/8`, realAllowlist)).toEqual([]);
  });

  it('fails a private literal in a file that is not on the allowlist, by path and line', () => {
    const text = ['// header', `const host = '${ip(192, 168, 1, 20)}';`].join('\n');
    const findings = findIpLiterals('golem/src/new-thing.ts', text, realAllowlist);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^golem\/src\/new-thing\.ts:2: private IPv4 literal/);
    expect(findings[0]).not.toContain('192.168');
  });

  it('fails a public literal in any file, allowlisted or not, and names only the class', () => {
    const public8 = ip(8, 8, 8, 8);
    const findings = findIpLiterals(PRIVATE_PATH, `resolver ${public8}`, realAllowlist);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^threshold\/mcp\/src\/config\.ts:1: public IPv4 literal/);
    expect(findings[0]).not.toContain(public8);
  });

  it('ignores a version string in a version field', () => {
    const text = ['{', `  "version": "${ip(1, 2, 3, 4)}",`, '}'].join('\n');
    expect(findIpLiterals('tools/glass-ctl/package.json', text, new Set())).toEqual([]);
  });

  it('ignores a dotted quad whose octet is 256', () => {
    expect(findIpLiterals('docs/x.md', `bad ${ip(8, 8, 8, 256)}`, new Set())).toEqual([]);
    expect(findIpLiterals('docs/x.md', `bad ${ip(256, 1, 1, 1)}`, new Set())).toEqual([]);
  });

  it('ignores a five-part dotted number', () => {
    expect(findIpLiterals('docs/x.md', `id ${ip(8, 8, 8, 8, 8)}`, new Set())).toEqual([]);
    expect(findIpLiterals('docs/x.md', `id ${ip(10, 0, 0, 5, 1)}`, new Set())).toEqual([]);
  });

  it('reports each line that holds a public literal', () => {
    const text = ['ok', ip(127, 0, 0, 1), ip(8, 8, 4, 4), 'end'].join('\n');
    expect(findIpLiterals('docs/x.md', text, new Set())).toEqual([
      expect.stringMatching(/^docs\/x\.md:3: public IPv4 literal/),
    ]);
  });

  it('skips a path that is excluded from the scan', () => {
    const text = `pin ${ip(8, 8, 8, 8)}`;
    expect(findIpLiterals('pnpm-lock.yaml', text, new Set())).toEqual([]);
  });
});

describe('classifyIpv4', () => {
  it('classes each range the policy names', () => {
    expect(classifyIpv4(ip(127, 255, 0, 1))).toBe('anywhere');
    expect(classifyIpv4(ip(0, 0, 0, 0))).toBe('anywhere');
    expect(classifyIpv4(ip(198, 51, 100, 9))).toBe('anywhere');
    expect(classifyIpv4(ip(172, 16, 0, 1))).toBe('private');
    expect(classifyIpv4(ip(172, 31, 255, 1))).toBe('private');
    expect(classifyIpv4(ip(172, 32, 0, 1))).toBe('public');
    expect(classifyIpv4(ip(100, 64, 0, 1))).toBe('private');
    expect(classifyIpv4(ip(100, 128, 0, 1))).toBe('public');
    expect(classifyIpv4(ip(169, 254, 1, 1))).toBe('private');
    expect(classifyIpv4(ip(8, 8, 8, 8))).toBe('public');
  });
});

describe('isIpScanned', () => {
  it('skips lockfiles, release dates, changelogs and generated code', () => {
    for (const path of [
      'pnpm-lock.yaml',
      'plugin/core/gradle.lockfile',
      'plugins/bluemap/bluemap.lock.json',
      'plugins/coreprotect/coreprotect.lock.json',
      'tools/repo-checks/src/release-dates.json',
      'CHANGELOG.md',
      'plugin/gradle/verification-metadata.xml',
      'contract/src/generated/types.ts',
    ]) {
      expect(isIpScanned(path)).toBe(false);
    }
  });

  it('scans ordinary text files', () => {
    expect(isIpScanned('threshold/mcp/src/config.ts')).toBe(true);
    expect(isIpScanned('docs/decisions/0132-ipv4-literal-policy.md')).toBe(true);
  });
});

describe('parseIpAllowlist', () => {
  it('reads a list of path and reason objects', () => {
    const parsed = parseIpAllowlist('[{"path":"a/b.ts","reason":"tests private ranges"}]', 'list');
    expect(parsed).toEqual({ paths: ['a/b.ts'], problems: [] });
  });

  it('fails closed when the file is missing or not JSON', () => {
    expect(parseIpAllowlist(undefined, 'list').problems).toHaveLength(1);
    expect(parseIpAllowlist('[', 'list').problems[0]).toMatch(/not valid JSON/);
  });

  it('rejects an entry without a repo-relative path or a reason', () => {
    const text =
      '[{"path":"/abs.ts","reason":"x"},{"path":"a.ts"},{"path":"../up.ts","reason":"x"}]';
    const parsed = parseIpAllowlist(text, 'list');
    expect(parsed.paths).toEqual([]);
    expect(parsed.problems).toHaveLength(3);
  });
});
