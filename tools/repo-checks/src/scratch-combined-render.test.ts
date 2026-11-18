/**
 * The combined scratch stacks render: the human listener with the NeoForge ledger, the mod and the telemetry sink, in
 * the -f order deploy/scratch/scratch.sh compose_run builds. Each stack is rendered with `docker compose config` against
 * dummy inputs in a temp dir (secret files, jars and properties with placeholder text). Nothing starts a container.
 * The -f lists are assembled here from the same overlay names compose_run uses (scratch.sh is not driven, so the stub
 * harness does not record them). A compose-go merge error only shows on a real render, so this lane needs docker.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OPT = `${ROOT}compose/opt-in/`;
const RENDER_TIMEOUT_MS = 120_000;

const DOCKER = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
if (!DOCKER && process.env.CI)
  throw new Error(
    'docker compose is not on PATH and CI is set: the combined render tests must run, not skip',
  );

interface Svc {
  image?: string;
  environment?: Record<string, string>;
  ports?: { host_ip?: string; published?: string; target?: number }[];
  pids_limit?: number;
  deploy?: { resources?: { limits?: { memory?: string; cpus?: string; pids?: number } } };
}
interface Config {
  services: Record<string, Svc>;
}
interface Rendered {
  status: number | null;
  output: string;
  config?: Config;
}

/** Temp inputs: secret files, jars and properties with placeholder text, and a NATS override as the script writes one. */
const DIR = mkdtempSync(join(tmpdir(), 'scratch-combined-'));
const SECRETS = join(DIR, 'secrets');
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
for (const name of [
  'ledger.jar',
  'agent.jar',
  'mod.jar',
  'ledger.properties',
  'agent.properties',
]) {
  writeFileSync(join(DIR, name), 'placeholder\n');
}
const NATS_OVERRIDE = join(SECRETS, 'nats-override.yml');
writeFileSync(NATS_OVERRIDE, 'services: {}\n');

/** The environment the render needs; the caller's COMPOSE_, SCRATCH_ and GELDAR_ variables are left out. */
const INHERITED = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(COMPOSE_|SCRATCH_|GELDAR_)/.test(k)),
) as Record<string, string>;
const BASE_ENV: Record<string, string> = {
  ...INHERITED,
  SCRATCH_SECRETS_DIR: SECRETS,
  SCRATCH_NATS_AUTH_DIR: SECRETS,
  SCRATCH_RUN_UID: '1000',
  SCRATCH_RUN_GID: '1000',
  SCRATCH_PG_PORT: '35432',
  SCRATCH_NATS_PORT: '34222',
  SCRATCH_NATS_MON_PORT: '38222',
  SCRATCH_MC_PORT: '35565',
  SCRATCH_HUMAN_PORT: '35566',
  SCRATCH_TELEMETRY_OUT: DIR,
  GELDAR_WORLD_VOLUME: 'dummy-world',
  GELDAR_NF_MOD_JAR_HOST: join(DIR, 'mod.jar'),
  GELDAR_NF_MOD_SHA256: '0'.repeat(64),
};
const LEDGER_ENV: Record<string, string> = {
  GELDAR_NF_LEDGER_JAR_HOST: join(DIR, 'ledger.jar'),
  GELDAR_NF_LEDGER_PROPS_HOST: join(DIR, 'ledger.properties'),
  GELDAR_NF_LEDGER_SHA256: '0'.repeat(64),
  GELDAR_NF_OTEL_AGENT_JAR_HOST: join(DIR, 'agent.jar'),
  GELDAR_NF_OTEL_AGENT_PROPS_HOST: join(DIR, 'agent.properties'),
};

const PHASE0 = `${ROOT}compose/phase0.yml`;
const NATS_AUTH = `${ROOT}compose/nats-auth.yml`;
const SCRATCH = `${OPT}scratch.yml`;
const HUMAN = `${OPT}scratch-human.yml`;
const NF = `${OPT}scratch-neoforge.yml`;
const LEDGER = `${OPT}scratch-neoforge-ledger.yml`;
const LEDGER_OFF = `${OPT}scratch-neoforge-ledger-off.yml`;
const MOD = `${OPT}scratch-neoforge-mod.yml`;
const SINK = `${OPT}scratch-neoforge-telemetry.yml`;

interface Stack {
  name: string;
  files: string[];
  env: Record<string, string>;
  human: boolean;
  ledger: boolean;
}

/** The stacks, each in the -f order compose_run builds (phase0 first, the NATS override last). */
const STACKS: Stack[] = [
  {
    name: 'full: human, ledger, mod, sink',
    files: [PHASE0, NATS_AUTH, HUMAN, SCRATCH, NF, LEDGER, MOD, SINK, NATS_OVERRIDE],
    env: { ...BASE_ENV, ...LEDGER_ENV },
    human: true,
    ledger: true,
  },
  {
    name: 'human only, no ledger group',
    files: [PHASE0, NATS_AUTH, HUMAN, SCRATCH, NF, MOD, NATS_OVERRIDE],
    env: BASE_ENV,
    human: true,
    ledger: false,
  },
  {
    name: 'ledger group only, no human',
    files: [PHASE0, NATS_AUTH, SCRATCH, NF, LEDGER, MOD, NATS_OVERRIDE],
    env: { ...BASE_ENV, ...LEDGER_ENV },
    human: false,
    ledger: true,
  },
  {
    name: 'human with the ledger off (telemetry off)',
    files: [PHASE0, NATS_AUTH, HUMAN, SCRATCH, NF, LEDGER_OFF, MOD, NATS_OVERRIDE],
    env: { ...BASE_ENV, GELDAR_NF_TELEMETRY: 'off' },
    human: true,
    ledger: false,
  },
  {
    name: 'ledger and sink, no human',
    files: [PHASE0, NATS_AUTH, SCRATCH, NF, LEDGER, MOD, SINK, NATS_OVERRIDE],
    env: { ...BASE_ENV, ...LEDGER_ENV },
    human: false,
    ledger: true,
  },
];

/** Renders one stack with `docker compose config` as JSON. Synchronous: the timeout is the spawn's own. */
function render(files: string[], env: Record<string, string>): Rendered {
  const args = ['compose', '-p', 'scratch-combined'];
  for (const f of files) args.push('-f', f);
  args.push('config', '--format', 'json');
  const r = spawnSync('docker', args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: RENDER_TIMEOUT_MS,
    windowsHide: true,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) return { status: r.status, output };
  return { status: 0, output, config: JSON.parse(r.stdout) as Config };
}

const rendered = new Map<string, Rendered>();

describe.skipIf(!DOCKER)('combined scratch stacks render', () => {
  beforeAll(() => {
    for (const s of STACKS) rendered.set(s.name, render(s.files, s.env));
  }, RENDER_TIMEOUT_MS);

  afterAll(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  for (const stack of STACKS) {
    describe(stack.name, () => {
      const result = () => rendered.get(stack.name) as Rendered;
      const config = () => {
        const r = result();
        if (r.config === undefined)
          throw new Error(`render failed (exit ${r.status}): ${r.output}`);
        return r.config;
      };

      it('renders without error', () => {
        expect(result().output).not.toMatch(/can't set distinct|invalid compose project/);
        expect(result().status, result().output).toBe(0);
      });

      it(
        'no service sets both pids_limit and deploy.resources.limits.pids',
        () => {
          for (const [name, svc] of Object.entries(config().services)) {
            const both =
              svc.pids_limit !== undefined && svc.deploy?.resources?.limits?.pids !== undefined;
            expect(both, `service ${name} sets both pids forms`).toBe(false);
          }
        },
        RENDER_TIMEOUT_MS,
      );

      it(
        'the paper service is the NeoForge image (TYPE NEOFORGE)',
        () => {
          expect(config().services.paper?.environment?.TYPE).toBe('NEOFORGE');
        },
        RENDER_TIMEOUT_MS,
      );

      if (stack.human) {
        it(
          'velocity-human has one pids form, 256, and publishes on 127.0.0.1 only',
          () => {
            const human = config().services['velocity-human'];
            expect(human).toBeDefined();
            expect(human?.deploy?.resources?.limits?.pids).toBe(256);
            expect(human?.pids_limit).toBeUndefined();
            expect(human?.ports).toEqual([
              expect.objectContaining({ host_ip: '127.0.0.1', published: '35566', target: 25565 }),
            ]);
          },
          RENDER_TIMEOUT_MS,
        );
      } else {
        it(
          'has no velocity-human service',
          () => {
            expect(config().services['velocity-human']).toBeUndefined();
          },
          RENDER_TIMEOUT_MS,
        );
      }
    });
  }
});
