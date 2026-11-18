/**
 * The compose arguments that dc() in deploy/nf-deploy.sh builds for the extra mods: one -f per enabled name, in allowlist order,
 * after the compose file. dc() is extracted from the script and run under sh with a fake docker that logs its argv, so no
 * docker call is made. With no name enabled the argv is the one dc() built before the extra mods existed.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { skipWithoutSh, slash } from './scratch-harness.js';

const ROOT = slash(fileURLToPath(new URL('../../../', import.meta.url))).replace(/\/$/, '');
const DEPLOY = `${ROOT}/deploy/nf-deploy.sh`;
const COMPOSE = `${ROOT}/compose/nf-live.yml`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs dc() with EXTRA_ENABLED set to `enabled` (the value check_extra_mods leaves) and returns the logged argv. */
function runDc(enabled: string) {
  const base = mkdtempSync(join(tmpdir(), 'nf-extra-dc-'));
  dirs.push(base);
  const bin = join(base, 'bin');
  mkdirSync(bin);
  const log = join(base, 'docker.log');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >> "${slash(log)}"\nexit 0\n`, {
    mode: 0o755,
  });
  const deployText = readFileSync(DEPLOY, 'utf8');
  const start = deployText.indexOf('dc() {');
  const dcText = deployText.slice(start, deployText.indexOf('\n}\n', start) + 3);
  const driver = join(base, 'driver.sh');
  writeFileSync(
    driver,
    [
      `ROOT="${ROOT}"`,
      'PROJECT=geldar-nf',
      `COMPOSE_FILE="${COMPOSE}"`,
      'HUMAN=0',
      'TELEMETRY=0',
      'TELEMETRY_OFF=0',
      `EXTRA_ENABLED="${enabled}"`,
      dcText,
      'dc ps',
      '',
    ].join('\n'),
  );
  const { PATH: _p, ...rest } = process.env;
  const r = spawnSync('sh', [slash(driver)], {
    encoding: 'utf8',
    env: { ...rest, PATH: `${slash(bin)}${delimiter}${process.env.PATH ?? ''}` },
  });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(log, 'utf8').trim();
}

const overlay = (name: string) => `-f ${ROOT}/compose/nf-live-mod-${name}.yml`;

describe.skipIf(skipWithoutSh())(
  'extra mods: dc() adds the overlays (sh, no docker)',
  { timeout: 60_000 },
  () => {
    it('unset: the argv is the compose file and the subcommand, with no overlay', () => {
      expect(runDc('')).toBe(`compose -p geldar-nf -f ${COMPOSE} ps`);
    });

    it('chunky and bluemap enabled: one -f each, in allowlist order, after the compose file', () => {
      expect(runDc('chunky bluemap')).toBe(
        `compose -p geldar-nf -f ${COMPOSE} ${overlay('chunky')} ${overlay('bluemap')} ps`,
      );
    });

    it('only bluemap enabled: its overlay alone', () => {
      expect(runDc('bluemap')).toBe(`compose -p geldar-nf -f ${COMPOSE} ${overlay('bluemap')} ps`);
    });
  },
);
