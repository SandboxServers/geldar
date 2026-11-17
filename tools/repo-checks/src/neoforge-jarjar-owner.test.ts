import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The lead's rule from the P3-1 decision (no decision number): jnats is nested in a jar-in-jar by exactly one
// module, neoforge/ (the publisher of the jar the server loads). core-common declares jnats as an implementation
// dependency and nests nothing; neoforge-ledger/ nests ledger-core and OpenTelemetry, not jnats.
// The rule is checked over every Gradle build file in the repo, so a new module cannot nest jnats unnoticed.

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OWNER = 'neoforge';
const SKIPPED_DIRS = new Set(['node_modules', 'build', '.gradle', '.git', '.claude', 'run', 'out']);
const PLUGIN_CATALOG = join(ROOT, 'plugin', 'gradle', 'libs.versions.toml');
const NEOFORGE_CATALOG = join(ROOT, 'neoforge', 'gradle', 'libs.versions.toml');
const README = join(ROOT, 'neoforge', 'README.md');
const NATS = /io\.nats|jnats/;

/** The build text without `//` line comments, so a comment that names jnats does not count. */
function codeOnly(text: string): string {
  return text.replace(/\/\/[^\n]*/g, '');
}

/**
 * How many jar-in-jar entries in one build nest jnats: each jarJar(...) declaration that names it, plus each
 * listOf(...) that names it (a loop over a list of artifacts). A build with no jarJar nests nothing.
 */
function jnatsNestCount(buildText: string): number {
  const code = codeOnly(buildText);
  if (!code.includes('jarJar(')) return 0;
  const declared = [...code.matchAll(/jarJar\(([^)]*)\)/g)].filter((m) =>
    NATS.test(m[1] ?? ''),
  ).length;
  const listed = [...code.matchAll(/listOf\(([^)]*)\)/g)].filter((m) =>
    NATS.test(m[1] ?? ''),
  ).length;
  return declared + listed;
}

/** Each module (by build text) that nests jnats, with its count. Modules that nest nothing are left out. */
function nestingModules(builds: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name, text] of Object.entries(builds)) {
    const count = jnatsNestCount(text);
    if (count > 0) counts[name] = count;
  }
  return counts;
}

/** Every Gradle build file under the repo root, skipping dependency and build output trees. */
function findBuildFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) findBuildFiles(path, out);
    } else if (entry.name === 'build.gradle.kts' || entry.name === 'build.gradle') {
      out.push(path);
    }
  }
  return out;
}

/** The module key of a build file: its directory relative to the repo root, with forward slashes. */
function moduleOf(buildFile: string): string {
  return relative(ROOT, dirname(buildFile)).split(sep).join('/');
}

function readRepoBuilds(): Record<string, string> {
  const builds: Record<string, string> = {};
  for (const file of findBuildFiles(ROOT)) builds[moduleOf(file)] = readFileSync(file, 'utf8');
  return builds;
}

/** The jnats version a libs.versions.toml pins under [versions]. */
function jnatsVersion(catalogText: string): string | undefined {
  return /^jnats\s*=\s*"([^"]+)"/m.exec(catalogText)?.[1];
}

describe('jnats has exactly one jar-in-jar owner', () => {
  it('scans the NeoForge build files, so the rule cannot pass on an empty scan', () => {
    const builds = readRepoBuilds();
    expect(Object.keys(builds)).toEqual(expect.arrayContaining([OWNER, 'neoforge-ledger']));
  });

  it('neoforge/ is the only module that nests jnats, and it nests it exactly once', () => {
    expect(nestingModules(readRepoBuilds())).toEqual({ [OWNER]: 1 });
  });

  it('the owner statement exists in neoforge/README.md', () => {
    expect(readFileSync(README, 'utf8')).toContain('jnats has one owner: this module');
  });

  it('neoforge pins the jnats version that plugin/core-common pins', () => {
    const plugin = jnatsVersion(readFileSync(PLUGIN_CATALOG, 'utf8'));
    const neoforge = jnatsVersion(readFileSync(NEOFORGE_CATALOG, 'utf8'));
    expect(plugin).toBeDefined();
    expect(neoforge).toBe(plugin);
  });

  it('counts a jarJar declaration that names jnats, by coordinate or by catalog reference', () => {
    expect(jnatsNestCount('jarJar("io.nats:jnats") {}')).toBe(1);
    expect(jnatsNestCount('jarJar(libs.jnats) {}')).toBe(1);
  });

  it('counts a second declaration, so a double nest in one module is caught', () => {
    expect(jnatsNestCount('jarJar("io.nats:jnats") {}\njarJar("io.nats:jnats") {}')).toBe(2);
  });

  it('counts a list of artifacts that names jnats when the build has a jarJar', () => {
    expect(
      jnatsNestCount('for (a in listOf("opentelemetry-api", "jnats")) jarJar("x:$a") {}'),
    ).toBe(1);
    expect(jnatsNestCount('for (a in listOf("jnats")) implementation("x:$a")')).toBe(0);
  });

  it('ignores a jnats name in a comment, and a jnats dependency that nothing nests', () => {
    expect(
      jnatsNestCount(
        '// jnats is nested in neoforge/ only\ndependencies { implementation("io.nats:jnats") }',
      ),
    ).toBe(0);
  });

  it('ignores jarJar declarations of other artifacts (core-common, OpenTelemetry, ledger-core)', () => {
    expect(
      jnatsNestCount('jarJar("dev.geldar:core-common") {}\njarJar("io.opentelemetry:$a") {}'),
    ).toBe(0);
  });
});
