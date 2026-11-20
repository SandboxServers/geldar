import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PINS = 'compose/neoforge/extra-mods.pins';
const SOURCES = 'compose/neoforge/extra-mods.sources';
const ENTRY = 'compose/neoforge/neoforge-entrypoint.sh';
const NF_LIVE_TELEMETRY = 'compose/nf-live-telemetry.yml';
const SCRATCH = 'compose/opt-in/scratch-neoforge-extra-mods.yml';
const MODS = ['chunky', 'bluemap'] as const;

const pinLines = readFileSync(`${ROOT}${PINS}`, 'utf8')
  .split('\n')
  .filter((line) => line !== '' && !line.startsWith('#'));
const pins = new Map(
  pinLines.map((line) => {
    const [name, sha, file, version] = line.split(' ');
    return [name as string, { sha, file, version }] as const;
  }),
);
const overlayText = (name: string) =>
  readFileSync(`${ROOT}compose/nf-live-mod-${name}.yml`, 'utf8');
const overlay = (name: string) => parse(overlayText(name));
const imageOf = (doc: { services: { neoforge: { image: string } } }) => doc.services.neoforge.image;

// Each pin has one download source line: <jar file name> <https URL> <sha512 hex or UNSET>. UNSET is allowed and only noted.
describe('extra mods: the download sources (no docker needed)', () => {
  const sources = readFileSync(`${ROOT}${SOURCES}`, 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(' '));

  it('gives each pin exactly one source line', () => {
    for (const [name, { file }] of pins) {
      const count = sources.filter((fields) => fields[0] === file).length;
      expect(count, `${name}: source lines for ${file}`).toBe(1);
    }
  });

  it('has no source line without a pin', () => {
    const pinFiles = new Set([...pins.values()].map((pin) => pin.file));
    for (const [file] of sources) {
      expect(pinFiles.has(file), `source line for ${file} has no pin`).toBe(true);
    }
    expect(sources.length).toBe(pins.size);
  });

  it('gives each source line three fields: the pin file, an https URL, a sha512 or UNSET', () => {
    for (const fields of sources) {
      expect(fields, `source line ${fields[0]}`).toHaveLength(3);
      const [file, url = '', sha = ''] = fields;
      expect(url.startsWith('https://'), `${file}: URL is not https`).toBe(true);
      expect(
        sha === 'UNSET' || /^[0-9a-f]{128}$/.test(sha),
        `${file}: sha512 is neither 128 lowercase hex nor UNSET`,
      ).toBe(true);
    }
  });

  it('notes the UNSET sha512 values without failing', () => {
    const unset = sources.filter((fields) => fields[2] === 'UNSET').map((fields) => fields[0]);
    console.info(`extra mods: sha512 UNSET (not taken from the release) for: ${unset.join(', ')}`);
  });
});

describe('extra mods: the pins file (no docker needed)', () => {
  it('lists exactly the two allowlisted mods, each once', () => {
    expect([...pins.keys()]).toEqual([...MODS]);
    expect(pinLines.length).toBe(2);
  });

  it('gives each mod a 64-digit lowercase hex sha256, a .jar file name and a version', () => {
    for (const { sha, file, version } of pins.values()) {
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
      expect(file).toMatch(/\.jar$/);
      expect(version).toMatch(/^\d+\.\d+(\.\d+)?$/);
    }
  });
});

describe('extra mods: the overlays (no docker needed)', () => {
  it.each(MODS)('%s: the env pin is a constant equal to the pins file', (name) => {
    const env = overlay(name).services.neoforge.environment as Record<string, string>;
    expect(env[`GELDAR_NF_EXTRA_${name.toUpperCase()}_SHA256`]).toBe(pins.get(name)?.sha);
  });

  it.each(MODS)('%s: the neoforge service gains only environment and volumes', (name) => {
    const svc = overlay(name).services.neoforge;
    expect(Object.keys(svc).sort()).toEqual(['environment', 'image', 'volumes']);
    expect(Object.keys(overlay(name)).sort()).toEqual(['services']);
  });

  it.each(MODS)(
    '%s: read-only binds, create_host_path false, exactly the fixed targets',
    (name) => {
      const volumes = overlay(name).services.neoforge.volumes as Record<string, unknown>[];
      // Chunky mounts its jar only. BlueMap mounts its jar, the committed config bundle and the config loader (three binds, no other).
      const targets =
        name === 'bluemap'
          ? [
              '/geldar/extra-mods/bluemap.jar',
              '/geldar/extra-mods/bluemap-config',
              '/geldar/extra-mods/bluemap-config.sh',
            ]
          : [`/geldar/extra-mods/${name}.jar`];
      expect(volumes.map((v) => v.target).sort()).toEqual([...targets].sort());
      for (const vol of volumes) {
        expect(vol).toMatchObject({
          type: 'bind',
          read_only: true,
          bind: { create_host_path: false },
        });
      }
      const vol = volumes.find((v) => v.target === `/geldar/extra-mods/${name}.jar`) as Record<
        string,
        unknown
      >;
      expect(String(vol.source)).toBe(
        `\${NF_EXTRA_${name.toUpperCase()}_JAR_HOST:-./nf-live-unset/${name}.jar}`,
      );
    },
  );

  it.each(MODS)('%s: no port, network or secret', (name) => {
    const text = overlayText(name);
    expect(text).not.toMatch(/^\s*ports:/m);
    expect(text).not.toMatch(/^\s*networks:/m);
    expect(text).not.toMatch(/^\s*secrets:/m);
  });

  it('repeats the neoforge image of the telemetry overlay, which is the base image', () => {
    const telemetry = parse(readFileSync(`${ROOT}${NF_LIVE_TELEMETRY}`, 'utf8'));
    for (const name of MODS) expect(imageOf(overlay(name))).toBe(imageOf(telemetry));
  });
});

describe('extra mods: the entrypoint names match the pins file (no docker needed)', () => {
  const entry = readFileSync(`${ROOT}${ENTRY}`, 'utf8');
  const callsOf = (fn: string) =>
    [...entry.matchAll(new RegExp(`^${fn} ([a-z]+)`, 'gm'))].map((m) => m[1]);

  it('extra_prep and extra_copy name exactly the pins file names', () => {
    expect(callsOf('extra_prep').sort()).toEqual([...MODS].sort());
    expect(callsOf('extra_copy').sort()).toEqual([...MODS].sort());
  });

  it('each extra_copy call passes the overlay env name and its pin variable', () => {
    for (const name of MODS) {
      const env = `GELDAR_NF_EXTRA_${name.toUpperCase()}_SHA256`;
      expect(entry).toContain(`extra_copy ${name} ${env} "\${${env}:-}"`);
    }
  });

  // With the feature off the entrypoint's extra_prep literal is the only pin it knows, so its value is checked, not only its call text.
  it.each(MODS)(
    '%s: the extra_prep pin literal equals the pins file, the overlay and the scratch overlay',
    (name) => {
      const env = `GELDAR_NF_EXTRA_${name.toUpperCase()}_SHA256`;
      const calls = [
        ...entry.matchAll(
          new RegExp(`^extra_prep ${name}\\s+"[^"\\n]*"\\s+([0-9a-f]{64})[ \\t]*$`, 'gm'),
        ),
      ];
      expect(calls).toHaveLength(1);
      const literal = calls[0]?.[1];
      expect(literal).toBe(pins.get(name)?.sha);
      expect(literal).toBe(overlay(name).services.neoforge.environment[env]);
      const scratch = parse(readFileSync(`${ROOT}${SCRATCH}`, 'utf8'));
      // The scratch overlay changes only the paper service (the NeoForge service of the scratch stack).
      expect(scratch.services.paper.environment[env]).toBe(literal);
    },
  );
});
