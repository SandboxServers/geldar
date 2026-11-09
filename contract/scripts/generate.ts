/**
 * CLI for the contract generator. `node scripts/generate.ts` rewrites src/generated/;
 * `--check` writes nothing and exits 1 when any generated file differs from the schemas.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findStale, generate } from './generator.ts';

const contractDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv.includes('--check')) {
  const stale = await findStale();
  if (stale.length > 0) {
    for (const path of stale) console.error(`out of date: ${path}`);
    console.error(
      'Run `./geldar.ps1 pnpm --filter @geldar/contract generate` and commit the result.',
    );
    process.exit(1);
  }
  console.log('contract/src/generated is up to date.');
} else {
  for (const [path, text] of await generate()) {
    const target = join(contractDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
    console.log(`wrote ${path}`);
  }
}
