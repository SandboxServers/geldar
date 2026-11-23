/**
 * The PNG rule of `tools/players-cli/src/leak-scan.ts`, applied to every file git lists: tracked files, and
 * untracked files that are not ignored, so a skin PNG fails here before it is staged, not only after.
 *
 * The rule is mirrored, not imported: that file sits in a path this package must not change, and a copy kept
 * in step (`png-leak-scan.test.ts` reads the source and checks the rule and the hashes) is less brittle than a
 * cross-package import. If the source rule changes, change these constants in the same commit.
 * Source: tools/players-cli/src/leak-scan.ts (SKIN_PNG_PATH, PNG_OUTSIDE_DOCS, GENERATED_PNGS).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A skin PNG by name, anywhere in the tree. */
export const SKIN_PNG_PATH = /(^|\/)skins\/.*\.png$/i;

/** Any PNG outside docs/: the repo keeps images only under docs/. */
export const PNG_OUTSIDE_DOCS = /^(?!docs\/).*\.png$/i;

/** The generated Glass icons, excused at their own path and with their own bytes (SHA-256, hex). */
export const GENERATED_PNGS: ReadonlyMap<string, string> = new Map([
  [
    'glass/public/icons/icon-192.png',
    'e1b279e082ba7197ac8b0de5c20402522583ec1a88665067667cfb826aadd16b',
  ],
  [
    'glass/public/icons/icon-512.png',
    '2d11e6e578945168cfe8d518b0af37da0b2b7b717dd4b8f9ba3b4cdab6f84938',
  ],
  [
    'glass/public/icons/maskable-512.png',
    'f0e5e5ec60319a883bf49b6b9b00542d11df8f1e394cd35e7361d051bf652607',
  ],
]);

/** A PNG path, and the SHA-256 of its bytes when the file is on disk (absent when it is not). */
export interface PngFile {
  path: string;
  sha256?: string;
}

/** The paths that break the PNG rule, in input order. */
export function findPngLeaks(files: readonly PngFile[]): string[] {
  return files
    .filter((file) => {
      const generated = file.sha256 !== undefined && GENERATED_PNGS.get(file.path) === file.sha256;
      return SKIN_PNG_PATH.test(file.path) || (PNG_OUTSIDE_DOCS.test(file.path) && !generated);
    })
    .map((file) => file.path);
}

/**
 * The PNG leaks among the files git lists in `root`: `ls-files --cached --others --exclude-standard`
 * is every tracked file plus every untracked file that is not ignored.
 */
export function pngLeaksIn(root: string): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const pngs = listed
    .split('\0')
    .filter((path) => /\.png$/i.test(path))
    .map((path): PngFile => {
      const full = join(root, path);
      if (statSync(full, { throwIfNoEntry: false })?.isFile() !== true) return { path };
      return { path, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') };
    });
  return findPngLeaks(pngs);
}
