/**
 * PT-18b: two repo-level scans.
 *
 * 1. Neutral-core purity (S2): `plugin/ledger-core/src` must not name a loader or game package. The prefix list repeats
 *    `NoLoaderImportsTest` on purpose (plus `org.spigotmc`), so CI fails even if the Gradle test is skipped. Unlike the
 *    Gradle test this scan also reads string literals of `src/main` (a `Class.forName("org.bukkit.X")` is a dependency);
 *    `src/test` is read as code only, because its fixtures name these packages as data.
 * 2. Agent text (S2, 0350 point 7): nothing an agent can read may carry a Ledger or trace word. The agent-visible
 *    set is the one the existing agent-text scan (`animus/src/prompts/agent-text.test.ts`) covers: `prompts/`
 *    (templates and the Body API descriptions) and `golem/src/prompts` (absent today; a missing root is skipped).
 */
import {
  type Dirent,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Repo-relative, forward slashes. */
const CORE_MAIN = 'plugin/ledger-core/src/main';
const CORE_TEST = 'plugin/ledger-core/src/test';
const AGENT_ROOTS = ['prompts', 'golem/src/prompts'];

const LOADER_PACKAGES = [
  'org.bukkit',
  'io.papermc',
  'com.destroystokyo',
  'net.minecraft',
  'org.spigotmc',
  'net.fabricmc',
  'net.neoforged',
  'com.velocitypowered',
  'net.kyori',
];
/** A package prefix as a token: not the tail of a longer name, and followed by a dot. */
const LOADER = new RegExp(
  `(?<![\\w.])(?:${LOADER_PACKAGES.map((p) => p.replaceAll('.', '\\.')).join('|')})\\.`,
);
/** Also catches a slash form (`org/bukkit/X`) and a bare quoted package in a string. */
const LOADER_SLASH = new RegExp(
  `(?<![\\w/])(?:${LOADER_PACKAGES.map((p) => p.replaceAll('.', '/')).join('|')})/`,
);

const AGENT_MARKERS = /ledger|traceparent|trace_id/i;

const STRING = String.raw`"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`;
const COMMENT = String.raw`//[^\n]*|/\*[\s\S]*?\*/`;
const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/** Blanks comments (and string literals when `keepStrings` is false); newlines stay, so line numbers hold. */
export function codeOf(source: string, keepStrings: boolean): string {
  return source.replace(new RegExp(`(${STRING})|${COMMENT}`, 'g'), (match, str) =>
    str !== undefined && keepStrings ? match : blank(match),
  );
}

export function scanCoreSource(label: string, source: string, keepStrings: boolean): string[] {
  const hits: string[] = [];
  codeOf(source, keepStrings)
    .split('\n')
    .forEach((line, index) => {
      if (LOADER.test(line) || (keepStrings && LOADER_SLASH.test(line))) {
        hits.push(`${label}:${index + 1}: loader or game package: ${line.trim()}`);
      }
    });
  return hits;
}

function filesUnder(dir: string, suffix?: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path, suffix);
    return suffix === undefined || path.endsWith(suffix) ? [path] : [];
  });
}

const rel = (root: string, path: string): string => relative(root, path).replaceAll('\\', '/');

/** Findings for the core under `root`: main with strings, test as code only. */
export function scanCore(root: string): string[] {
  const out: string[] = [];
  for (const [dir, keepStrings] of [
    [CORE_MAIN, true],
    [CORE_TEST, false],
  ] as const) {
    for (const path of filesUnder(join(root, dir), '.java')) {
      out.push(...scanCoreSource(rel(root, path), readFileSync(path, 'utf8'), keepStrings));
    }
  }
  return out;
}

/** The files of the agent-visible set, repo-relative. */
export function agentFiles(root: string): string[] {
  return AGENT_ROOTS.flatMap((dir) => filesUnder(join(root, dir)).map((p) => rel(root, p)));
}

/** Findings: every line of an agent-visible file that carries a marker string. */
export function scanAgentText(root: string): string[] {
  const out: string[] = [];
  for (const file of agentFiles(root)) {
    readFileSync(join(root, file), 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        const found = line.match(AGENT_MARKERS);
        if (found) out.push(`${file}:${index + 1}: agent-visible text contains ${found[0]}`);
      });
  }
  return out;
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pt18b-'));
  temps.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const CLEAN = 'package a;\nimport java.util.List;\nclass Clean { }\n';

describe('neutral-core purity', () => {
  it('the real core tree has no loader or game package', () => {
    expect(scanCore(ROOT)).toEqual([]);
  });

  it('the real tree has files to scan (the scan is not vacuous)', () => {
    expect(filesUnder(join(ROOT, CORE_MAIN), '.java').length).toBeGreaterThan(10);
    expect(filesUnder(join(ROOT, CORE_TEST), '.java').length).toBeGreaterThan(0);
  });

  it('fails a Bukkit import in a core-like path', () => {
    const dir = fixture({ [`${CORE_MAIN}/a/Bad.java`]: 'package a;\nimport org.bukkit.Bukkit;\n' });
    expect(scanCore(dir)).toEqual([
      `${CORE_MAIN}/a/Bad.java:2: loader or game package: import org.bukkit.Bukkit;`,
    ]);
  });

  it('fails every package, a static import and a qualified name in code', () => {
    const named = [
      'org.bukkit',
      'io.papermc',
      'com.destroystokyo',
      'net.minecraft',
      'org.spigotmc',
      'com.velocitypowered',
      'net.kyori',
      'net.fabricmc',
      'net.neoforged',
    ];
    expect([...LOADER_PACKAGES].sort()).toEqual([...named].sort());
    for (const pkg of named) {
      const dir = fixture({ [`${CORE_MAIN}/B.java`]: `import static ${pkg}.A.B;\n` });
      expect(scanCore(dir), pkg).toHaveLength(1);
    }
    const dir = fixture({ [`${CORE_MAIN}/Q.java`]: 'class Q { io.papermc.paper.A a; }\n' });
    expect(scanCore(dir)).toHaveLength(1);
  });

  it('fails a loader name in a string of src/main but not in src/test', () => {
    const src = 'class S { Object c = Class.forName("org.bukkit.Server"); }\n';
    expect(scanCore(fixture({ [`${CORE_MAIN}/S.java`]: src }))).toHaveLength(1);
    expect(
      scanCore(fixture({ [`${CORE_MAIN}/S.java`]: 'class S { String s = "org/bukkit/X"; }\n' })),
    ).toHaveLength(1);
    expect(scanCore(fixture({ [`${CORE_TEST}/S.java`]: src }))).toEqual([]);
  });

  it('fails a loader import in src/test code', () => {
    expect(scanCore(fixture({ [`${CORE_TEST}/T.java`]: 'import net.kyori.A;\n' }))).toHaveLength(1);
  });

  it('passes a clean file, comments, lookalikes and keeps line numbers', () => {
    const ok =
      '// org.bukkit.Bukkit\n/** {@code net.minecraft.X}\n */\nimport com.example.org.bukkit.A;\nimport io.opentelemetry.api.A;\nimport org.bukkitx.A;\n';
    expect(
      scanCore(fixture({ [`${CORE_MAIN}/Clean.java`]: CLEAN, [`${CORE_MAIN}/Ok.java`]: ok })),
    ).toEqual([]);
    const late = scanCore(
      fixture({ [`${CORE_MAIN}/L.java`]: '/* a\n b */\nimport org.bukkit.A;\n' }),
    );
    expect(late[0]).toContain('L.java:3:');
  });

  it('a "//" inside a string does not hide a later import on the same line', () => {
    const src = 'class U { String s = "http://x"; org.bukkit.A a; }\n';
    expect(scanCore(fixture({ [`${CORE_MAIN}/U.java`]: src }))).toHaveLength(1);
  });
});

describe('agent-text scan', () => {
  it('the real agent-visible tree has no Ledger or trace word', () => {
    expect(scanAgentText(ROOT)).toEqual([]);
  });

  it('the real set covers the default templates (the scan is not vacuous)', () => {
    const files = agentFiles(ROOT);
    for (const f of [
      'prompts/thought/v5.md',
      'prompts/reflection/v2.md',
      'prompts/body-api/v10.json',
    ]) {
      expect(files).toContain(f);
    }
  });

  it('fails an agent-text file containing traceparent', () => {
    const dir = fixture({ 'prompts/thought/v9.md': 'line one\nsend a traceparent header\n' });
    expect(scanAgentText(dir)).toEqual([
      'prompts/thought/v9.md:2: agent-visible text contains traceparent',
    ]);
  });

  it('fails each marker, in either case, under either root', () => {
    for (const word of ['Ledger', 'ledger', 'LEDGER', 'trace_id', 'traceparent']) {
      expect(scanAgentText(fixture({ 'prompts/a.md': `x ${word} y` })), word).toHaveLength(1);
      expect(scanAgentText(fixture({ 'golem/src/prompts/a.ts': `x ${word}` })), word).toHaveLength(
        1,
      );
    }
  });

  it('passes clean text and an absent root', () => {
    expect(scanAgentText(fixture({ 'prompts/a.md': 'You are a villager.\n' }))).toEqual([]);
    expect(scanAgentText(fixture({}))).toEqual([]);
  });
});
