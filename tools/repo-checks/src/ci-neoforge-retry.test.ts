import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

type Step = { name?: string; run?: string };
const steps = (parse(readFileSync(CI, 'utf8')) as { jobs: { neoforge: { steps: Step[] } } }).jobs
  .neoforge.steps;

// Git's bash (the retry blocks use `set -o pipefail`); on Windows the PATH `bash` may be WSL, so look for Git first.
function findBash(): string | undefined {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
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

const BLOCKS = ['gradle build (neoforge)', 'gradle build (neoforge-ledger)'];

const REAL_FLAKE = `FAILURE: Build failed with an exception.
* What went wrong:
Could not resolve all dependencies for configuration ':testRuntimeClasspath'.
> Could not resolve org.junit.jupiter:junit-jupiter:6.1.3.
   > Could not GET 'https://repo.maven.apache.org/maven2/org/junit/jupiter/junit-jupiter/6.1.3/junit-jupiter-6.1.3.pom'.
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
  ['test failure', '12 tests completed, 1 FAILED\n> Task :test FAILED', false],
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

describe.skipIf(bash)('neoforge CI retry order (skipped: no bash/sh available)', () => {
  it('is skipped', () => {
    expect(bash).toBeUndefined();
  });
});
