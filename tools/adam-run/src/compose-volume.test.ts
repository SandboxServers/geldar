/** The world volume in compose: GELDAR_WORLD_VOLUME selects it, and unset it is the existing volume. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_WORLD_VOLUME } from './world-volume.ts';

const compose = parse(
  readFileSync(fileURLToPath(new URL('../../../compose/phase0.yml', import.meta.url)), 'utf8'),
) as {
  services: Record<string, { volumes?: string[] }>;
  volumes: Record<string, { name?: string } | null>;
};

describe('compose world volume', () => {
  it('the Paper service mounts the paper-data volume at /data', () => {
    expect(compose.services.paper?.volumes).toContain('paper-data:/data');
  });

  it('paper-data is named by GELDAR_WORLD_VOLUME, defaulting to the existing volume name', () => {
    expect(compose.volumes['paper-data']?.name).toBe(
      `\${GELDAR_WORLD_VOLUME:-${DEFAULT_WORLD_VOLUME}}`,
    );
  });

  it('the default is the name compose already gave the volume (project geldar-phase0)', () => {
    expect(DEFAULT_WORLD_VOLUME).toBe('geldar-phase0_paper-data');
  });
});
