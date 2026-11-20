import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

type Step = { name?: string; run?: string };
const jobs = (parse(readFileSync(CI, 'utf8')) as { jobs: Record<string, { steps: Step[] }> }).jobs;
const steps = [...(jobs.neoforge?.steps ?? []), ...(jobs.plugin?.steps ?? [])];

// Git's bash (the retry blocks use `set -o pipefail`); on Windows the PATH `bash` may be WSL, so look for Git first.
function findBash(): string | undefined {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
    '/bin/bash',
    '/usr/bin/bash',
  ];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      execFileSync(c, ['-c', 'true']);
      return c;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

const bash = findBash();

// Runs the real workflow run-block with a fake ./gradlew that prints the fixture and fails. Returns how many times
// gradle ran (2 = retried, 1 = not retried) and the exit code.
function runBlock(stepName: string, fixture: string) {
  const run = steps.find((s) => s.name === stepName)?.run;
  if (!run) throw new Error(`step not found: ${stepName}`);
  const dir = mkdtempSync(join(tmpdir(), 'nf-retry-'));
  try {
    writeFileSync(join(dir, 'nosleep.sh'), 'sleep() { :; }\n');
    writeFileSync(join(dir, 'fixture.txt'), fixture);
    writeFileSync(join(dir, 'count'), '');
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\necho x >> count\ncat fixture.txt\nexit 1\n');
    chmodSync(join(dir, 'gradlew'), 0o755);
    const r = spawnSync(bash as string, ['-c', run], {
      cwd: dir,
      encoding: 'utf8',
      // BASH_ENV defines a no-op `sleep` function so the 30 s backoff does not run.
      env: { ...process.env, RUNNER_TEMP: dir, BASH_ENV: './nosleep.sh' },
    });
    const runs = readFileSync(join(dir, 'count'), 'utf8').split('\n').filter(Boolean).length;
    return { runs, status: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const BLOCKS = ['gradle build (neoforge)', 'gradle build (neoforge-ledger)', 'gradle build'];

const REAL_FLAKE = `FAILURE: Build failed with an exception.
* What went wrong:
Could not resolve all dependencies for configuration ':testRuntimeClasspath'.
> Could not resolve org.junit.jupiter:junit-jupiter:6.1.3.
   > Could not GET 'https://repo.maven.apache.org/maven2/org/junit/jupiter/junit-jupiter/6.1.3/junit-jupiter-6.1.3.pom'.
`;

// Synthetic text in Gradle's shape for a remote Maven miss (not a verbatim CI log): Gradle prints the "lock state"
// sentence in every such failure, so it must not be an early exit.
const MAVEN_MISS = `> Could not resolve io.nats:jnats:2.26.4.
   > Could not find io.nats:jnats:2.26.4.
     Searched in the following locations:
       - https://repo.maven.apache.org/maven2/io/nats/jnats/2.26.4/jnats-2.26.4.pom
     Required by:
         project :core

Did not resolve 'io.nats:jnats:2.26.4' which is part of the dependency lock state
`;

const CASES: Array<[string, string, boolean]> = [
  ['real Maven GET failure wrapped in "Could not resolve all"', REAL_FLAKE, true],
  [
    'dependency verification failure',
    'Dependency verification failed for configuration ":compileClasspath"',
    false,
  ],
  [
    'lock state violation',
    "Resolved 'org.foo:bar:1.2' which is not part of the dependency lock state",
    false,
  ],
  [
    '"Could not resolve all" without a network phrase',
    "Could not resolve all dependencies for configuration ':compileClasspath'.\n> No such module",
    false,
  ],
  ['HTTP 429', 'Received status code 429 from server: Too Many Requests', true],
  [
    'real plugin job 429 (jnats pom)',
    "Could not GET 'https://repo.maven.apache.org/maven2/io/nats/jnats/2.26.4/jnats-2.26.4.pom'. Received status code 429 from server: Too Many Requests\nBUILD FAILED in 13s",
    true,
  ],
  ['test failure', '12 tests completed, 1 FAILED\n> Task :test FAILED', false],
  ['Gradle-shaped Maven miss (synthetic text)', MAVEN_MISS, true],
  [
    'Maven miss plus dependency verification failure',
    `Dependency verification failed for configuration ':x'\n${MAVEN_MISS}`,
    false,
  ],
  [
    'script error: Could not find method',
    'Could not find method foo() for arguments [] on object of type org.gradle.api.Project.',
    false,
  ],
  [
    'script error: Could not find property',
    "Could not find property 'x' on project ':core'.",
    false,
  ],
  ['compile failure', 'e: error: cannot find symbol\n  symbol: class Foo', false],
  [
    'verification failure plus Could not GET',
    `Dependency verification failed for configuration ':x'\n${REAL_FLAKE}`,
    false,
  ],
];

describe.skipIf(!bash)('neoforge CI retry order', () => {
  for (const step of BLOCKS) {
    describe(step, () => {
      for (const [name, fixture, retried] of CASES) {
        it(`${retried ? 'retries once' : 'does not retry'}: ${name}`, () => {
          const r = runBlock(step, fixture);
          expect(r.runs).toBe(retried ? 2 : 1);
          expect(r.status).toBe(1);
        });
      }
    });
  }
});

// The three retry blocks must share one early-exit line and one transient-retry line, so they cannot drift apart.
describe('the three Gradle retry blocks share one retry policy', () => {
  it('have identical early-exit and transient-retry grep lines', () => {
    const policies = BLOCKS.map((name) => {
      const run = steps.find((s) => s.name === name)?.run ?? '';
      return run
        .split('\n')
        .filter((l) => l.includes('grep -Eqi'))
        .map((l) => l.replace(/"\$RUNNER_TEMP\/[^"]+"/, '"$LOG"'))
        .join('\n');
    });
    expect(policies[0]?.split('\n') ?? []).toHaveLength(2);
    expect(new Set(policies).size).toBe(1);
  });
});

describe.skipIf(bash)('neoforge CI retry order (skipped: no bash/sh available)', () => {
  it('is skipped', () => {
    expect(bash).toBeUndefined();
  });
});
