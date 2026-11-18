import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the deploy test fixtures (deploy/test/*.test.ts) and the gates() wiring in deploy/nf-deploy.sh. The deploy suites run the
// real script against a copied tree, so every fixture must copy every file the script sources.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DEPLOY_TEST = join(ROOT, 'deploy', 'test');
const HUMAN_LIB = "'nf-human-lib.sh')";
const EXTRA_LIB = "'nf-extra-mods-lib.sh')";

describe('deploy test fixtures copy the extra-mods lib wherever they copy the human lib', () => {
  const suites = readdirSync(DEPLOY_TEST).filter(
    (f) => f.startsWith('nf-deploy') && f.endsWith('.test.ts'),
  );

  it('finds the deploy suites', () => {
    expect(suites.length).toBeGreaterThan(0);
  });

  it('a fixture that copies nf-human-lib.sh also copies nf-extra-mods-lib.sh (no suite is missing it)', () => {
    const missing = suites.filter((f) => {
      const text = readFileSync(join(DEPLOY_TEST, f), 'utf8');
      return text.includes(HUMAN_LIB) && !text.includes(EXTRA_LIB);
    });
    expect(missing).toEqual([]);
  });
});

describe('nf-deploy.sh gates() calls the extra-mods check', () => {
  const script = readFileSync(join(ROOT, 'deploy', 'nf-deploy.sh'), 'utf8');

  it('the body of gates() calls check_extra_mods as its own line (not only check_extra_mods_drop)', () => {
    const body = /^gates\(\) \{\n([\s\S]*?)^\}/m.exec(script);
    expect(body, 'gates() is defined in deploy/nf-deploy.sh').not.toBeNull();
    expect(body?.[1]).toMatch(/^\s*check_extra_mods\s*$/m);
  });
});
