import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
