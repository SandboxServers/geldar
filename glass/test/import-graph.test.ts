/**
 * The import graph and the SQL that Glass can send. Glass reads Postgres as `geldar_glass` and must
 * not reach the code that writes: no import of animus, golem or threshold, and no package that can
 * write to NATS or Postgres. A bare import is allowed only from the list below. The shipped source
 * (src and public) may send only SELECT, BEGIN READ ONLY, ROLLBACK and SET. The integration test
 * builds a throwaway database with the migration tool, so it is the one file allowed to reach
 * outside glass; its fixture writes are not part of the shipped source and are not scanned.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GLASS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = ['src', 'test', 'public'];

/** Bare packages a Glass file may import: pg for read-only queries and the test tooling. */
const ALLOWED_PACKAGES = new Set([
  'pg',
  'happy-dom',
  'vitest',
  // Kino (decision 0075, owner-approved): Glass subscribes to the Kino feed and publishes the Kino
  // control subject. Only src/kino/nats-feed.ts imports it (pinned below).
  '@nats-io/transport-node',
]);
/** Where the NATS client may be imported: the Kino feed file, nowhere else in Glass. */
const NATS_FILES = new Set(['src/kino/nats-feed.ts']);
const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

/** Relative imports that leave glass, per file. Only the integration test sets up a database. */
const OUTSIDE_ALLOWED: Record<string, string[]> = {
  'test/glass.it.test.ts': [
    '../../tools/migrate/src/migrate.ts',
    '../../tools/migrate/src/scram.ts',
  ],
  // Kino audit test: checks each audit row against the generated lakitu-audit validator (a test-only read).
  'test/kino/audit.test.ts': ['../../../contract/src/generated/validators.js'],
  // Kino preview (decision 0161, test-only, never deployed): type-only imports of the generated feed
  // types, so the invented feed it serves is checked against the contract by the type checker.
  'test/kino-preview/server.ts': ['../../../contract/src/generated/types.ts'],
  'test/kino-preview/world.ts': ['../../../contract/src/generated/types.ts'],
  // Its test checks the invented feed against the generated validator (a test-only read).
  'test/kino-preview.test.ts': ['../../contract/src/generated/validators.js'],
  // Kino feed check: the contract-sync test compares the hand-written check with the generated validator.
  'test/kino/feed-check.test.ts': ['../../../contract/src/generated/validators.js'],
};

/** Statements the shipped source may send. Anything else that starts a statement is a violation. */
const WRITE_LEADING =
  /^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|COPY|COMMIT|MERGE|CALL|DO|LOCK|VACUUM|REINDEX|REFRESH|CLUSTER)\b/;
const STRING_LITERAL = /`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
const IMPORT_SPEC =
  /(?:import|export)\s+(?:[^'"`;]*?\sfrom\s+)?['"]([^'"\n]+)['"]|import\s*\(\s*['"]([^'"\n]+)['"]\s*\)|require\(\s*['"]([^'"\n]+)['"]\s*\)/g;

function packageOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

/** The import violations in one file's text, as `spec: reason` strings. */
export function importViolations(rel: string, text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(IMPORT_SPEC)) {
    const spec = match[1] ?? match[2] ?? match[3] ?? '';
    if (spec === '' || spec.startsWith('/') || spec.startsWith('data:')) continue;
    if (spec.startsWith('node:') || spec.startsWith('.')) {
      if (spec.startsWith('node:')) continue;
      const target = relative(GLASS, resolve(GLASS, rel, '..', spec))
        .split(sep)
        .join('/');
      const inside = !target.startsWith('..') && !target.startsWith('/');
      if (!inside && !(OUTSIDE_ALLOWED[rel] ?? []).includes(spec))
        out.push(`${spec}: leaves glass`);
      continue;
    }
    const pkg = packageOf(spec);
    if (!ALLOWED_PACKAGES.has(pkg) && !BUILTINS.has(pkg))
      out.push(`${spec}: not an allowed package`);
    else if (pkg === '@nats-io/transport-node' && !NATS_FILES.has(rel))
      out.push(`${spec}: the NATS client is allowed only in the Kino feed file`);
  }
  return out;
}

/** The SQL violations in one file's text: each string literal that opens with a write verb. */
export function sqlViolations(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(STRING_LITERAL)) {
    const body = (match[1] ?? match[2] ?? match[3] ?? '').trimStart();
    const lead = WRITE_LEADING.exec(body);
    if (lead) out.push(`${lead[1]}: ${body.slice(0, 60)}`);
  }
  return out;
}

/** The tree scans below are synchronous, and vitest still times a sync test out at its 5 s default. */
const SCAN_TIMEOUT_MS = 30_000;

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

function relPath(path: string): string {
  return relative(GLASS, path).split(sep).join('/');
}

describe('the Glass import graph', () => {
  it(
    'imports only built-ins, pg, happy-dom, vitest and glass files',
    () => {
      // This file holds the planted imports for the self-test, so it is the one file not scanned.
      const found = SCANNED.flatMap((dir) => files(join(GLASS, dir), /\.(ts|js|mjs)$/)).filter(
        (path) => !path.endsWith(`${sep}import-graph.test.ts`),
      );
      expect(found.length).toBeGreaterThan(20);
      const violations = found.flatMap((path) => {
        const rel = relPath(path);
        return importViolations(rel, readFileSync(path, 'utf8')).map((v) => `${rel} -> ${v}`);
      });
      expect(violations).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );

  it('rejects a planted import of animus, golem, threshold or a write-capable package', () => {
    const planted = [
      "import { x } from '../../golem/src/x.ts';",
      "import { y } from '@geldar/animus';",
      "import z from 'threshold';",
      "import nats from 'nats';",
      "import pg from 'pg';\nimport { q } from '../../tools/migrate/src/migrate.ts';",
    ].join('\n');
    const violations = importViolations('src/planted.ts', planted);
    expect(violations).toEqual([
      '../../golem/src/x.ts: leaves glass',
      '@geldar/animus: not an allowed package',
      'threshold: not an allowed package',
      'nats: not an allowed package',
      '../../tools/migrate/src/migrate.ts: leaves glass',
    ]);
  });

  it('allows the integration test its migration import and nothing else outside glass', () => {
    const source = "import { migrate } from '../../tools/migrate/src/migrate.ts';";
    expect(importViolations('test/glass.it.test.ts', source)).toEqual([]);
    expect(importViolations('test/other.test.ts', source)).toHaveLength(1);
  });
});

describe('the SQL the shipped Glass source can send', () => {
  it(
    'sends only SELECT, BEGIN READ ONLY, ROLLBACK or SET, and the reads are there',
    () => {
      const shipped = ['src', 'public'].flatMap((dir) =>
        files(join(GLASS, dir), /\.(ts|js)$/).filter((path) => !/\.test\.ts$/.test(path)),
      );
      const violations = shipped.flatMap((path) =>
        sqlViolations(readFileSync(path, 'utf8')).map((v) => `${relPath(path)} -> ${v}`),
      );
      expect(violations).toEqual([]);
      const query = readFileSync(join(GLASS, 'src', 'query.ts'), 'utf8');
      expect(query).toMatch(/`SELECT /);
    },
    SCAN_TIMEOUT_MS,
  );

  it('flags a planted write statement and passes SELECT, BEGIN READ ONLY and SET', () => {
    expect(sqlViolations('db.query(`DELETE FROM thoughts`)')).toHaveLength(1);
    expect(sqlViolations("db.query('INSERT INTO agents VALUES (1)')")).toHaveLength(1);
    expect(sqlViolations('db.query(`BEGIN READ ONLY`)')).toEqual([]);
    expect(sqlViolations("db.query('SET statement_timeout = 5000')")).toEqual([]);
    expect(sqlViolations('db.query(`SELECT 1`)')).toEqual([]);
  });
});
