import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = 'no-animus.test.ts';
/** A module specifier that reaches into animus: `from '...animus...'`, `import '...'` or `import('...')`. */
const ANIMUS_IMPORT = /(?:from|import)\s*\(?\s*['"][^'"\n]*animus/;

describe('player-core stays independent of animus', () => {
  it('no source file in player-core imports from animus', () => {
    const files = readdirSync(HERE, { recursive: true }) as string[];
    const sources = files.filter((f) => f.endsWith('.ts') && !f.endsWith(SELF));
    // Guards against the scan finding nothing and passing vacuously.
    expect(sources.length).toBeGreaterThan(20);
    const offenders = sources.filter((f) =>
      ANIMUS_IMPORT.test(readFileSync(join(HERE, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
