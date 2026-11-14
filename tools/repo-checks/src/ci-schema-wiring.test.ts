import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Drops YAML comments: a whole-line `# ...` and a trailing ` # ...`. A commented-out path is not wiring. */
const stripComments = (yaml: string): string =>
  yaml
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');

/** The check files that the (comment-free) CI text does not name as `sql/test/<file>`. */
const unwired = (files: readonly string[], ciText: string): string[] => {
  const active = stripComments(ciText);
  return files.filter((f) => !active.includes(`sql/test/${f}`));
};

// A schema check that CI does not run guards nothing: every check file must be named in the psql step.
describe('schema check files are wired into CI', () => {
  it('names every sql/test/check-schema*.sql file in .github/workflows/ci.yml outside a comment', () => {
    const files = readdirSync(join(ROOT, 'sql', 'test')).filter((f) =>
      /^check-schema.*\.sql$/.test(f),
    );
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(files.length).toBeGreaterThan(0);
    expect(unwired(files, ci)).toEqual([]);
  });

  it('a file named only in a whole-line comment is not wired', () => {
    const ci = 'steps:\n  # psql -f sql/test/check-schema-x.sql\n  - run: echo hi\n';
    expect(unwired(['check-schema-x.sql'], ci)).toEqual(['check-schema-x.sql']);
  });

  it('a file named only in a trailing comment is not wired', () => {
    const ci = 'steps:\n  - run: echo hi # sql/test/check-schema-x.sql\n';
    expect(unwired(['check-schema-x.sql'], ci)).toEqual(['check-schema-x.sql']);
  });

  it('a file named in a live psql line is wired', () => {
    const ci = '  # the schema checks\n  - run: psql -f sql/test/check-schema-x.sql\n';
    expect(unwired(['check-schema-x.sql'], ci)).toEqual([]);
  });
});
