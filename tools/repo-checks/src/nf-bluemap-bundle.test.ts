import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The committed BlueMap config bundle for the NeoForge shard, and its MANIFEST.sha256 (sha256sum format, LF, sorted). The
// entrypoint and deploy/nf-extra-mods-lib.sh refuse any bundle that does not match the manifest. Editing a bundle file means
// regenerating the manifest: this test prints the lines to paste when they differ.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BUNDLE = join(ROOT, 'plugins/bluemap/neoforge');
const MANIFEST = 'MANIFEST.sha256';

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Every regular file under the bundle, as sorted relative paths with '/' separators (the manifest itself included). */
function bundleFiles(): string[] {
  return readdirSync(BUNDLE, { recursive: true })
    .map((p) => String(p).replace(/\\/g, '/'))
    .filter((p) => statSync(join(BUNDLE, p)).isFile())
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The manifest lines a bundle with these files must carry: sha256 two spaces path, the manifest itself excluded. */
function expectedManifest(): string {
  const rels = bundleFiles().filter((p) => p !== MANIFEST);
  return `${rels.map((rel) => `${sha256(join(BUNDLE, rel))}  ${rel}`).join('\n')}\n`;
}

describe('BlueMap config bundle: MANIFEST.sha256', () => {
  const text = readFileSync(join(BUNDLE, MANIFEST), 'utf8');

  it('equals the manifest regenerated from the files (line for line, LF, final newline)', () => {
    const want = expectedManifest();
    if (text !== want) console.log(`paste this into ${MANIFEST}:\n${want}`);
    expect(text).toBe(want);
  });

  it('every line is "<64 lowercase hex>  <relative .conf path>" and the lines are sorted', () => {
    const lines = text.replace(/\n$/, '').split('\n');
    for (const line of lines) {
      expect(line).toMatch(/^[0-9a-f]{64} {2}([A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+\.conf$/);
    }
    const paths = lines.map((l) => l.slice(66));
    expect(paths).toEqual([...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('the directory holds exactly the files the manifest lists, plus the manifest (no stray default)', () => {
    const listed = text
      .replace(/\n$/, '')
      .split('\n')
      .map((l) => l.slice(66))
      .sort();
    expect(bundleFiles().filter((p) => p !== MANIFEST)).toEqual(listed);
    expect(bundleFiles()).toContain(MANIFEST);
  });

  it('the bundle lists storages/file.conf, the storage the map confs name (storage: "file")', () => {
    expect(text).toMatch(/ {2}storages\/file\.conf\n/);
    for (const map of ['overworld', 'nether', 'end']) {
      const conf = readFileSync(join(BUNDLE, `maps/${map}.conf`), 'utf8');
      expect(conf).toContain('storage: "file"');
    }
  });
});
