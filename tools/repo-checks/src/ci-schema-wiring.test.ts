import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// A schema check that CI does not run guards nothing: every check file must be named in the psql step.
describe('schema check files are wired into CI', () => {
  it('names every sql/test/check-schema*.sql file in .github/workflows/ci.yml', () => {
    const files = readdirSync(join(ROOT, 'sql', 'test')).filter((f) =>
      /^check-schema.*\.sql$/.test(f),
    );
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !ci.includes(`sql/test/${f}`))).toEqual([]);
  });
});
