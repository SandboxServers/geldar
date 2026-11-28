import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// COLO-COMPOSE-RECONCILE (card S2). The node's Ledger and OTel agents are an opt-in overlay (D2), so compose/colo.yml
// renders without them. The other live settings the node has are checked in the source file.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COLO = 'compose/colo.yml';
const NATS = 'compose/nats-auth.yml';
const AGENTS = 'compose/opt-in/colo-paper-agents.yml';
const KINO = 'compose/colo-kino.yml';
const TIMEOUT_MS = 60_000;
/** Variables this check sets or clears; a developer's shell must not change the render. */
const CLEARED_VARS = [
  'GELDAR_COLO_EXTRA_OVERLAY',
  'GELDAR_STATE_DIR',
  'GELDAR_PROJECT',
  'GELDAR_NETWORK',
];
/** The four mount targets of the node's paper: the Ledger jar, the OTel agent jar and both agent properties. */
const AGENT_TARGETS = [
  '/plugins/ledger.jar',
  '/opt/otel/opentelemetry-javaagent.jar',
  '/opt/otel/otel-agent.properties',
  '/data/plugins/Ledger/ledger.properties',
];

interface Mount {
  source?: string;
  target?: string;
  read_only?: boolean;
  bind?: { create_host_path?: boolean };
}
interface Paper {
  environment?: Record<string, string>;
  volumes?: Mount[];
}
interface Rendered {
  services?: Record<string, Paper>;
}
interface SourceService {
  restart?: string;
  profiles?: string[];
  environment?: Record<string, string>;
}
interface Source {
  services?: Record<string, SourceService>;
}

const dockerOk = (() => {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const shOk = (() => {
  try {
    execFileSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** The merged config `shard up colo` renders, with the given overlay files after the base files. */
function render(overlays: string[] = []): Rendered {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CLEARED_VARS) delete env[name];
  const files = [COLO, NATS, ...overlays].flatMap((file) => ['-f', file]);
  const text = execFileSync('docker', ['compose', ...files, 'config', '--no-path-resolution'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parse(text) as Rendered;
}

function paperOf(doc: Rendered): Paper {
  return doc.services?.paper ?? {};
}

function agentMounts(doc: Rendered): Mount[] {
  return (paperOf(doc).volumes ?? []).filter((mount) => AGENT_TARGETS.includes(mount.target ?? ''));
}

/**
 * The overlay deploy/common.sh selects for a GELDAR_COLO_EXTRA_OVERLAY value (unset when undefined).
 * common.sh finds its own directory from $0 (DEPLOY_DIR), so $0 must be the path to the file: the shell's
 * name ("sh") would make DEPLOY_DIR the shell's directory and the source of space-floor.sh would fail.
 */
function selectedOverlay(value: string | undefined): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GELDAR_COLO_EXTRA_OVERLAY;
  if (value !== undefined) env.GELDAR_COLO_EXTRA_OVERLAY = value;
  return execFileSync('sh', ['-c', '. "$0"; printf %s "$EXTRA_OVERLAY"', 'deploy/common.sh'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The argument list deploy/common.sh's dc hands to docker for `dc config`, with GELDAR_COLO_EXTRA_OVERLAY set to
 * value (unset when undefined). A fake docker on PATH prints each argument on its own line, so no daemon is needed.
 */
function composeArgv(value: string | undefined): string[] {
  const bin = mkdtempSync(join(tmpdir(), 'fake-docker-'));
  try {
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n', { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of CLEARED_VARS) delete env[name];
    delete env.GELDAR_MC_BIND;
    delete env.GELDAR_MC_PORT;
    delete env.HOLD_PUBLIC;
    if (value !== undefined) env.GELDAR_COLO_EXTRA_OVERLAY = value;
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`;
    const out = execFileSync('sh', ['-c', '. "$0"; dc config', 'deploy/common.sh'], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').filter((line) => line !== '');
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

/** The file named after each -f, in argument order. */
function filesOf(argv: string[]): string[] {
  return argv.flatMap((arg, i) => (arg === '-f' ? [argv[i + 1] ?? ''] : []));
}

describe.skipIf(!dockerOk)('colo paper agents (docker compose config)', () => {
  it(
    'without the overlay, the rendered paper has no Ledger or OTel agent',
    () => {
      const paper = paperOf(render());
      expect(paper.environment?.JAVA_AGENTS).toBeUndefined();
      expect(paper.environment?.OTEL_JAVAAGENT_CONFIGURATION_FILE).toBeUndefined();
      expect(paper.environment?.OTEL_SDK_DISABLED).toBeUndefined();
      expect(agentMounts(render())).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'with the overlay, the rendered paper has the agent env and all four read-only mounts',
    () => {
      const doc = render([AGENTS]);
      const paper = paperOf(doc);
      expect(paper.environment?.JAVA_AGENTS).toBe('/opt/otel/opentelemetry-javaagent.jar');
      expect(paper.environment?.OTEL_JAVAAGENT_CONFIGURATION_FILE).toBe(
        '/opt/otel/otel-agent.properties',
      );
      expect(paper.environment?.OTEL_SDK_DISABLED).toBe('false');
      expect(
        agentMounts(doc)
          .map((mount) => mount.target)
          .sort(),
      ).toEqual([...AGENT_TARGETS].sort());
      for (const mount of agentMounts(doc)) expect(mount.read_only).toBe(true);
    },
    TIMEOUT_MS,
  );
});

describe.skipIf(!shOk)('colo overlay selection (deploy/common.sh)', () => {
  it('an empty GELDAR_COLO_EXTRA_OVERLAY selects no overlay, as unset does', () => {
    expect(selectedOverlay('')).toBe('');
    expect(selectedOverlay(undefined)).toBe('');
  });

  it('a set GELDAR_COLO_EXTRA_OVERLAY selects that file', () => {
    expect(selectedOverlay(AGENTS)).toBe(AGENTS);
  });
});

describe.skipIf(!shOk)('colo overlay files passed to docker compose (dc in deploy/common.sh)', () => {
  it('one selected file adds one -f before the subcommand', () => {
    const argv = composeArgv(AGENTS);
    expect(filesOf(argv)).toHaveLength(4);
    expect(filesOf(argv).slice(-1)).toEqual([AGENTS]);
    expect(argv[argv.length - 1]).toBe('config');
  });

  it('colo-kino.yml and the paper agents overlay each get one -f, in the order given', () => {
    const argv = composeArgv(`${KINO}:${AGENTS}`);
    expect(filesOf(argv)).toHaveLength(5);
    expect(filesOf(argv).slice(-2)).toEqual([KINO, AGENTS]);
    expect(argv[argv.length - 1]).toBe('config');
  });

  it('a blank selection adds no overlay, as unset does', () => {
    for (const value of ['', undefined]) {
      const files = filesOf(composeArgv(value));
      expect(files).toHaveLength(3);
      expect(files[files.length - 1]).toMatch(/compose\.secrets\.yml$/);
    }
  });

  it('empty entries between colons add no -f', () => {
    expect(filesOf(composeArgv(`:${AGENTS}:`))).toEqual([
      expect.stringMatching(/\bcolo\.yml$/),
      expect.stringMatching(/nats-auth\.yml$/),
      expect.stringMatching(/compose\.secrets\.yml$/),
      AGENTS,
    ]);
  });
});

describe('the live settings in compose/colo.yml', () => {
  const source = parse(readFileSync(resolve(ROOT, COLO), 'utf8')) as Source;
  const services = source.services ?? {};

  it('players-host restarts unless-stopped (decision 0342)', () => {
    expect(services['players-host']?.restart).toBe('unless-stopped');
  });

  it('golem-body keeps its adam profile and unless-stopped restart (decisions 0212, D3)', () => {
    expect(services['golem-body']?.profiles).toEqual(['adam']);
    expect(services['golem-body']?.restart).toBe('unless-stopped');
  });

  it('paper starts with the players_sleeping_percentage gamerule', () => {
    expect(services.paper?.environment?.RCON_CMDS_STARTUP).toContain(
      'gamerule players_sleeping_percentage 50',
    );
  });

  it('no service is named animus (decision 0430)', () => {
    expect(Object.keys(services)).not.toContain('animus');
  });
});

describe('the opt-in agent overlay file', () => {
  it('each agent mount refuses to create a missing host source and is read-only', () => {
    // compose config drops a false bind option (it renders `bind: {}`), so the overlay file itself is read.
    const overlay = parse(readFileSync(resolve(ROOT, AGENTS), 'utf8')) as Rendered;
    const mounts = (overlay.services?.paper?.volumes ?? []).filter((mount) =>
      AGENT_TARGETS.includes(mount.target ?? ''),
    );
    expect(mounts).toHaveLength(4);
    for (const mount of mounts) {
      expect(mount.bind?.create_host_path).toBe(false);
      expect(mount.read_only).toBe(true);
    }
  });

  it('the paper env sets the three agent values (read from the YAML, no docker)', () => {
    const overlay = parse(readFileSync(resolve(ROOT, AGENTS), 'utf8')) as Rendered;
    const env = paperOf(overlay).environment;
    expect(env?.JAVA_AGENTS).toBe('/opt/otel/opentelemetry-javaagent.jar');
    expect(env?.OTEL_JAVAAGENT_CONFIGURATION_FILE).toBe('/opt/otel/otel-agent.properties');
    expect(env?.OTEL_SDK_DISABLED).toBe('false');
  });

  it('each agent mount reads a source that the node provides (the sources confirmed on the node, 2026-11-28)', () => {
    const overlay = parse(readFileSync(resolve(ROOT, AGENTS), 'utf8')) as Rendered;
    const sources = Object.fromEntries(
      (overlay.services?.paper?.volumes ?? []).map((mount) => [mount.target, mount.source]),
    );
    expect(sources).toEqual({
      '/plugins/ledger.jar': '../plugin/ledger/build/libs/ledger.jar',
      '/opt/otel/opentelemetry-javaagent.jar':
        // biome-ignore lint/suspicious/noTemplateCurlyInString: compose source text, not a JS template
        '${GELDAR_STATE_DIR:-/var/lib/geldar-colo}/otel/opentelemetry-javaagent.jar',
      '/opt/otel/otel-agent.properties': './paper/otel-agent.properties',
      '/data/plugins/Ledger/ledger.properties':
        // biome-ignore lint/suspicious/noTemplateCurlyInString: compose source text, not a JS template
        '${GELDAR_STATE_DIR:-/var/lib/geldar-colo}/ledger/ledger.properties',
    });
  });
});
