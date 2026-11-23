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

// The probes are lazy: importing this module spawns nothing. Each getter runs its command on the first call and reuses
// the result, so a test file that never asks for a probe never starts docker or pwsh.
let dockerComposeCache: ToolProbe | undefined;
let pwshCache: ToolProbe | undefined;

/** Whether `docker compose version` works. Runs once, on the first call. */
export function dockerComposeProbe(): ToolProbe {
  dockerComposeCache ??= probeTool('docker compose', 'docker', ['compose', 'version']);
  return dockerComposeCache;
}

/** Whether the pwsh command runs. Runs once, on the first call, with the command from GELDAR_TEST_PWSH or pwsh. */
export function pwshProbe(): ToolProbe {
  pwshCache ??= probeTool('PowerShell', pwshCommand(), ['-NoProfile', '-Command', 'exit 0']);
  return pwshCache;
}

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
