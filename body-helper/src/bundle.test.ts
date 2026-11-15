// C7-03c5: the body helper ships as one bundled file, dist/main.js, with dist/main.js.sha256 beside it.
// The install script checks that digest before it installs anything (deploy/install-body-helper.sh).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../scripts/bundle.mjs', import.meta.url));
let out = '';

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'geldar-bundle-'));
  const run = spawnSync(process.execPath, [SCRIPT, out], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`bundle failed: ${run.stderr}`);
}, 120_000);

afterAll(() => {
  if (out !== '') rmSync(out, { recursive: true, force: true });
});

describe('body-helper bundle (C7-03c5)', () => {
  it('writes one file with no relative imports left in it', () => {
    const js = readFileSync(join(out, 'main.js'), 'utf8');
    expect(js.length).toBeGreaterThan(1000);
    expect(js).not.toMatch(/from ["']\.\.?\//);
    expect(js).not.toMatch(/require\(["']\.\.?\//);
  });

  it('writes main.js.sha256 holding the sha256 of main.js in sha256sum format', () => {
    const digest = createHash('sha256')
      .update(readFileSync(join(out, 'main.js')))
      .digest('hex');
    expect(readFileSync(join(out, 'main.js.sha256'), 'utf8')).toBe(`${digest}  main.js\n`);
  });

  it('loads: with no config it exits 1 on the config error, not on a require shim', () => {
    const run = spawnSync(process.execPath, [join(out, 'main.js')], {
      env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' },
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain('missing GELDAR_SHARD');
    expect(run.stderr).not.toContain('Dynamic require');
  });
});
