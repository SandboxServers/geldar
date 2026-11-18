import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The explicit rollback of deploy/nf-deploy.sh: NF_TELEMETRY=off adds compose/nf-live-telemetry-off.yml (plan and up);
// unset adds nothing. Static checks of the script and the overlay; the stubbed behaviour runs live in nf-deploy-telemetry.test.ts.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const ROOT = resolve(DEPLOY, '..');
const SCRIPT = readFileSync(resolve(DEPLOY, 'nf-deploy.sh'), 'utf8');
const OFF = readFileSync(resolve(ROOT, 'compose', 'nf-live-telemetry-off.yml'), 'utf8');
const NF_COMPOSE = readFileSync(resolve(ROOT, 'compose', 'nf-live.yml'), 'utf8');

describe('the explicit telemetry-off overlay', () => {
  it('sets only GELDAR_NF_TELEMETRY=off on the neoforge service, and renders alone (no volumes, networks or ports)', () => {
    const body = OFF.split('\nservices:\n')[1] ?? '';
    expect(body).toMatch(/^ {2}neoforge:\n/m);
    expect(body).toMatch(/^ {6}GELDAR_NF_TELEMETRY: "off"$/m);
    expect(OFF).not.toMatch(/^(volumes|networks|ports):/m);
    expect(OFF).not.toMatch(/^ {4}(volumes|networks|ports):/m);
    const image = (text: string) => /itzg\/minecraft-server:\S+/.exec(text)?.[0];
    expect(image(OFF)).toBeDefined();
    expect(image(OFF)).toBe(image(NF_COMPOSE));
  });

  it('is added only for an explicit NF_TELEMETRY=off, with the overlay in dc() and in plan', () => {
    expect(SCRIPT).toContain('OFF_FILE=$ROOT/compose/nf-live-telemetry-off.yml');
    expect(SCRIPT).toContain('TELEMETRY_OFF=0');
    // Unset (NF_TELEMETRY+x empty) adds nothing: the off branch sets TELEMETRY_OFF only when the variable is set.
    expect(SCRIPT).toMatch(
      /off\) TELEMETRY=0; \[ -z "\$\{NF_TELEMETRY\+x\}" \] \|\| TELEMETRY_OFF=1 ;;/,
    );
    // dc() prepends the off file with set --, after the telemetry branch; the -f order is fixed by dc() itself.
    expect(SCRIPT).toContain('elif [ "$TELEMETRY_OFF" = 1 ]; then\n    set -- -f "$OFF_FILE" "$@"');
    expect(SCRIPT).toContain('docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"\n}');
    expect(SCRIPT).toContain(
      'if [ "$TELEMETRY_OFF" = 1 ]; then\n    say "telemetry off (explicit NF_TELEMETRY=off)',
    );
  });

  it('the rollback never adds the telemetry overlay or the ledger', () => {
    expect(SCRIPT).not.toMatch(/OFF_FILE[^\n]*TELEMETRY_FILE|TELEMETRY_FILE[^\n]*OFF_FILE/);
    expect(OFF).not.toContain('nf-live-telemetry.yml');
    expect(OFF).not.toContain('geldar-telemetry');
  });
});
