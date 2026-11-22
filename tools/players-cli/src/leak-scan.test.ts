import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './cli.ts';
import { findLeaks, GENERATED_PNGS, type TrackedFile } from './leak-scan.ts';

/** Built at run time, so this file never contains a key-shaped string. */
const FAKE_KEY = `msk_${'Z'.repeat(22)}`;

describe('findLeaks', () => {
  it('flags a tracked skin PNG by path, wherever it sits', () => {
    const files: TrackedFile[] = [
      { path: 'skins/jason.png', content: null },
      { path: 'docs/art/skins/zack.PNG', content: null },
    ];
    expect(findLeaks(files).map((leak) => leak.rule)).toEqual(['skin-png', 'skin-png']);
  });

  it('flags a PNG outside docs/ even when it is not under skins/', () => {
    const files: TrackedFile[] = [
      { path: 'tools/players-cli/assets/jason.png', content: null },
      { path: 'threshold/mcp/face.PNG', content: null },
      { path: 'docs/diagram.png', content: null },
    ];
    expect(findLeaks(files).map((leak) => leak.path)).toEqual([
      'tools/players-cli/assets/jason.png',
      'threshold/mcp/face.PNG',
    ]);
  });

  it('passes a generated PNG only at its own path and with its own bytes', () => {
    const [path, sha256] = [...GENERATED_PNGS][0] as [string, string];
    expect(findLeaks([{ path, content: null, sha256 }])).toEqual([]);
    // Another picture under the same name is a PNG outside docs/ like any other.
    const other = 'f'.repeat(64);
    expect(findLeaks([{ path, content: null, sha256: other }])).toEqual([
      { path, rule: 'skin-png' },
    ]);
    expect(findLeaks([{ path, content: null }])).toEqual([{ path, rule: 'skin-png' }]);
    // The same bytes anywhere else are not excused, and neither is a neighbour of the generated file.
    const moved = [
      { path: 'tools/players-cli/assets/icon-192.png', content: null, sha256 },
      { path: 'glass/public/icons/jason.png', content: null, sha256 },
      { path: 'glass/public/icons/skins/icon-192.png', content: null, sha256 },
    ];
    expect(findLeaks(moved).map((leak) => leak.path)).toEqual(moved.map((file) => file.path));
  });

  it('excuses exactly the three icons of the installable Glass page', () => {
    expect([...GENERATED_PNGS.keys()]).toEqual([
      'glass/public/icons/icon-192.png',
      'glass/public/icons/icon-512.png',
      'glass/public/icons/maskable-512.png',
    ]);
    for (const hash of GENERATED_PNGS.values()) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('flags a tracked file whose content holds a MineSkin key', () => {
    const files: TrackedFile[] = [{ path: 'notes/setup.md', content: `key: ${FAKE_KEY}\n` }];
    expect(findLeaks(files)).toEqual([{ path: 'notes/setup.md', rule: 'mineskin-key' }]);
  });

  it('passes a placeholder that is not a key, and an ordinary PNG outside skins/', () => {
    const files: TrackedFile[] = [
      {
        path: 'docs/setup.md',
        content: 'put the key in compose/secrets/mineskin.txt (msk_ and a key)',
      },
      { path: 'docs/diagram.png', content: null },
    ];
    expect(findLeaks(files)).toEqual([]);
  });
});

describe('the repository as tracked by git', () => {
  it('contains no skin PNG and no MineSkin key', () => {
    const listed = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
    const files: TrackedFile[] = listed
      .split('\0')
      .filter((path) => path !== '')
      .map((path) => {
        const full = join(REPO_ROOT, path);
        if (statSync(full, { throwIfNoEntry: false })?.isFile() !== true) {
          return { path, content: null };
        }
        const bytes = readFileSync(full);
        const binary = bytes.length > 2 * 1024 * 1024 || bytes.includes(0);
        const content = binary ? null : bytes.toString('utf8');
        if (!/\.png$/i.test(path)) return { path, content };
        return { path, content, sha256: createHash('sha256').update(bytes).digest('hex') };
      });
    const leaks = findLeaks(files);
    expect(
      leaks,
      `tracked files that must not be in git: ${leaks.map((l) => `${l.path} (${l.rule})`).join(', ')}`,
    ).toEqual([]);
  });
});
