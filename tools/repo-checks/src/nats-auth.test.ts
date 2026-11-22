/**
 * The NATS auth overlays and the generator's static wiring (`./geldar.ps1 shard nats-auth`, decisions 0067, 0080 and 0087).
 * The compose overlays merge offline through docker compose and skip when docker is not on PATH. The rendered output of
 * the generator is in nats-auth-generator.test.ts; the shared fixtures are in nats-auth-fixtures.ts.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectedTable,
  functionBody,
  GENERATOR_TIMEOUT_MS,
  hasDocker,
  hasPwsh,
  OVERLAYS,
  parseEntries,
  ROLES,
  ROOT,
  renderGenerator,
  SCRIPT,
  SHARD,
  subjectMatches,
} from './nats-auth-fixtures.ts';

/**
 * `docker compose` over the named files in compose/, rendered as JSON. Offline: no image is pulled. The adam profile is on,
 * so golem-body (the idle Adam, decision 0212) is in the render; without it compose leaves that service out.
 */
function renderCompose(...files: string[]) {
  const args = ['--profile', 'adam', ...files.flatMap((f) => ['-f', join(ROOT, 'compose', f)])];
  return spawnSync('docker', ['compose', ...args, 'config', '--format', 'json'], {
    encoding: 'utf8',
  });
}

/**
 * In one merged render, the services that set GELDAR_NATS_PASSWORD_FILE, and those whose file is not the target of one of
 * their own secrets (so the container would start without its password). Service names only: no value is returned.
 */
function natsPasswordGaps(...files: string[]) {
  const run = renderCompose(...files);
  type Svc = { environment?: Record<string, string>; secrets?: { target?: string }[] };
  const services: Record<string, Svc> = JSON.parse(run.stdout || '{}').services ?? {};
  const named = Object.entries(services).filter(
    ([, s]) => s.environment?.GELDAR_NATS_PASSWORD_FILE,
  );
  // A relative secret target mounts under /run/secrets/, as compose does for the long form.
  const mountedAt = (target = '') => (target.startsWith('/') ? target : `/run/secrets/${target}`);
  const gaps = named.filter(
    ([, s]) =>
      !(s.secrets ?? []).some(
        (x) => mountedAt(x.target) === s.environment?.GELDAR_NATS_PASSWORD_FILE,
      ),
  );
  return { status: run.status, checked: named.map(([name]) => name), gaps: gaps.map(([n]) => n) };
}

describe.skipIf(!hasDocker)('compose NATS auth overlays merge offline', () => {
  it(
    'merges colo.yml with nats-auth.yml, which adds no service of its own',
    () => {
      const run = renderCompose('colo.yml', 'nats-auth.yml');
      expect(run.status).toBe(0);
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'points every NATS password file in the merged colo config at a secret its service mounts',
    () => {
      const { status, checked, gaps } = natsPasswordGaps('colo.yml', 'nats-auth.yml');
      expect(status).toBe(0);
      expect(checked).toContain('golem-body');
      expect(gaps).toEqual([]);
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'points every NATS password file in the merged phase0 config at a secret its service mounts',
    () => {
      const { status, checked, gaps } = natsPasswordGaps(
        'phase0.yml',
        'mcp.yml',
        'nats-auth.yml',
        'nats-auth-mcp.yml',
      );
      expect(status).toBe(0);
      expect(checked).toEqual(
        expect.arrayContaining(['paper', 'velocity', 'eventsink', 'geldar-mcp']),
      );
      expect(gaps).toEqual([]);
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'keeps the -js -sd /data flags colo sets on nats when the overlay is merged',
    () => {
      const run = renderCompose('colo.yml', 'nats-auth.yml');
      const command = JSON.parse(run.stdout || '{}').services?.nats?.command ?? [];
      expect(command).toEqual(expect.arrayContaining(['-js', '-sd', '/data']));
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'sets the store dir once: -sd in the merged command of both stacks, no store_dir in the generator',
    () => {
      for (const base of ['colo.yml', 'phase0.yml']) {
        const merged = renderCompose(base, 'nats-auth.yml');
        const command: string[] = JSON.parse(merged.stdout || '{}').services?.nats?.command ?? [];
        expect(command.filter((a) => a === '-sd')).toHaveLength(1);
        expect(command).toEqual(expect.arrayContaining(['-js', '-sd', '/data', '-c']));
      }
      expect(functionBody('Initialize-NatsAuth')).not.toContain('store_dir');
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'merges phase0.yml with mcp.yml, nats-auth.yml and nats-auth-mcp.yml',
    () => {
      const run = renderCompose('phase0.yml', 'mcp.yml', 'nats-auth.yml', 'nats-auth-mcp.yml');
      expect(run.status).toBe(0);
    },
    GENERATOR_TIMEOUT_MS,
  );
});

describe('geldar.ps1 NATS auth generator: static wiring', () => {
  it('defines Initialize-NatsAuth and Get-NatsUsers, and dispatches nats-auth to it', () => {
    expect(functionBody('Initialize-NatsAuth')).not.toBe('');
    expect(functionBody('Get-NatsUsers')).not.toBe('');
    expect(SCRIPT).toMatch(
      /'nats-auth' \{ Initialize-NatsAuth \$shard @\(\$ShardArgs \| Select-Object -Skip 2\) \}/,
    );
  });

  it('skips every overlay when validating compose files alone, and merges nats-auth-mcp.yml into the Phase 0 chain', () => {
    // An overlay has no image of its own, so validating it alone fails. Each skip list must name all of them.
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const psSkip = /-notin @\(([^)]*rcon-host[^)]*)\)/.exec(SCRIPT)?.[1] ?? '';
    const ciSkip = /case "\$\(basename "\$f"\)" in ([\w.|-]+)\)/.exec(ci)?.[1]?.split('|') ?? [];
    for (const overlay of OVERLAYS) {
      expect(psSkip).toContain(`'${overlay}'`);
      expect(ciSkip).toContain(overlay);
    }
    expect(SCRIPT).toMatch(/-f \(Join-Path \$Root 'compose\/nats-auth-mcp\.yml'\) config --quiet/);
    expect(
      ci
        .split('\n')
        .some((l) =>
          l.includes(
            '-f compose/phase0.yml -f compose/mcp.yml -f compose/nats-auth.yml -f compose/nats-auth-mcp.yml',
          ),
        ),
    ).toBe(true);
  });
});

/** The body role of the phase0 table, as the generator renders it: the lists before AN-28c, and the one new entry each. */
describe.skipIf(!hasPwsh)('provenance routing (AN-28c): the body role table', () => {
  const p = `geldar.${SHARD}.provenance.>`;

  it(
    'provenance routing: the body subscribes and cannot publish; mind, eventsink and mcp cannot subscribe',
    () => {
      const r = renderGenerator(SHARD);
      try {
        expect(r.status, r.stderr).toBe(0);
        const entries = parseEntries(r.conf);
        const user = (name: string) => entries.find((e) => e.user === name);
        expect(user('body')?.sub).toContain(p);
        expect(user('body')?.deny).toContain(p);
        for (const role of ['mind', 'eventsink', 'mcp']) {
          const subs = user(role)?.sub ?? [];
          expect(
            subs.some((s) => subjectMatches(s, `geldar.${SHARD}.provenance.break`)),
            role,
          ).toBe(false);
          expect(
            subs.some((s) => subjectMatches(s, `geldar.${SHARD}.provenance.pickup`)),
            role,
          ).toBe(false);
        }
      } finally {
        rmSync(r.dir, { recursive: true, force: true });
      }
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'the body keeps every earlier subject: provenance is the only addition to its lists',
    () => {
      const r = renderGenerator(SHARD);
      try {
        expect(r.status, r.stderr).toBe(0);
        const body = parseEntries(r.conf).find((e) => e.user === 'body');
        expect(body?.sub).toEqual([
          `geldar.${SHARD}.body.>`,
          `geldar.${SHARD}.blockowner.changed`,
          `geldar.${SHARD}.state.*.level`,
          p,
          '_INBOX.>',
        ]);
        expect(body?.deny).toEqual([
          `geldar.${SHARD}.kino.>`,
          `geldar.${SHARD}.blockowner.changed`,
          `geldar.${SHARD}.ctl.body.>`,
          `geldar.${SHARD}.helper.body.>`,
          `geldar.${SHARD}.state.*.level`,
          `geldar.${SHARD}.body.*.hearing`,
          p,
        ]);
        const expectedBody = expectedTable(SHARD).body;
        expect(expectedBody, 'body role in the expected table').toBeDefined();
        expect(body?.pub).toEqual(expectedBody?.pub);
      } finally {
        rmSync(r.dir, { recursive: true, force: true });
      }
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'gives the body the plan and seen bucket subjects in the generated config (BLD fix7b)',
    () => {
      const r = renderGenerator(SHARD);
      try {
        expect(r.status, r.stderr).toBe(0);
        const body = parseEntries(r.conf).find((x) => x.user === 'body');
        expect(body?.pub, 'body pub').toEqual(
          expect.arrayContaining(['$KV.geldar-plans.>', '$KV.geldar-seen.>']),
        );
        expect(expectedTable(SHARD).body?.pub).toEqual(
          expect.arrayContaining(['$KV.geldar-plans.>', '$KV.geldar-seen.>']),
        );
      } finally {
        rmSync(r.dir, { recursive: true, force: true });
      }
    },
    GENERATOR_TIMEOUT_MS,
  );

  it(
    'every other role keeps its publish and subscribe lists and holds no provenance subject',
    () => {
      const r = renderGenerator(SHARD);
      try {
        expect(r.status, r.stderr).toBe(0);
        const table = expectedTable(SHARD);
        const entries = parseEntries(r.conf);
        for (const role of ROLES.filter((x) => x !== 'body')) {
          const e = entries.find((x) => x.user === role);
          expect(e, role).toBeDefined();
          expect(e?.pub, role).toEqual(table[role]?.pub);
          expect(e?.sub, role).toEqual(table[role]?.sub);
          const all = [...(e?.pub ?? []), ...(e?.sub ?? []), ...(e?.deny ?? [])];
          expect(
            all.some((s) => s.includes('provenance')),
            role,
          ).toBe(false);
        }
      } finally {
        rmSync(r.dir, { recursive: true, force: true });
      }
    },
    GENERATOR_TIMEOUT_MS,
  );

  // A source-text check only: it fails if Get-NatsUsers reads an overlay or config file. It does not prove the
  // rendered table is the same with an overlay off; the main-versus-branch render comparison is in the worknote.
  it('Get-NatsUsers reads no overlay or config file (the table has no switch)', () => {
    expect(functionBody('Get-NatsUsers')).not.toMatch(
      /nats-auth\.yml|colo\.yml|config\.yml|provenance\.enabled/,
    );
  });
});
