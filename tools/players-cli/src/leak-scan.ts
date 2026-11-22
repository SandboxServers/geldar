/** A MineSkin API key as the service issues it (msk_ followed by at least 20 key characters). */
export const MINESKIN_KEY = /msk_[A-Za-z0-9_-]{20,}/;

/** A skin PNG by name, anywhere in the tree: skins are fan art whose creators keep their rights. */
export const SKIN_PNG_PATH = /(^|\/)skins\/.*\.png$/i;

/** Any PNG outside docs/: the repo keeps images only under docs/, so a PNG elsewhere is a skin or a leak until shown otherwise. */
export const PNG_OUTSIDE_DOCS = /^(?!docs\/).*\.png$/i;

/**
 * PNGs outside docs/ that are shown to be neither a skin nor a leak: each is drawn by code in this
 * repository, and is named here with the SHA-256 of its bytes. A file at one of these paths with any other
 * bytes is flagged like any PNG. An entry is added in a reviewed change, with the code that draws it.
 *
 * The three below are the icons of the installable Glass page (decision 0410): the sigil of the name "Glass"
 * in two flat colours. `glass/test/app-icon.ts` draws them and `glass/test/app-icon.test.ts` holds the
 * committed files to it, pixel for pixel.
 */
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

export interface TrackedFile {
  path: string;
  content: string | null;
  /** The SHA-256 of the file's bytes, in hex. Needed only for a PNG, to tell a generated one from any other. */
  sha256?: string;
}

/** One finding: the path and the rule it broke. Matches are never printed. */
export interface Leak {
  path: string;
  rule: 'skin-png' | 'mineskin-key';
}

/**
 * Lists the tracked files that must never be in git: a skin PNG by path (any PNG outside docs/ that is not one
 * of the generated ones, byte for byte), or a MineSkin key in the content.
 * `content` is null for a file that is not read as text (a binary); only the path rule applies to it.
 */
export function findLeaks(files: readonly TrackedFile[]): Leak[] {
  const leaks: Leak[] = [];
  for (const file of files) {
    const generated = file.sha256 !== undefined && GENERATED_PNGS.get(file.path) === file.sha256;
    if (SKIN_PNG_PATH.test(file.path) || (PNG_OUTSIDE_DOCS.test(file.path) && !generated)) {
      leaks.push({ path: file.path, rule: 'skin-png' });
    }
    if (file.content !== null && MINESKIN_KEY.test(file.content)) {
      leaks.push({ path: file.path, rule: 'mineskin-key' });
    }
  }
  return leaks;
}
