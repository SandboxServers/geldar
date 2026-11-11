import { describe, expect, it } from 'vitest';
import {
  checkReleaseAge,
  extractPins,
  imageRepository,
  type Pin,
  parseFirstPartyPrefixes,
  parseReleaseDates,
} from './release-age.ts';

const NOW = new Date('2026-11-10T00:00:00Z');
const DIGEST = `sha256:${'a'.repeat(64)}`;
const FIRST_PARTY = 'ghcr.io/sandboxservers/geldar-mcp-mock:main';
const PREFIXES = ['ghcr.io/sandboxservers/geldar-'];

function pin(key: string, extra: Partial<Pin> = {}): Pin {
  return { key, path: 'package.json', line: 1, ...extra };
}

describe('checkReleaseAge: the 14-day floor', () => {
  it('fails a third-party pin published 2 days before the check', () => {
    const dates = new Map([['npm:left-pad@1.3.0', '2026-11-08T00:00:00Z']]);
    const problems = checkReleaseAge([pin('npm:left-pad@1.3.0')], dates, NOW);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('2.0 days before the check');
  });

  it('passes a pin published exactly 14 days before the check', () => {
    const dates = new Map([['npm:left-pad@1.3.0', '2026-10-27T00:00:00Z']]);
    expect(checkReleaseAge([pin('npm:left-pad@1.3.0')], dates, NOW)).toEqual([]);
  });

  it('passes a pin published a year before the check', () => {
    const dates = new Map([['gradle-dist:9.8.2', '2025-11-10T00:00:00Z']]);
    expect(checkReleaseAge([pin('gradle-dist:9.8.2')], dates, NOW)).toEqual([]);
  });

  it('fails a pin with no date (missing is a failure, not a skip)', () => {
    const problems = checkReleaseAge([pin('npm:left-pad@1.3.0')], new Map(), NOW);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('has no release date');
  });

  it('fails a pin whose date lies in the future', () => {
    const dates = new Map([['npm:left-pad@1.3.0', '2026-12-01T00:00:00Z']]);
    expect(checkReleaseAge([pin('npm:left-pad@1.3.0')], dates, NOW)).toHaveLength(1);
  });
});

describe('checkReleaseAge: first-party images', () => {
  const image = (ref: string, extra: Partial<Pin> = {}): Pin =>
    pin(`docker:${ref}`, { path: 'compose.yml', line: 3, image: ref, ...extra });

  it('passes a first-party image pinned by digest, with no date', () => {
    const ref = `${FIRST_PARTY}@${DIGEST}`;
    expect(checkReleaseAge([image(ref)], new Map(), NOW, PREFIXES)).toEqual([]);
  });

  it('fails a first-party image that is not pinned by digest', () => {
    const problems = checkReleaseAge([image(FIRST_PARTY)], new Map(), NOW, PREFIXES);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not pinned by digest');
  });

  it('still applies the age floor to a third-party image', () => {
    const ref = `nats:2.15.1-alpine@${DIGEST}`;
    const dates = new Map([[`docker:${ref}`, '2026-11-09T00:00:00Z']]);
    expect(checkReleaseAge([image(ref)], dates, NOW, PREFIXES)).toHaveLength(1);
  });

  it('matches the repository, not a look-alike prefix', () => {
    expect(imageRepository(FIRST_PARTY)).toBe('ghcr.io/sandboxservers/geldar-mcp-mock');
    expect(imageRepository(`nats:2.15.1@${DIGEST}`)).toBe('nats');
  });
});

describe('parseReleaseDates and parseFirstPartyPrefixes fail closed', () => {
  it('reports an unreadable dates file', () => {
    const { dates, problems } = parseReleaseDates(undefined, 'dates.json');
    expect(dates.size).toBe(0);
    expect(problems).toHaveLength(1);
  });

  it('reports invalid JSON and a bad date value', () => {
    expect(parseReleaseDates('{', 'dates.json').problems).toHaveLength(1);
    const bad = parseReleaseDates('{"npm:a@1.0.0": "yesterday"}', 'dates.json');
    expect(bad.problems[0]).toContain('invalid date');
    expect(bad.dates.size).toBe(0);
  });

  it('reads a valid dates object', () => {
    const { dates, problems } = parseReleaseDates('{"npm:a@1.0.0": "2026-01-02T03:04:05Z"}', 'd');
    expect(problems).toEqual([]);
    expect(dates.get('npm:a@1.0.0')).toBe('2026-01-02T03:04:05Z');
  });

  it('reports an unreadable or malformed first-party list', () => {
    expect(parseFirstPartyPrefixes(undefined, 'f.json').problems).toHaveLength(1);
    expect(parseFirstPartyPrefixes('{"a":1}', 'f.json').problems).toHaveLength(1);
    expect(parseFirstPartyPrefixes('["ghcr.io/x/"]', 'f.json')).toEqual({
      prefixes: ['ghcr.io/x/'],
      problems: [],
    });
  });
});

describe('extractPins', () => {
  it('reads exact dependency versions and skips workspace links', () => {
    const json = JSON.stringify({
      packageManager: 'pnpm@10.1.0+sha512.x',
      dependencies: { yaml: '2.9.1', core: 'workspace:*' },
      devDependencies: { vitest: '4.0.0' },
    });
    const keys = extractPins('tools/x/package.json', json).map((p) => p.key);
    expect(keys).toEqual(['npm:yaml@2.9.1', 'npm:vitest@4.0.0', 'npm:pnpm@10.1.0']);
  });

  it('reads lockfile packages once per name@version', () => {
    const lock = "packages:\n  '@biomejs/biome@2.6.3':\n    resolution: {}\n  yaml@2.9.1:\n";
    const keys = extractPins('pnpm-lock.yaml', lock).map((p) => p.key);
    expect(keys).toEqual(['npm:@biomejs/biome@2.6.3', 'npm:yaml@2.9.1']);
  });

  it('reads FROM images, skipping stage references and scratch', () => {
    const text = `FROM node:22-alpine AS build\nFROM build AS test\nFROM scratch\n`;
    const pins = extractPins('threshold/mcp/Dockerfile', text);
    expect(pins.map((p) => p.key)).toEqual(['docker:node:22-alpine']);
    expect(pins[0]?.line).toBe(1);
  });

  it('reads compose service images and ignores build-only services', () => {
    const text = `services:\n  nats:\n    image: nats:2.15.1@${DIGEST}\n  mcp:\n    build: .\n`;
    const pins = extractPins('compose.yml', text);
    expect(pins.map((p) => p.key)).toEqual([`docker:nats:2.15.1@${DIGEST}`]);
  });

  it('reads the Gradle distribution and version-catalog modules', () => {
    const wrapper =
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.8.2-bin.zip\n';
    expect(extractPins('plugin/gradle/wrapper/gradle-wrapper.properties', wrapper)[0]?.key).toBe(
      'gradle-dist:9.8.2',
    );
    const toml = [
      '[versions]',
      'gson = "2.14.0"',
      '[libraries]',
      'gson = { module = "com.google.code.gson:gson", version.ref = "gson" }',
      'nats = { module = "io.nats:jnats", version = "2.26.4" }',
    ].join('\n');
    expect(extractPins('plugin/gradle/libs.versions.toml', toml).map((p) => p.key)).toEqual([
      'maven:com.google.code.gson:gson:2.14.0',
      'maven:io.nats:jnats:2.26.4',
    ]);
  });

  it('returns no pins for a file no rule covers', () => {
    expect(extractPins('docs/readme.md', 'FROM nats:latest')).toEqual([]);
  });
});
