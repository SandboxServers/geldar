import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Chunky pin (pregeneration): chunky.lock.json must name an exact Modrinth version, a SHA-256 and a
// cdn.modrinth.com download, and the version must be at least 14 days old. Fails closed: a version with no
// publish date in release-dates.json fails. Decision 0005 and decision 0081 set the 14-day floor.

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface Lock {
  name: string;
  version: string;
  released_at: string;
  asset: string;
  url: string;
  sha256: string;
  size_bytes: number;
  release_page: string;
  license: string;
  minecraft_versions: string[];
  loaders: string[];
}

const lock = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'chunky.lock.json'), 'utf8'),
) as Lock;
const releaseDates = JSON.parse(
  readFileSync(join(ROOT, 'tools', 'repo-checks', 'src', 'release-dates.json'), 'utf8'),
) as Record<string, string>;
const paperPin = /paper = "([^"]+)"/.exec(
  readFileSync(join(ROOT, 'plugin', 'gradle', 'libs.versions.toml'), 'utf8'),
)?.[1];

describe('Chunky pin: release age and identity', () => {
  it('is an exact release version, not a range', () => {
    expect(lock.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
  });

  it('was published at least 14 days before now', () => {
    const published = Date.parse(lock.released_at);
    expect(Number.isNaN(published)).toBe(false);
    expect(Date.now() - published).toBeGreaterThanOrEqual(MIN_AGE_MS);
  });

  it('has the same publish date in release-dates.json (fail closed when missing)', () => {
    const key = `modrinth:fALzjamp@${lock.version}`;
    expect(releaseDates[key], key).toBe(lock.released_at);
  });
});

describe('Chunky pin: download and checksum', () => {
  it('has a 64-character lowercase hex SHA-256', () => {
    expect(lock.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has a positive size in bytes', () => {
    expect(Number.isInteger(lock.size_bytes)).toBe(true);
    expect(lock.size_bytes).toBeGreaterThan(0);
  });

  it('downloads the Modrinth file over https from the CDN, for this version and asset name', () => {
    const url = new URL(lock.url);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('cdn.modrinth.com');
    expect(url.pathname).toBe(`/data/fALzjamp/versions/MdY6JATr/${lock.asset}`);
    expect(lock.asset).toBe(`Chunky-Bukkit-${lock.version}.jar`);
  });

  it('links the release page on modrinth.com', () => {
    expect(new URL(lock.release_page).hostname).toBe('modrinth.com');
  });

  it('records a licence', () => {
    expect(lock.license).toBe('GPL-3.0-only');
  });
});

describe('Chunky pin: Paper support', () => {
  it('lists the Minecraft version the repo pins Paper to, and the Paper loader', () => {
    const minecraft = /^(\d+(?:\.\d+)+)/.exec(paperPin ?? '')?.[1];
    expect(minecraft).toBeDefined();
    expect(lock.minecraft_versions).toContain(minecraft);
    expect(lock.loaders).toContain('paper');
  });
});
