// Tests for deploy/genesis/prune-deploy-images.sh against a docker stand-in that lists images from a file and records `image rm` calls.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SH } from './colo-deploy-fixture';

const SCRIPT = fileURLToPath(new URL('../genesis/prune-deploy-images.sh', import.meta.url));
const p = (s: string) => s.replaceAll(String.fromCharCode(92), '/');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const d = (c: string) => `sha256:${c.repeat(64)}`;
const body = (c: string) => `registry.example.invalid/geldar/body@${d(c)}`;
const mind = (c: string) => `registry.example.invalid/geldar/mind@${d(c)}`;
const other = `registry.example.invalid/othertenant/app@${d('f')}`;
const env = (...refs: string[]) => `${refs.map((r, i) => `GELDAR_X${i}_IMAGE=${r}`).join('\n')}\n`;

function fixture(images: string[], current: string | null, previous: string | null) {
  const root = mkdtempSync(join(tmpdir(), 'prune-img-'));
  dirs.push(root);
  mkdirSync(join(root, 'state'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'images.txt'), `${images.join('\n')}\n`);
  writeFileSync(
    join(root, 'bin', 'docker'),
    '#!/bin/sh\nprintf "%s\n" "$*" >> "$DOCKER_CALLS_LOG"\ncase "$*" in\n  "images "*) cat "$DOCKER_IMAGES";;\nesac\nexit 0\n',
    { mode: 0o755 },
  );
  if (current !== null) writeFileSync(join(root, 'release.env'), current);
  if (previous !== null) writeFileSync(join(root, 'state', 'previous.env'), previous);
  return root;
}

function run(root: string, args: string[] = []) {
  const r = spawnSync(SH, [p(SCRIPT), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GELDAR_RELEASE_FILE: p(join(root, 'release.env')),
      GELDAR_STATE_DIR: p(join(root, 'state')),
      DOCKER_IMAGES: p(join(root, 'images.txt')),
      DOCKER_CALLS_LOG: p(join(root, 'calls.log')),
      PATH: [p(join(root, 'bin')), dirname(SH), process.env.PATH ?? ''].join(delimiter),
    },
  });
  const calls = existsSync(join(root, 'calls.log'))
    ? readFileSync(join(root, 'calls.log'), 'utf8')
    : '';
  return { code: r.status, out: r.stdout, err: r.stderr, calls };
}

const all = [body('1'), body('2'), body('3'), mind('1'), mind('2'), other];

describe('prune-deploy-images.sh', () => {
  it('dry run lists the old Geldar references and calls no rm', () => {
    const root = fixture(all, env(body('3'), mind('2')), env(body('2'), mind('1')));
    const r = run(root);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`would remove ${body('1')}\n`);
    expect(r.calls).not.toContain('image rm');
  });

  it('--apply removes only references outside the current and previous sets', () => {
    const root = fixture(all, env(body('3'), mind('2')), env(body('2'), mind('1')));
    const r = run(root, ['--apply']);
    expect(r.code).toBe(0);
    expect(r.calls).toContain(`image rm ${body('1')}`);
    expect(r.calls).not.toContain(body('2'));
    expect(r.calls).not.toContain(body('3'));
    expect(r.calls).not.toContain(mind('1'));
  });

  it("never touches another tenant's image, and never runs a global prune", () => {
    const root = fixture(all, env(body('3'), mind('2')), env(body('2'), mind('1')));
    const r = run(root, ['--apply']);
    expect(r.calls).not.toContain('othertenant');
    expect(r.calls).not.toMatch(/prune/);
  });

  it('works with no previous manifest, keeping only the current set', () => {
    const root = fixture(all, env(body('3'), mind('2')), null);
    const r = run(root);
    expect(r.out).toContain(`would remove ${body('2')}`);
    expect(r.out).toContain(`would remove ${mind('1')}`);
    expect(r.out).not.toContain(body('3'));
  });

  it.each([
    ['missing', null],
    ['with no images', '# only a comment\n'],
  ])('a current manifest that is %s removes nothing and exits 1', (_l, cur) => {
    const root = fixture(all, cur, null);
    const r = run(root, ['--apply']);
    expect(r.code).toBe(1);
    expect(r.calls).not.toContain('image rm');
  });

  it('a held colo-cd lock removes nothing and exits 1', () => {
    const root = fixture(all, env(body('3')), null);
    mkdirSync(join(root, 'state', 'cd.lock'));
    const r = run(root, ['--apply']);
    expect(r.code).toBe(1);
    expect(r.calls).not.toContain('image rm');
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(true);
  });

  it('releases its lock, and rejects unknown arguments', () => {
    const root = fixture(all, env(body('3')), null);
    run(root, ['--apply']);
    expect(existsSync(join(root, 'state', 'cd.lock'))).toBe(false);
    expect(run(root, ['--force']).code).toBe(1);
  });
});
