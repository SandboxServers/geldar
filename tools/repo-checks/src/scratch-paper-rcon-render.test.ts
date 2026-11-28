/**
 * The rendered Paper scratch stack (compose/phase0.yml plus compose/opt-in/scratch.yml, as deploy/scratch/scratch.sh
 * layers them): RCON on paper is bound to 127.0.0.1 on SCRATCH_RCON_PORT and to no other address, and the game port is
 * never published. `docker compose config` renders against placeholder secret files in a temp dir. Nothing starts a
 * container. Without docker the test is skipped locally; CI must run it.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PHASE0 = `${ROOT}compose/phase0.yml`;
const SCRATCH = `${ROOT}compose/opt-in/scratch.yml`;
const RENDER_TIMEOUT_MS = 120_000;

const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
if (!DOCKER && process.env.CI)
  throw new Error('docker compose is not on PATH and CI is set: the paper render test must run');

interface Published {
  host_ip?: string;
  published?: string;
  target?: number;
}
interface Config {
  services: Record<string, { ports?: Published[] }>;
}

const DIR = mkdtempSync(join(tmpdir(), 'scratch-paper-rcon-'));
const SECRETS = join(DIR, 'secrets');

/** The environment the render needs. The caller's COMPOSE_, SCRATCH_ and GELDAR_ variables are left out. */
const INHERITED = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(COMPOSE_|SCRATCH_|GELDAR_)/.test(k)),
) as Record<string, string>;

function renderWith(extra: Record<string, string>): Config {
  const result = spawnSync(
    'docker',
    ['compose', '-f', PHASE0, '-f', SCRATCH, 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: {
        ...INHERITED,
        SCRATCH_SECRETS_DIR: SECRETS,
        SCRATCH_NATS_AUTH_DIR: SECRETS,
        SCRATCH_RUN_UID: '1000',
        SCRATCH_RUN_GID: '1000',
        GELDAR_WORLD_VOLUME: 'dummy-world',
        ...extra,
      },
      timeout: RENDER_TIMEOUT_MS,
    },
  );
  if (result.status !== 0) throw new Error(`docker compose config failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as Config;
}

describe.skipIf(!DOCKER)(
  'scratch Paper stack: RCON publish (rendered)',
  () => {
    beforeAll(() => {
      mkdirSync(SECRETS);
      for (const name of [
        'postgres.txt',
        'rcon.txt',
        'velocity-forwarding.txt',
        'nats-auth.conf',
        'nats-paper.txt',
        'nats-velocity.txt',
        'nats-eventsink.txt',
        'nats-seed.txt',
      ]) {
        writeFileSync(join(SECRETS, name), 'placeholder\n');
      }
    });
    afterAll(() => {
      rmSync(DIR, { recursive: true, force: true });
    });

    it('binds RCON on paper to 127.0.0.1 on the default SCRATCH_RCON_PORT, never to 25575 on the host', () => {
      const paper = renderWith({}).services.paper?.ports ?? [];
      expect(paper).toHaveLength(1);
      expect(paper[0]?.host_ip).toBe('127.0.0.1');
      expect(paper[0]?.published).toBe('35575');
      expect(paper[0]?.target).toBe(25575);
    });

    it('takes the published port from SCRATCH_RCON_PORT, and publishes no game port', () => {
      const paper = renderWith({ SCRATCH_RCON_PORT: '45599' }).services.paper?.ports ?? [];
      expect(paper.map((p) => [p.host_ip, p.published, p.target])).toEqual([
        ['127.0.0.1', '45599', 25575],
      ]);
      expect(paper.some((p) => p.target === 25565)).toBe(false);
    });
  },
  RENDER_TIMEOUT_MS,
);
