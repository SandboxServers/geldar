/** A MineSkin API key as the service issues it (msk_ followed by at least 20 key characters). */
export const MINESKIN_KEY = /msk_[A-Za-z0-9_-]{20,}/;

/** A skin PNG by name, anywhere in the tree: skins are fan art whose creators keep their rights. */
export const SKIN_PNG_PATH = /(^|\/)skins\/.*\.png$/i;

/** Any PNG outside docs/: the repo keeps images only under docs/, so a PNG elsewhere is a skin or a leak until shown otherwise. */
export const PNG_OUTSIDE_DOCS = /^(?!docs\/).*\.png$/i;

export interface TrackedFile {
  path: string;
  content: string | null;
}

/** One finding: the path and the rule it broke. Matches are never printed. */
export interface Leak {
  path: string;
  rule: 'skin-png' | 'mineskin-key';
}

/**
 * Lists the tracked files that must never be in git: a skin PNG by path, or a MineSkin key in the content.
 * `content` is null for a file that is not read as text (a binary); only the path rule applies to it.
 */
export function findLeaks(files: readonly TrackedFile[]): Leak[] {
  const leaks: Leak[] = [];
  for (const file of files) {
    if (SKIN_PNG_PATH.test(file.path) || PNG_OUTSIDE_DOCS.test(file.path)) {
      leaks.push({ path: file.path, rule: 'skin-png' });
    }
    if (file.content !== null && MINESKIN_KEY.test(file.content)) {
      leaks.push({ path: file.path, rule: 'mineskin-key' });
    }
  }
  return leaks;
}
