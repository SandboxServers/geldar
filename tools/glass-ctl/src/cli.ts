/**
 * `node tools/glass-ctl/src/cli.ts <up|down|status|logs>`, run by `./geldar.ps1 glass`. The exit code is the command's.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_FS } from './fs-ops.ts';
import { type FetchStatus, glassPaths, runGlass } from './glass-ctl.ts';
import { PRODUCTION_OPS } from './process-ops.ts';

const PROBE_TIMEOUT_MS = 2000;

/** GET on the URL the caller built from 127.0.0.1 and the port; the body is dropped and only the status kept. */
const fetchStatus: FetchStatus = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  await response.body?.cancel();
  return response.status;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outcome = await runGlass(process.argv[2], {
  repoRoot,
  paths: glassPaths(repoRoot),
  env: process.env,
  fs: PRODUCTION_FS,
  ops: PRODUCTION_OPS,
  fetchStatus,
  nodePath: process.execPath,
});
for (const line of outcome.lines) {
  if (outcome.exitCode === 0) console.log(line);
  else console.error(line);
}
process.exitCode = outcome.exitCode;
