/**
 * Validates every `envs/*.yaml` against `envs/environment.schema.json`. Run it from
 * anywhere: `node tools/genesis-env/src/cli.ts`. Exit 0 when every file validates, 1 when
 * one fails or no environment file exists. The same rules run as a repo check.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvironment } from './validate.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const envDir = join(root, 'envs');
const schema: object = JSON.parse(
  readFileSync(join(envDir, 'environment.schema.json'), 'utf8'),
) as object;

const names = readdirSync(envDir)
  .filter((name) => name.endsWith('.yaml'))
  .sort();
let failed = names.length === 0;
if (failed) console.log('error: no envs/*.yaml file to validate');

for (const name of names) {
  const problems = validateEnvironment(
    readFileSync(join(envDir, name), 'utf8'),
    `envs/${name}`,
    schema,
  );
  for (const problem of problems) console.log(`error: ${problem}`);
  if (problems.length > 0) failed = true;
}

console.log(failed ? 'genesis env: failed' : `genesis env: ok (${names.length} file(s))`);
process.exitCode = failed ? 1 : 0;
