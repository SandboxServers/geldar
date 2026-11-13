import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The CoreProtect pin (block owner records): coreprotect.lock.json must name an exact Modrinth version, a SHA-256 and
// SHA-512, and a cdn.modrinth.com download, and the version must be at least 14 days old. Fails closed: a version with
// no publish date in release-dates.json fails. Decision 0005 and decision 0081 set the 14-day floor.

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface Lock {
  name: string;
  version: string;
  released_at: string;
  asset: string;
  url: string;
  sha256: string;
  sha512: string;
  size_bytes: number;
  license: string;
  minecraft_versions: string[];
}

const lock = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'coreprotect.lock.json'), 'utf8'),
) as Lock;
const releaseDates = JSON.parse(
  readFileSync(join(ROOT, 'tools', 'repo-checks', 'src', 'release-dates.json'), 'utf8'),
) as Record<string, string>;
const paperPin = /paper = "([^"]+)"/.exec(
  readFileSync(join(ROOT, 'plugin', 'gradle', 'libs.versions.toml'), 'utf8'),
)?.[1];

describe('CoreProtect pin: release age and identity', () => {
  it('is an exact release version, not a range', () => {
    expect(lock.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
  });

  it('was published at least 14 days before now', () => {
    const published = Date.parse(lock.released_at);
    expect(Number.isNaN(published)).toBe(false);
    expect(Date.now() - published).toBeGreaterThanOrEqual(MIN_AGE_MS);
  });

  it('has the same publish date in release-dates.json (fail closed when missing)', () => {
    const key = `modrinth:Lu3KuzdV@${lock.version}`;
    expect(releaseDates[key], key).toBe(lock.released_at);
  });
});

describe('CoreProtect pin: download and checksum', () => {
  it('has a 64-character lowercase hex SHA-256 and a 128-character lowercase hex SHA-512', () => {
    expect(lock.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.sha512).toMatch(/^[0-9a-f]{128}$/);
  });

  it('has a positive size in bytes', () => {
    expect(Number.isInteger(lock.size_bytes)).toBe(true);
    expect(lock.size_bytes).toBeGreaterThan(0);
  });

  it('downloads the Modrinth file over https from the CDN, for this version and asset name', () => {
    const url = new URL(lock.url);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('cdn.modrinth.com');
    expect(url.pathname).toBe(`/data/Lu3KuzdV/versions/3sehX6Sg/${lock.asset}`);
    expect(lock.asset).toBe(`CoreProtect-CE-${lock.version}.jar`);
  });

  it('records a licence', () => {
    expect(lock.license).toBe('Artistic-2.0');
  });
});

describe('CoreProtect pin: Paper support', () => {
  it('lists the Minecraft version the repo pins Paper to', () => {
    const minecraft = /^(\d+(?:\.\d+)+)/.exec(paperPin ?? '')?.[1];
    expect(minecraft).toBeDefined();
    expect(lock.minecraft_versions).toContain(minecraft);
  });
});
