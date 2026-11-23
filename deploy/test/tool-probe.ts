/**
 * Availability probes for the deploy tests that spawn docker compose or pwsh (#898). A missing tool skips its tests with a
 * message that names it. With CI set a missing tool throws instead, so a CI runner without the tool fails rather than
 * passes by skipping. Probing runs `<tool> --version`-style commands only; nothing here starts a container.
 */
import { spawnSync } from 'node:child_process';

export interface ToolProbe {
  readonly name: string;
  readonly ok: boolean;
  readonly reason: string;
}

/** Runs `command args` once; a missing binary or a non-zero exit is a failed probe, never an error thrown here. */
export function probeTool(name: string, command: string, args: readonly string[]): ToolProbe {
  const run = spawnSync(command, [...args], { encoding: 'utf8', stdio: 'ignore', timeout: 60_000 });
  const ok = run.status === 0;
  return {
    name,
    ok,
    reason: ok ? '' : `${name} is not usable: \`${[command, ...args].join(' ')}\` did not exit 0`,
  };
}

/** The pwsh command the deploy tests run. GELDAR_TEST_PWSH overrides it, as genesis-test-vm.test.ts has always read it. */
export function pwshCommand(): string {
  return process.env.GELDAR_TEST_PWSH ?? 'pwsh';
}

export const DOCKER_COMPOSE_PROBE = probeTool('docker compose', 'docker', ['compose', 'version']);
export const PWSH_PROBE = probeTool('PowerShell', pwshCommand(), [
  '-NoProfile',
  '-Command',
  'exit 0',
]);

/**
 * True when the probed tool is present, so `describe.skipIf(!toolAvailable(PROBE))` runs the tests. When it is missing
 * this returns false and says why on stderr; when CI is set it throws, which fails the file at collection.
 */
export function toolAvailable(probe: ToolProbe): boolean {
  if (probe.ok) return true;
  if (process.env.CI)
    throw new Error(`${probe.reason}, and CI is set: these tests must run, not skip`);
  process.stderr.write(`skipping tests that need ${probe.name}: ${probe.reason}\n`);
  return false;
}
