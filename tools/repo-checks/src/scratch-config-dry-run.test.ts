import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `scratch.sh config nf` (deploy/scratch/scratch-config.sh) renders the project with compose config and never starts it. A docker
// stub records every call; the stub answers only the version probe. The -f list must be the one compose_run builds for up.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(ROOT, 'deploy/scratch/scratch.sh');
const HAS_SH = spawnSync('sh', ['-c', 'exit 0']).status === 0;

let dir = '';
let logFile = '';

beforeAll(() => {
  if (!HAS_SH) return;
  dir = mkdtempSync(join(tmpdir(), 'scratch-config-'));
  logFile = join(dir, 'calls.log');
  writeFileSync(
    join(dir, 'docker'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_LOG"\ncase "$*" in\n  "compose version --short") echo 2.30.0 ;;\n  *" config") [ -n "$DOCKER_FAIL" ] && exit 3 ;;\nesac\nexit 0\n',
  );
  spawnSync('sh', ['-c', `chmod +x "${join(dir, 'docker')}"`]);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  out: string;
  calls: string[][];
}

function run(verb: string[], env: Record<string, string> = {}): Run {
  writeFileSync(logFile, '');
  const r = spawnSync('sh', [SCRIPT, ...verb], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
      DOCKER_LOG: logFile,
      SCRATCH_PLATFORM: 'neoforge',
      SCRATCH_EXTRA_MODS: '1',
      ...env,
    },
  });
  const calls = readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.split(' '));
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls };
}

// The -f values of a logged docker call, as repo-relative paths (compose/...), in command-line order.
function composeFiles(call: string[]): string[] {
  const files: string[] = [];
  for (let i = 0; i < call.length - 1; i++) {
    if (call[i] === '-f') files.push(call[i + 1]?.replace(/^.*?\/compose\//, 'compose/') ?? '');
  }
  return files;
}

// The layers compose_run prepends, read from scratch.sh (reversed to command-line order). A layer counts when its guard names no
// variable other than the platform and the extra-mods switch, which the test sets; the other guards are unset here.
function expectedLayers(): string[] {
  const text = readFileSync(SCRIPT, 'utf8');
  const start = text.indexOf('\ncompose_run() {');
  const end = text.indexOf('\n}\n', start);
  const layers: string[] = [];
  for (const line of text.slice(start, end).split('\n')) {
    const m = /^(.*?)set -- (?:-p "\$PROJECT" )?-f "\$ROOT\/(compose\/[^"]+)" "\$@"/.exec(line);
    if (!m) continue;
    const vars = [...(m[1] ?? '').matchAll(/\$\{?([A-Z_]+)/g)].map((x) => x[1]);
    if (vars.every((v) => v === 'PLATFORM' || v === 'SCRATCH_EXTRA_MODS')) layers.push(m[2] ?? '');
  }
  return layers.reverse();
}

const SKIP = !HAS_SH;

describe.skipIf(SKIP)('scratch.sh config nf: renders, starts nothing', () => {
  it('exits with compose config status 0 and runs compose config as its only compose call', () => {
    const r = run(['config', 'nf']);
    expect(r.status, r.out).toBe(0);
    const compose = r.calls.filter((c) => c[0] === 'compose' && c[1] === '-p');
    expect(compose.length).toBe(1);
    expect(compose[0]?.at(-1)).toBe('config');
  });

  it('never calls up, create, run, start or volume create', () => {
    const r = run(['config', 'nf']);
    const verbs = r.calls.flatMap((c) =>
      c.filter((t) => ['up', 'create', 'run', 'start', 'volume'].includes(t)),
    );
    expect(verbs).toEqual([]);
  });

  it('passes the same -f list that compose_run builds, with compose/phase0.yml first and the extra-mods overlay', () => {
    const r = run(['config', 'nf']);
    const call = r.calls.find((c) => c[1] === '-p');
    expect(call).toBeDefined();
    const files = composeFiles(call ?? []);
    expect(files[0]).toBe('compose/phase0.yml');
    expect(files).toContain('compose/opt-in/scratch-neoforge-extra-mods.yml');
    // Some layers sit inside runtime `if` blocks (NATS, probe, mind, telemetry), so the list is checked as an ordered subset.
    const expected = expectedLayers();
    expect(files.every((f) => expected.includes(f))).toBe(true);
    expect(expected.filter((f) => files.includes(f))).toEqual(files);
  });

  it('without SCRATCH_EXTRA_MODS the extra-mods overlay is not in the list', () => {
    const r = run(['config', 'nf'], { SCRATCH_EXTRA_MODS: '' });
    const call = r.calls.find((c) => c[1] === '-p');
    expect(composeFiles(call ?? [])).not.toContain(
      'compose/opt-in/scratch-neoforge-extra-mods.yml',
    );
  });

  it('exits with compose config failure status when compose config fails', () => {
    const r = run(['config', 'nf'], { DOCKER_FAIL: '1' });
    expect(r.status).toBe(3);
  });
});
