// C2-07f: on the node every NATS secret must resolve under GELDAR_SECRETS_DIR. compose/nats-auth.yml names its
// secrets as ./secrets/... (for local use) and the LATER compose file wins, so deploy/compose.secrets.yml must be
// merged after it, in every script that calls compose. These are static checks of the scripts and compose files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const read = (...p: string[]) => readFileSync(join(DEPLOY, ...p), 'utf8');
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('NATS overlay secret paths (C2-07f)', () => {
  it('the secrets overlay is merged after the NATS overlay, in every compose call', () => {
    const lines = ['common.sh', 'colo-admin.sh']
      .flatMap((f) => read(f).split('\n'))
      .filter((l) => l.includes('docker compose -p') && l.includes('$SECRETS_OVERLAY'));
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const l of lines) {
      expect(l, l).toContain('$NATS_OVERLAY');
      expect(l.indexOf('$NATS_OVERLAY'), l).toBeLessThan(l.indexOf('$SECRETS_OVERLAY'));
    }
  });

  it('every secret the NATS overlay declares is redeclared under GELDAR_SECRETS_DIR', () => {
    const nats = read('..', 'compose', 'nats-auth.yml');
    const node = read('compose.secrets.yml');
    const names = [...nats.matchAll(/^ {2}(nats-[\w.-]+):\n {4}file:/gm)].map((m) => m[1] ?? '');
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      const e = reEscape(n);
      expect(node, n).toMatch(
        new RegExp(`^ {2}${e}:\\n {4}file: \\$\\{GELDAR_SECRETS_DIR\\}/${e}$`, 'm'),
      );
    }
  });
});
