// C7-03c5: bundles body-helper/src/main.ts into one file, dist/main.js, and writes dist/main.js.sha256
// beside it (sha256sum format). The CI job and deploy/install-body-helper.sh both check that digest.
// Usage: node scripts/bundle.mjs [outdir]   (default outdir: dist, under this package).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function bundle(outdir = join(PACKAGE, 'dist')) {
  mkdirSync(outdir, { recursive: true });
  const outfile = join(outdir, 'main.js');
  await build({
    entryPoints: [join(PACKAGE, 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'warning',
    // The bundle is ESM; a CJS dependency calls require(), which ESM does not provide. This banner supplies it.
    banner: {
      js: "import { createRequire as __geldarRequire } from 'node:module'; const require = __geldarRequire(import.meta.url);",
    },
  });
  const digest = createHash('sha256').update(readFileSync(outfile)).digest('hex');
  writeFileSync(join(outdir, 'main.js.sha256'), `${digest}  main.js\n`);
  return digest;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const outdir = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
  const digest = await bundle(outdir);
  process.stdout.write(`bundled main.js sha256 ${digest}\n`);
}
