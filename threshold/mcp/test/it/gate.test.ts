import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The guard for the Wave M integration cases. A case against a real Postgres must not run in
 * `check`, so every integration file (a `*.it.test.ts` under threshold/mcp/test/it or
 * tools/mcp-tokens/test) must open its describe with describe.skipIf(!integrationEnabled()). A file
 * added without the gate fails here.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const DIRS = [here, join(here, '..', '..', '..', '..', 'tools', 'mcp-tokens', 'test')];

const GATED = /describe\.skipIf\(!integrationEnabled\(\)\)/;

/** True when a source opens its suite behind the integration gate. */
function isGated(source: string): boolean {
  return GATED.test(source);
}

/** True for an integration file by its name: the repo's `*.it.test.ts` convention. */
function isIntegrationFile(name: string): boolean {
  return basename(name).endsWith('.it.test.ts');
}

/** The integration files under the given directories, as absolute paths. */
function integrationFiles(dirs: readonly string[]): string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (isIntegrationFile(name)) found.push(join(dir, name));
    }
  }
  return found;
}

describe('the Wave M integration gate guard', () => {
  it('recognises a gated suite and rejects an ungated one', () => {
    expect(isGated("describe.skipIf(!integrationEnabled())('x', () => {});")).toBe(true);
    expect(isGated("describe('x', () => {});")).toBe(false);
    expect(isGated("describe.skipIf(!liveEnabled())('x', () => {});")).toBe(false);
    expect(isGated("it.skipIf(!integrationEnabled())('x', () => {});")).toBe(false);
  });

  it('finds the integration files it guards', () => {
    const files = integrationFiles(DIRS).map((path) => basename(path));
    expect(files).toEqual(
      expect.arrayContaining(['pg-migrate.it.test.ts', 'pg-stores.it.test.ts', 'cli.it.test.ts']),
    );
  });

  it('every integration file under threshold/mcp/test/it and tools/mcp-tokens/test is gated', () => {
    const files = integrationFiles(DIRS);
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      expect(isGated(readFileSync(path, 'utf8')), basename(path)).toBe(true);
    }
  });
});
