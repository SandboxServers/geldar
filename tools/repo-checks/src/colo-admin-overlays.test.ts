/**
 * The adm and sov functions of deploy/colo-admin.sh hand their overlays to compose_call in deploy/common.sh. The two
 * functions are extracted from the script and run under sh, with ADMIN_OVERLAY set to a token overlay and
 * GELDAR_COLO_EXTRA_OVERLAY set to the value under test. A fake docker on PATH prints each argument on its own line, so no
 * daemon is needed and nothing is started.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const KINO = 'compose/opt-in/colo-kino.yml';
const AGENTS = 'compose/opt-in/colo-paper-agents.yml';
const TOKEN = 'work/token-overlay.yml';
const shOk = spawnSync('sh', ['-c', 'exit 0']).status === 0;

/** The argv that adm (with ADMIN_OVERLAY set to tokenOverlay, or unset when '') and then sov pass to docker. */
function callsOf(value: string, tokenOverlay: string): [string[], string[]] {
  const bin = mkdtempSync(join(tmpdir(), 'fake-docker-'));
  try {
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n', {
      mode: 0o755,
    });
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(env)) if (name.startsWith('GELDAR_')) delete env[name];
    env.GELDAR_COLO_EXTRA_OVERLAY = value;
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`;
    const script =
      '. "$0"; ADMIN_OVERLAY="$2"; eval "$(sed -n -e \'/^adm() {/,/^}/p\' -e \'/^sov() {/,/^}/p\' "$1")"; adm config; echo SEP; sov config';
    const out = execFileSync(
      'sh',
      ['-c', script, 'deploy/common.sh', 'deploy/colo-admin.sh', tokenOverlay],
      {
        cwd: ROOT,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const lines = out.split('\n').filter((line) => line !== '');
    const cut = lines.indexOf('SEP');
    return [lines.slice(0, cut), lines.slice(cut + 1)];
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

/** The file named after each -f, in argument order. */
function filesOf(argv: string[]): string[] {
  return argv.flatMap((arg, i) => (arg === '-f' ? [argv[i + 1] ?? ''] : []));
}

describe.skipIf(!shOk)(
  'colo-admin.sh adm and sov overlay files (compose_call in deploy/common.sh)',
  () => {
    it('adm adds the token overlay and one -f per colon entry; sov adds one -f per entry and never the token overlay', () => {
      const [adm, sov] = callsOf(`${KINO}:${AGENTS}`, TOKEN);
      const admFiles = filesOf(adm);
      expect(admFiles).toHaveLength(6);
      expect(admFiles).toContain(TOKEN);
      expect(admFiles.slice(-2)).toEqual([KINO, AGENTS]);
      expect(adm[adm.indexOf('--profile') + 1]).toBe('admin');
      const sovFiles = filesOf(sov);
      expect(sovFiles).toHaveLength(5);
      expect(sovFiles).not.toContain(TOKEN);
      expect(sovFiles.slice(-2)).toEqual([KINO, AGENTS]);
      expect(sov[sov.indexOf('--profile') + 1]).toBe('sovereign');
    });

    it('the token overlay comes after the base files and before --profile admin, and the subcommand is last', () => {
      const [adm, sov] = callsOf(`${KINO}:${AGENTS}`, TOKEN);
      expect(adm.slice(adm.indexOf(TOKEN) - 1)).toEqual([
        '-f',
        TOKEN,
        '-f',
        KINO,
        '-f',
        AGENTS,
        '--profile',
        'admin',
        'config',
      ]);
      expect(sov.slice(-3)).toEqual(['--profile', 'sovereign', 'config']);
      const [blankAdm] = callsOf('', TOKEN);
      expect(blankAdm.slice(-5)).toEqual(['-f', TOKEN, '--profile', 'admin', 'config']);
    });

    it('a single selected file adds one -f to each call, in last place', () => {
      const [adm, sov] = callsOf(AGENTS, TOKEN);
      expect(filesOf(adm)).toHaveLength(5);
      expect(filesOf(adm).slice(-1)).toEqual([AGENTS]);
      expect(filesOf(sov)).toHaveLength(4);
      expect(filesOf(sov).slice(-1)).toEqual([AGENTS]);
    });

    it('a blank selection adds no overlay to adm or sov, and an unset token overlay adds none to adm', () => {
      const [adm, sov] = callsOf('', '');
      expect(filesOf(adm)).toHaveLength(3);
      expect(filesOf(sov)).toHaveLength(3);
      expect(filesOf(adm)).not.toContain('');
    });
  },
);
