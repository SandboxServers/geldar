import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkOutPath } from './tokens.ts';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A temporary root holding a fake repo and, when the platform allows, a link into it. */
async function fixture(): Promise<{ repo: string; link: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mcp-tokens-outpath-'));
  dirs.push(root);
  const repo = join(root, 'repo');
  await mkdir(repo);
  return { repo, link: join(root, 'link'), root };
}

describe('checkOutPath through symlinks', () => {
  it('refuses a --out file reached through a symlink into the repo', async (ctx) => {
    const { repo, link, root } = await fixture();
    try {
      // A junction needs no privilege on Windows; a directory symlink elsewhere.
      await symlink(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      ctx.skip();
      return;
    }
    expect(() => checkOutPath(join(link, 'f'), repo)).toThrow('outside the repo');
    expect(() => checkOutPath(join(root, 'elsewhere', 'f'), repo)).not.toThrow();
  });

  it('refuses a file that does not exist yet under a symlinked parent inside the repo', async (ctx) => {
    const { repo, link } = await fixture();
    try {
      await symlink(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      ctx.skip();
      return;
    }
    expect(() => checkOutPath(join(link, 'missing', 'token.env'), repo)).toThrow(
      'outside the repo',
    );
  });
});

describe('checkOutPath with the native realpath', () => {
  it('refuses a short-name path that the native realpath expands into the repo', () => {
    const repo = join(tmpdir(), 'mcp-tokens-short', 'geldar');
    const shortRepo = join(tmpdir(), 'mcp-tokens-short', 'GELDAR~1');
    // Stands in for the native realpath, which expands the 8.3 short name to the long one.
    const expanded = (path: string) =>
      path.startsWith(shortRepo) ? join(repo, path.slice(shortRepo.length)) : path;
    expect(() => checkOutPath(join(shortRepo, 'token.env'), repo, expanded)).toThrow(
      'outside the repo',
    );
  });

  it('resolves through realpathSync.native by default', () => {
    const repo = join(tmpdir(), 'mcp-tokens-native', 'geldar');
    const spy = vi.spyOn(realpathSync, 'native');
    try {
      expect(() =>
        checkOutPath(join(tmpdir(), 'mcp-tokens-native', 'token.env'), repo),
      ).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
