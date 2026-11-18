import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// The BlueMap config bundle mount. The jar mount and the bundle mount sit in the same overlay file, so the jar cannot be mounted
// without the bundle: the entrypoint refuses a BlueMap start without it. Both overlays (live and scratch) are checked.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TARGET = '/geldar/extra-mods/bluemap-config';
const JAR_TARGET = '/geldar/extra-mods/bluemap.jar';

type Volume = Record<string, unknown>;

function volumesOf(file: string, service: string): Volume[] {
  const doc = parse(readFileSync(file, 'utf8')) as {
    services: Record<string, { volumes: Volume[] }>;
  };
  return doc.services[service].volumes;
}

describe.each([
  ['compose/nf-live-mod-bluemap.yml', 'neoforge', '../plugins/bluemap/neoforge'],
  ['compose/opt-in/scratch-neoforge-extra-mods.yml', 'paper', '../../plugins/bluemap/neoforge'],
])('%s: the BlueMap config bundle mount', (rel, service, source) => {
  const file = `${ROOT}${rel}`;
  const volumes = volumesOf(file, service);
  const cfg = volumes.find((v) => v.target === TARGET);

  it('is a read-only bind with create_host_path false at the fixed target', () => {
    expect(cfg).toMatchObject({
      type: 'bind',
      target: TARGET,
      read_only: true,
      bind: { create_host_path: false },
    });
  });

  it('is in the same file as the BlueMap jar mount (no jar without the bundle)', () => {
    expect(volumes.some((v) => v.target === JAR_TARGET)).toBe(true);
    expect(cfg).toBeDefined();
  });

  it('its source is the committed bundle directory, relative to the compose file, and exists there', () => {
    expect(cfg?.source).toBe(source);
    const dir = join(dirname(file), source);
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(existsSync(join(dir, 'MANIFEST.sha256'))).toBe(true);
  });

  it('the source is a bind of a host directory, not a named volume or an env-chosen path', () => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/BLUEMAP_CONFIG|EXTRA_BLUEMAP_CONFIG/);
    expect(cfg?.type).toBe('bind');
  });
});
