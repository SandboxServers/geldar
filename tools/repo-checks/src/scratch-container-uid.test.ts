/**
 * The scratch stack when the account uid differs from the eventsink image's uid (the node user, 1000). The eventsink runs
 * as the account's uid:gid through compose/opt-in/scratch.yml, so the 0600 secrets and the NATS files it reads are its
 * own: no mode change, no ACL. Covers the uid checks in deploy/scratch/scratch.sh under sh with the stubs from
 * scratch-harness.ts, and the overlay text. Nothing here starts a container. The script tests skip when no sh is on PATH.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUTH,
  type Env,
  JARS,
  runScript,
  SCRIPT,
  skipWithoutSh,
  started,
  withSecrets,
} from './scratch-harness.js';

const ACCT_1001: Env = { STUB_ACCT_UID: '1001', STUB_ACCT_GID: '1001' };
const NF = { SCRATCH_PLATFORM: 'neoforge' };
const SCRATCH_YML = readFileSync(
  new URL('../../../compose/opt-in/scratch.yml', import.meta.url),
  'utf8',
);
const NF_YML = readFileSync(
  new URL('../../../compose/opt-in/scratch-neoforge.yml', import.meta.url),
  'utf8',
);
const callOf = (calls: string[], verb: string) => calls.find((c) => c.includes(verb)) ?? '';

/** The text of one top-level service block of an overlay file, from its key to the next service or top-level key. */
function serviceBlock(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) return '';
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) || /^ {2}\S/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

describe.skipIf(skipWithoutSh())(
  'scratch script: the account uid and the eventsink user',
  { timeout: 120_000 },
  () => {
    it('a non-root account other than 1000 starts, and the compose call runs the eventsink as its uid:gid', () => {
      const run = runScript(
        ['up'],
        { ...AUTH, ...ACCT_1001 },
        { ...JARS, watch: ['state/geldar-scratch/scratch-a'] },
      );
      expect(run.status).toBe(0);
      expect(started(run)).toBe(true);
      expect(callOf(run.calls, ' up -d')).toContain('RUN=1001:1001');
      expect(run.present['state/geldar-scratch/scratch-a']).toBe(true);
    });

    it('the eventsink user is set under the default uid 1000 too: compose cannot branch on the uid', () => {
      const run = runScript(['up'], AUTH, JARS);
      expect(started(run)).toBe(true);
      expect(callOf(run.calls, ' up -d')).toContain('RUN=1000:1000');
    });

    it('root is refused with exit 1 and nothing is made, with or without SCRATCH_CONTAINER_UID', () => {
      for (const extra of [{}, { SCRATCH_CONTAINER_UID: '1000' }]) {
        const run = runScript(
          ['up'],
          { ...AUTH, STUB_ACCT_UID: '0', ...extra },
          { ...JARS, watch: ['state/geldar-scratch'] },
        );
        expect(run.status).toBe(1);
        expect(run.stderr).toContain('non-root');
        expect(run.present['state/geldar-scratch']).toBe(false);
        expect(started(run)).toBe(false);
      }
    });

    it('GELDAR_SERVICE_UID set to another uid exits 1 before any state directory is made', () => {
      const run = runScript(
        ['up'],
        { ...AUTH, ...ACCT_1001, GELDAR_SERVICE_UID: '1000' },
        { ...JARS, watch: ['state/geldar-scratch'] },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('run as uid 1000');
      expect(run.present['state/geldar-scratch']).toBe(false);
      expect(started(run)).toBe(false);
    });

    it('the uid and the gid are read from their own variables: an account of 1001:1002 runs the eventsink as 1001:1002', () => {
      const run = runScript(
        ['up'],
        { ...AUTH, STUB_ACCT_UID: '1001', STUB_ACCT_GID: '1002' },
        JARS,
      );
      expect(run.status).toBe(0);
      expect(callOf(run.calls, ' up -d')).toContain('RUN=1001:1002');
    });

    it('GELDAR_SERVICE_UID that is not digits exits 2 with a clear message and starts nothing', () => {
      for (const bad of ['10x1', '-1001', '1001 ', '1.5', 'abc']) {
        const run = runScript(
          ['up'],
          { ...AUTH, ...ACCT_1001, GELDAR_SERVICE_UID: bad },
          { ...JARS, watch: ['state/geldar-scratch'] },
        );
        expect(run.status, `GELDAR_SERVICE_UID='${bad}'`).toBe(2);
        expect(run.stderr).toContain('GELDAR_SERVICE_UID must be digits only');
        expect(run.present['state/geldar-scratch']).toBe(false);
        expect(started(run)).toBe(false);
      }
    });

    it('GELDAR_SERVICE_UID equal to the account uid starts', () => {
      const run = runScript(['up'], { ...AUTH, ...ACCT_1001, GELDAR_SERVICE_UID: '1001' }, JARS);
      expect(run.status).toBe(0);
      expect(started(run)).toBe(true);
    });

    it('SCRATCH_CONTAINER_UID empty, non-digit or 0 exits 2 and starts nothing', () => {
      for (const bad of ['', '10x', '-1', '0']) {
        const run = runScript(
          ['up'],
          { ...AUTH, ...ACCT_1001, SCRATCH_CONTAINER_UID: bad },
          { ...JARS, watch: ['state/geldar-scratch'] },
        );
        expect(run.status, `SCRATCH_CONTAINER_UID='${bad}'`).toBe(2);
        expect(run.stderr).toContain('SCRATCH_CONTAINER_UID');
        expect(run.present['state/geldar-scratch']).toBe(false);
        expect(started(run)).toBe(false);
      }
    });

    it('SCRATCH_CONTAINER_UID that differs from the account uid is reported and still starts', () => {
      const run = runScript(['up'], { ...AUTH, ...ACCT_1001, SCRATCH_CONTAINER_UID: '1000' }, JARS);
      expect(run.status).toBe(0);
      expect(run.stderr).toContain("not the image's uid 1000");
      expect(callOf(run.calls, ' up -d')).toContain('RUN=1001:1001');
    });

    it('SCRATCH_CONTAINER_UID equal to the account uid is not reported', () => {
      const run = runScript(['up'], { ...AUTH, ...ACCT_1001, SCRATCH_CONTAINER_UID: '1001' }, JARS);
      expect(run.status).toBe(0);
      expect(run.stderr).not.toContain("not the image's uid");
    });

    it('down under account uid 1001 still removes the state directory it owns', () => {
      const run = runScript(['down'], ACCT_1001, {
        prepare: withSecrets,
        watch: ['state/geldar-scratch/scratch-a'],
      });
      expect(run.status).toBe(0);
      expect(run.present['state/geldar-scratch/scratch-a']).toBe(false);
    });

    it('NeoForge with account uid 1001 and SCRATCH_CONTAINER_UID=1000: the nf secrets directory is made, the eventsink runs as 1001:1001, and the compose call carries the NeoForge overlay', () => {
      const run = runScript(
        ['up', 'nf'],
        { ...AUTH, ...NF, ...ACCT_1001, SCRATCH_CONTAINER_UID: '1000' },
        { ...JARS, watch: ['state/geldar-scratch/scratch-nf'] },
      );
      const up = callOf(run.calls, ' up -d');
      expect(run.status).toBe(0);
      expect(started(run)).toBe(true);
      expect(run.present['state/geldar-scratch/scratch-nf']).toBe(true);
      expect(up).toContain('opt-in/scratch-neoforge.yml');
      expect(up).toContain('opt-in/scratch.yml');
      expect(up).toContain('RUN=1001:1001');
    });
  },
);

describe('scratch overlay: the account uid and the modes', () => {
  it('gives only the eventsink a user, as the account uid:gid, with no default node user', () => {
    const block = serviceBlock(SCRATCH_YML, 'eventsink');
    expect(block).toContain(
      'user: "${SCRATCH_RUN_UID:?set by deploy/scratch/scratch.sh}:${SCRATCH_RUN_GID:?set by deploy/scratch/scratch.sh}"',
    );
    expect(SCRATCH_YML.match(/^\s+user:/gm)).toHaveLength(1);
  });

  it('the NeoForge overlay sets no user: the nf secrets are the same three files, read by the eventsink', () => {
    expect(NF_YML).not.toMatch(/^\s+user:/m);
    expect(NF_YML).toContain('paper:');
    expect(NF_YML).toContain('SCRATCH_RCON_PORT');
  });

  it('sets the itzg UID and GID of paper and velocity to the account uid and gid, as compose/colo.yml does', () => {
    for (const name of ['paper', 'velocity']) {
      const block = serviceBlock(SCRATCH_YML, name);
      expect(block, name).toContain('UID: "${SCRATCH_RUN_UID:?set by deploy/scratch/scratch.sh}"');
      expect(block, name).toContain('GID: "${SCRATCH_RUN_GID:?set by deploy/scratch/scratch.sh}"');
    }
  });

  it('gives postgres, nats, paper and velocity no user override', () => {
    for (const name of ['postgres', 'nats', 'paper', 'velocity']) {
      expect(serviceBlock(SCRATCH_YML, name)).not.toMatch(/^\s+user:/m);
    }
  });

  it('the script changes modes only on the 0700 state root: every chmod is 700 and none is 600 or wider', () => {
    const modes = [...SCRIPT.matchAll(/\bchmod\s+(\S+)/g)].map((m) => m[1]);
    expect(modes.length).toBeGreaterThan(0);
    for (const mode of modes) expect(mode).toBe('700');
  });

  it('keeps the umask at 077, so the secret files are created 0600', () => {
    expect(SCRIPT).toContain('umask 077');
  });

  it('never uses ACLs and never names the modes that would open a secret to another uid', () => {
    expect(SCRIPT).not.toMatch(/setfacl|getfacl/);
    expect(SCRIPT).not.toMatch(/\b(0?644|0?711|0?755|0?666)\b/);
  });
});

/** The render tests need docker compose. Locally they skip without it; with CI set they throw at collection, as the sh
 * tests do, because the typescript job runs on ubuntu-24.04, which ships Docker and Compose v2. */
const DOCKER =
  spawnSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8' }).status === 0;
function renderSkip(): boolean {
  if (DOCKER) return false;
  if (process.env.CI)
    throw new Error(
      'docker compose is not available and CI is set: the compose render test must run, not skip',
    );
  return true;
}

interface RenderedService {
  user?: string;
  environment?: Record<string, string>;
  healthcheck?: {
    test?: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
}

/** The merged config as compose renders it: phase0, nats-auth, the scratch overlay and, when asked, the NeoForge overlay.
 * The variables are set here, so the test does not depend on the caller's environment (SCRATCH_, GELDAR_ and PAPER_ keys
 * are dropped). Nothing starts: compose config only renders. */
function renderServices(neoforge: boolean): Record<string, RenderedService> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(SCRATCH_|GELDAR_|PAPER_)/.test(key)) env[key] = value;
  }
  const file = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
  const files = ['compose/phase0.yml', 'compose/nats-auth.yml', 'compose/opt-in/scratch.yml'];
  if (neoforge) files.push('compose/opt-in/scratch-neoforge.yml');
  const args = ['compose', '-p', 'scratch-render'];
  for (const rel of files) args.push('-f', file(rel));
  args.push('config', '--format', 'json');
  const run = spawnSync('docker', args, {
    encoding: 'utf8',
    env: {
      ...env,
      SCRATCH_SECRETS_DIR: file('compose'),
      GELDAR_WORLD_VOLUME: 'scratch-render_paper-data',
      SCRATCH_RUN_UID: '1001',
      SCRATCH_RUN_GID: '1002',
    },
  });
  expect(run.status, run.stderr).toBe(0);
  return (JSON.parse(run.stdout) as { services: Record<string, RenderedService> }).services;
}

describe.skipIf(renderSkip())(
  'scratch compose render: the account uid and gid reach each service',
  { timeout: 60_000 },
  () => {
    for (const neoforge of [false, true]) {
      it(`${neoforge ? 'with' : 'without'} the NeoForge overlay: eventsink user 1001:1002, paper and velocity UID 1001 and GID 1002, no user on postgres or nats`, () => {
        const svc = renderServices(neoforge);
        expect(svc.eventsink?.user).toBe('1001:1002');
        for (const name of ['paper', 'velocity']) {
          expect(svc[name]?.environment?.UID, name).toBe('1001');
          expect(svc[name]?.environment?.GID, name).toBe('1002');
          expect(svc[name]?.user, name).toBeUndefined();
        }
        expect(svc.postgres?.user, 'postgres').toBeUndefined();
        expect(svc.nats?.user, 'nats').toBeUndefined();
      });
    }
  },
);

describe.skipIf(renderSkip())(
  'scratch compose render: the NATS healthcheck probes the client port, not the monitor',
  { timeout: 60_000 },
  () => {
    for (const neoforge of [false, true]) {
      it(`${neoforge ? 'with' : 'without'} the NeoForge overlay: nats runs nc -z on 4222 every 5s and never the 8222 monitor or wget`, () => {
        const nats = renderServices(neoforge).nats;
        expect(nats?.healthcheck?.test).toEqual(['CMD', 'nc', '-z', '127.0.0.1', '4222']);
        expect(nats?.healthcheck).toMatchObject({
          interval: '5s',
          timeout: '5s',
          retries: 10,
          start_period: '5s',
        });
        expect(JSON.stringify(nats?.healthcheck)).not.toMatch(/8222|wget/);
      });
    }
  },
);
