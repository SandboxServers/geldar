/**
 * The scratch NeoForge extra mods overlay (compose/opt-in/scratch-neoforge-extra-mods.yml), parsed with no docker: its two pin
 * constants equal the pins file, each jar is one read-only bind with create_host_path false at the fixed target, the service is
 * the scratch paper service, and it adds no port, network or secret. Nothing here starts a container.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PINS = 'compose/neoforge/extra-mods.pins';
const TEXT = readFileSync(`${ROOT}compose/opt-in/scratch-neoforge-extra-mods.yml`, 'utf8');
const doc = parse(TEXT);
const MODS = ['chunky', 'bluemap'] as const;

const pins = new Map(
  readFileSync(`${ROOT}${PINS}`, 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [name, sha] = line.split(' ');
      return [name as string, sha as string] as const;
    }),
);

describe('scratch extra mods: the overlay shape (no docker needed)', () => {
  it('changes only the paper service, and only its environment and volumes', () => {
    expect(Object.keys(doc)).toEqual(['services']);
    expect(Object.keys(doc.services)).toEqual(['paper']);
    expect(Object.keys(doc.services.paper).sort()).toEqual(['environment', 'volumes']);
  });

  it.each(MODS)('%s: the pin constant equals the pins file', (name) => {
    const env = doc.services.paper.environment as Record<string, string>;
    expect(env[`GELDAR_NF_EXTRA_${name.toUpperCase()}_SHA256`]).toBe(pins.get(name));
  });

  it('has exactly one pin constant per allowlisted mod, and no other', () => {
    const env = doc.services.paper.environment as Record<string, string>;
    expect(Object.keys(env).sort()).toEqual(
      MODS.map((name) => `GELDAR_NF_EXTRA_${name.toUpperCase()}_SHA256`).sort(),
    );
  });

  it.each(MODS)(
    '%s: one read-only bind, create_host_path false, the fixed target and the scratch host variable',
    (name) => {
      const volumes = doc.services.paper.volumes as Record<string, unknown>[];
      const vol = volumes.find((v) => v.target === `/geldar/extra-mods/${name}.jar`);
      expect(vol).toMatchObject({
        type: 'bind',
        read_only: true,
        bind: { create_host_path: false },
      });
      expect(String(vol?.source)).toBe(
        `\${SCRATCH_EXTRA_${name.toUpperCase()}_JAR_HOST:-./scratch-unset/${name}.jar}`,
      );
    },
  );

  it('mounts exactly the two jars and the BlueMap config bundle, nothing else', () => {
    const volumes = doc.services.paper.volumes as Record<string, unknown>[];
    expect(volumes.map((v) => v.target).sort()).toEqual(
      [...MODS.map((name) => `/geldar/extra-mods/${name}.jar`), '/geldar/extra-mods/bluemap-config'].sort(),
    );
  });

  it('publishes no port, declares no network or secret, and names no live host', () => {
    expect(TEXT).not.toMatch(/^\s*ports:/m);
    expect(TEXT).not.toMatch(/^\s*networks:/m);
    expect(TEXT).not.toMatch(/^\s*secrets:/m);
    const body = TEXT.split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n');
    expect(body).not.toMatch(/nf-live|geldar-nf|\bNF_EXTRA_/);
  });
});
