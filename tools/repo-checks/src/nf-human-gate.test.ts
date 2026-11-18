import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The NF_HUMAN=on gate of deploy/nf-human-lib.sh: check_human_inputs refuses before any docker call when the human lane's NATS
// password file (nats-human.txt) is missing or empty. The gate runs in a temp ROOT with dummy overlay, toml and jar files; no
// secret value is written, and the NF secrets directory is a temp directory outside the repo. gates() in deploy/nf-deploy.sh
// calls check_human_inputs, and up and plan run gates(), so the refusal covers both.
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const LIB = join(ROOT, 'deploy', 'nf-human-lib.sh');
const SCRIPT = readFileSync(join(ROOT, 'deploy', 'nf-deploy.sh'), 'utf8');
const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;
const posix = (p: string) => p.replace(/\\/g, '/');

// Runs check_human_inputs with the given environment. die prints its message to stderr and exits 1, as nf-deploy.sh's does.
function runGate(tmp: string, env: Record<string, string | undefined>) {
  const script = [
    'die() { echo "$1" >&2; exit 1; }',
    'say() { echo "$1"; }',
    'PORT=46565',
    '. "$LIB"',
    'check_human_inputs',
  ].join('\n');
  const merged: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete merged.NF_HUMAN;
  delete merged.NF_HUMAN_BIND;
  delete merged.NF_HUMAN_PORT;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return spawnSync('sh', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...merged,
      ROOT: posix(tmp),
      LIB: posix(LIB),
      NF_SECRETS_DIR: posix(join(tmp, 'secrets')),
    },
  });
}

describe.skipIf(!hasSh)(
  'nf-human-lib.sh: the human gate needs the human NATS password file',
  () => {
    let tmp: string;
    const secrets = () => join(tmp, 'secrets');
    const writeSecret = (name: string, text: string) => writeFileSync(join(secrets(), name), text);

    beforeAll(() => {
      tmp = mkdtempSync(join(tmpdir(), 'nf-human-gate-'));
      mkdirSync(secrets(), { recursive: true });
      mkdirSync(join(tmp, 'compose', 'velocity'), { recursive: true });
      mkdirSync(join(tmp, 'plugin', 'velocity-identity', 'build', 'libs'), { recursive: true });
      writeFileSync(join(tmp, 'compose', 'nf-live-human.yml'), 'services: {}\n');
      writeFileSync(
        join(tmp, 'compose', 'velocity', 'velocity-nf-human.toml'),
        'config-version = "2.7"\n',
      );
      writeFileSync(
        join(tmp, 'plugin', 'velocity-identity', 'build', 'libs', 'geldar-velocity-identity.jar'),
        'jar',
      );
    });
    afterAll(() => {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    const on = { NF_HUMAN: 'on', NF_HUMAN_BIND: '127.0.0.1' };

    it('refuses NF_HUMAN=on when nats-human.txt is missing, names the file and points at the generator', () => {
      rmSync(join(secrets(), 'nats-human.txt'), { force: true });
      const r = runGate(tmp, on);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('nats-human.txt');
      expect(r.stderr).toContain('shard nats-auth nf --live');
      expect(r.stderr).not.toContain(tmp);
    });

    it('refuses NF_HUMAN=on when nats-human.txt is empty (a crash between create and write leaves that)', () => {
      writeSecret('nats-human.txt', '');
      const r = runGate(tmp, on);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('nats-human.txt');
      expect(r.stderr).not.toContain(tmp);
    });

    it('accepts NF_HUMAN=on when nats-human.txt is present and not empty', () => {
      writeSecret('nats-human.txt', 'x'.repeat(32));
      const r = runGate(tmp, on);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
    });

    it('does not ask for nats-human.txt with NF_HUMAN unset: the base ten-file node keeps working', () => {
      rmSync(join(secrets(), 'nats-human.txt'), { force: true });
      const r = runGate(tmp, { NF_HUMAN: undefined });
      expect(r.status).toBe(0);
    });

    it('does not ask for nats-human.txt with NF_HUMAN=off', () => {
      rmSync(join(secrets(), 'nats-human.txt'), { force: true });
      const r = runGate(tmp, { NF_HUMAN: 'off' });
      expect(r.status).toBe(0);
    });

    it('is reached from gates(), which plan and up run (deploy/nf-deploy.sh)', () => {
      expect(SCRIPT).toMatch(/gates\(\) \{[\s\S]*?check_human_inputs[\s\S]*?\n\}/);
    });
  },
);
