import { spawnSync } from 'node:child_process';

/** The outcome of one `docker` call. */
export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run `docker <args>` with a timeout and return what it printed. A timeout or a missing
 * binary shows up as a null status, never as a thrown error.
 */
export function run(args: string[], options: { timeoutMs: number }): RunResult {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? String(result.error) : ''),
  };
}

/**
 * True when a Docker daemon with Linux containers answers. Without one the image suite
 * skips with a warning; under CI=true a missing Docker is a failure instead.
 */
export function dockerReady(): boolean {
  const result = run(['info', '--format', '{{.OSType}}'], { timeoutMs: 30_000 });
  const ready = result.status === 0 && result.stdout.trim() === 'linux';
  if (!ready && process.env.CI === 'true') {
    throw new Error('Docker with Linux containers is required in CI');
  }
  if (!ready) {
    process.stderr.write('image tests skipped: no Docker with Linux containers\n');
  }
  return ready;
}
