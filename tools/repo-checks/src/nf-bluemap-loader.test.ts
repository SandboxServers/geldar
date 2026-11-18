import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The BlueMap config loader (compose/neoforge/extra-mods-bluemap-config.sh) is sourced by the entrypoint and checked by the host helper.
// Its sha256 is pinned in three places: the two BlueMap overlays (the entrypoint's pin) and deploy/nf-extra-mods-lib.sh (the host's).
// These tests assert all three equal the real file, so an edit to the loader fails here until the pins are regenerated.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOADER = `${ROOT}compose/neoforge/extra-mods-bluemap-config.sh`;
const OVERLAYS = ['compose/nf-live-mod-bluemap.yml', 'compose/opt-in/scratch-neoforge-extra-mods.yml'];
const LIB = 'deploy/nf-extra-mods-lib.sh';
const actual = createHash('sha256').update(readFileSync(LOADER)).digest('hex');
const REGEN =
  'regenerate: sha256sum compose/neoforge/extra-mods-bluemap-config.sh, then set GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256 in both BlueMap overlays and BLUEMAP_LOADER_SHA256 in deploy/nf-extra-mods-lib.sh';

describe('BlueMap config loader: its pins equal the file', () => {
  it('the real loader is a sha256 of 64 lowercase hex digits (the test is about the pin, not an empty file)', () => {
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  for (const path of OVERLAYS) {
    it(`${path} pins the loader's sha256 and mounts the loader read-only at /geldar/extra-mods/bluemap-config.sh`, () => {
      const text = readFileSync(`${ROOT}${path}`, 'utf8');
      const pin = /GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256: "([0-9a-f]{64})"/.exec(text)?.[1];
      expect(pin, `${path} has no GELDAR_NF_EXTRA_BLUEMAP_LOADER_SHA256 literal. ${REGEN}`).toBeDefined();
      expect(pin, `${path} loader pin is stale. ${REGEN}`).toBe(actual);
      expect(text).toContain('target: /geldar/extra-mods/bluemap-config.sh');
    });
  }

  it('deploy/nf-extra-mods-lib.sh checks the loader against the same sha256 before any docker call', () => {
    const text = readFileSync(`${ROOT}${LIB}`, 'utf8');
    const pin = /^BLUEMAP_LOADER_SHA256=([0-9a-f]{64})$/m.exec(text)?.[1];
    expect(pin, `${LIB} has no BLUEMAP_LOADER_SHA256 constant. ${REGEN}`).toBeDefined();
    expect(pin, `${LIB} loader pin is stale. ${REGEN}`).toBe(actual);
    expect(text).toContain('check_bluemap_loader');
  });
});
