// Tests for the CD-2a image verification (deploy/colo-cd-verify.sh) and the env inputs of deploy/colo-cd.sh. A refused
// image (wrong revision label, missing label, foreign prefix) stops the run before anything is restarted, pulled or
// refreshed, and before the installed manifest is written. The fixture is in colo-cd-fixture.ts.
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  cdCalls,
  cdRun,
  cdSetup,
  FROM_SHA,
  GHCR,
  manifest,
  mutating,
  REL_SHA,
  readText,
  upServices,
} from './colo-cd-fixture';
import { posix } from './colo-deploy-fixture';

const EDITS = { 'src/eventsink.txt': 'v2\n' };
const CHANGED = ['GELDAR_EVENTSINK_IMAGE'];

// Nothing was restarted, pulled or refreshed; the installed manifest and the release commit are the old ones.
function expectNothingChanged(cd: ReturnType<typeof cdSetup>) {
  expect(mutating(cdCalls(cd))).toEqual([]);
  expect(readText(join(cd.state, 'release.env'))).toBe(manifest());
  expect(readText(join(cd.state, 'release.commit')).trim()).toBe(FROM_SHA);
  expect(readText(join(cd.extract, 'src/eventsink.txt'))).toBe('v1\n');
}

// Each run is a shell script with many forks; the file-level limit covers a loaded machine (the fixture limit applies per run).
vi.setConfig({ testTimeout: 120_000 });

describe('colo-cd.sh image verification', () => {
  it('passes when every image carries the release sha as its revision label', () => {
    const cd = cdSetup(EDITS, CHANGED);
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`image verified: GELDAR_EVENTSINK_IMAGE is built from ${REL_SHA}`);
    expect(r.out).toContain(`release images verified against ${REL_SHA}`);
    // All seven images are read from the registry before the first change.
    expect(cdCalls(cd).filter((c) => c.includes('buildx imagetools inspect'))).toHaveLength(7);
    expect(upServices(cdCalls(cd))).toEqual(['eventsink']);
  });

  it('refuses a wrong revision label before anything is restarted or refreshed', () => {
    const cd = cdSetup(EDITS, CHANGED);
    const wrong = 'f'.repeat(40);
    const r = cdRun(cd, { env: { FAKE_REVISION: wrong } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(`was built from revision ${wrong}, not from release sha ${REL_SHA}`);
    expect(r.out).toContain('nothing was restarted or refreshed');
    expectNothingChanged(cd);
  });

  it('refuses an image with no revision label', () => {
    const cd = cdSetup(EDITS, CHANGED);
    const r = cdRun(cd, { env: { FAKE_REVISION: 'none' } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('has no org.opencontainers.image.revision label');
    expectNothingChanged(cd);
  });

  it('refuses an image outside the Colo namespace before reading the registry', () => {
    const cd = cdSetup(EDITS, CHANGED, 'registry.example.invalid/geldar');
    const r = cdRun(cd);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain(`is not under ${GHCR}/geldar-body`);
    expect(cdCalls(cd).some((c) => c.includes('buildx imagetools inspect'))).toBe(false);
    expectNothingChanged(cd);
  });
});

describe('colo-cd.sh inputs', () => {
  it('reads the manifest, the sha and the export dir from the environment when no positional args are given', () => {
    const cd = cdSetup(EDITS, CHANGED);
    const r = cdRun(cd, {
      args: [],
      cwd: cd.repo,
      env: { GELDAR_RELEASE_MANIFEST: posix(cd.newFile), GELDAR_RELEASE_SHA: REL_SHA },
    });
    expect(r.code, r.out).toBe(0);
    expect(upServices(cdCalls(cd))).toEqual(['eventsink']);
    expect(readText(join(cd.state, 'release.env'))).toBe(manifest(CHANGED));
    expect(readText(join(cd.state, 'release.commit')).trim()).toBe(REL_SHA);
  });

  it('refuses when no positional args and no environment inputs are given', () => {
    const cd = cdSetup(EDITS, CHANGED);
    const r = cdRun(cd, {
      args: [],
      cwd: cd.repo,
      env: { GELDAR_RELEASE_MANIFEST: '', GELDAR_RELEASE_SHA: '' },
    });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('set GELDAR_RELEASE_MANIFEST and GELDAR_RELEASE_SHA');
    expectNothingChanged(cd);
  });

  it('refuses a release sha that is not 40 lowercase hex characters', () => {
    const cd = cdSetup(EDITS, CHANGED);
    const r = cdRun(cd, { args: [posix(cd.newFile), 'ABCDEF', posix(cd.repo)] });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain('must be 40 lowercase hex characters');
    expectNothingChanged(cd);
  });
});
