import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The BlueMap pin (C1-09): bluemap.lock.json must name an exact release, a SHA-256 and a GitHub
// release asset, and the release must be at least 14 days old. Fails closed: a release with no
// publish date in release-dates.json fails. Decision 0005 and decision 0081 set the 14-day floor.

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface Lock {
  version: string;
  released_at: string;
  asset: string;
  url: string;
  sha256: string;
  license: string;
  minimum_paper_build: string;
}

const lock = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'bluemap.lock.json'), 'utf8'),
) as Lock;
const releaseDates = JSON.parse(
  readFileSync(join(ROOT, 'tools', 'repo-checks', 'src', 'release-dates.json'), 'utf8'),
) as Record<string, string>;
const paperPin = /paper = "([^"]+)"/.exec(
  readFileSync(join(ROOT, 'plugin', 'gradle', 'libs.versions.toml'), 'utf8'),
)?.[1];

/** Compares the leading dotted numbers of two versions (`26.1.2.build.74` is 26.1.2). */
function compareVersions(a: string, b: string): number {
  const pa = (/^\d+(\.\d+)*/.exec(a)?.[0] ?? '').split('.').map(Number);
  const pb = (/^\d+(\.\d+)*/.exec(b)?.[0] ?? '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

describe('BlueMap pin: release age and identity', () => {
  it('is an exact release version, not a range', () => {
    expect(lock.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
  });

  it('was published at least 14 days before now', () => {
    const published = Date.parse(lock.released_at);
    expect(Number.isNaN(published)).toBe(false);
    expect(Date.now() - published).toBeGreaterThanOrEqual(MIN_AGE_MS);
  });

  it('has the same publish date in release-dates.json (fail closed when missing)', () => {
    const key = `github-release:BlueMap-Minecraft/BlueMap@v${lock.version}`;
    expect(releaseDates[key], key).toBe(lock.released_at);
  });
});

describe('BlueMap pin: download and checksum', () => {
  it('has a 64-character lowercase hex SHA-256', () => {
    expect(lock.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('downloads a GitHub release asset over https, for this version and asset name', () => {
    const url = new URL(lock.url);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('github.com');
    expect(url.pathname).toBe(
      `/BlueMap-Minecraft/BlueMap/releases/download/v${lock.version}/${lock.asset}`,
    );
    expect(lock.asset).toBe(`bluemap-${lock.version}-paper.jar`);
  });

  it('records a licence', () => {
    expect(lock.license).toBe('MIT');
  });
});

describe('BlueMap pin: Paper support', () => {
  it('needs no newer Paper build than the repo pins', () => {
    expect(paperPin).toBeDefined();
    expect(compareVersions(lock.minimum_paper_build, paperPin ?? '')).toBeLessThanOrEqual(0);
  });
});
