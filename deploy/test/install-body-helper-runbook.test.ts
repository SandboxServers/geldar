import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const CANARY = 'CANARY-SECRET-7f3a9c-do-not-print';

// The node runbook's text checks. They live in their own file to keep install-body-helper.test.ts under 500 lines.
const RUNBOOK =readFileSync(join(REPO, 'docs/runbooks/body-helper-node-steps.md'), 'utf8');
const NATS_PROCEDURE = readFileSync(join(REPO, 'docs/runbooks/nats-auth-inplace.md'), 'utf8');

describe('body-helper-node-steps.md: the node runbook (C7-03c2)', () => {
  it('names the dry run first (no flag), then --apply, and the install script', () => {
    const dry = RUNBOOK.search(/^\s+deploy\/install-body-helper\.sh$/m);
    const apply = RUNBOOK.indexOf('deploy/install-body-helper.sh --apply');
    expect(dry).toBeGreaterThan(-1);
    expect(RUNBOOK).toContain('Dry run first.');
    expect(apply).toBeGreaterThan(dry);
  });

  it('never runs shard nats-auth: every line naming it is a prohibition', () => {
    expect(RUNBOOK).toMatch(/never run `\.\/geldar\.ps1 shard nats-auth colo` on the node/i);
    const lines = RUNBOOK.split('\n').filter((line) => line.includes('shard nats-auth'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, line).toMatch(/never|nothing in this runbook/i);
  });

  it('edits nats-auth.conf in place by the procedure (no mv), then SIGHUP and never a restart', () => {
    // The step-by-step edit lives in nats-auth-inplace.md; this runbook points at it.
    expect(RUNBOOK).toContain('docs/runbooks/nats-auth-inplace.md');
    expect(NATS_PROCEDURE).toContain('docker kill -s HUP');
    expect(RUNBOOK).not.toMatch(/^\s*\d\.\s.*\bmv "\$GELDAR_SECRETS_DIR\/nats-auth\.conf/m);
    expect(RUNBOOK).toMatch(/never (a )?restart/i);
  });

  it('keeps the register user UNCHANGED and gives the status probe to the supervisor user', () => {
    expect(RUNBOOK).toContain('**`register`**: UNCHANGED');
    expect(RUNBOOK).toContain('Send it with the `supervisor` NATS user');
  });

  it('has a rollback for each change step and names the unit removal and the NATS rollback', () => {
    expect(RUNBOOK.match(/Rollback/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(RUNBOOK).toContain('systemctl disable --now geldar-body-helper.service');
    expect(RUNBOOK).toContain('rm /etc/systemd/system/geldar-body-helper.service');
    expect(RUNBOOK).toContain('systemctl daemon-reload');
    // The NATS backup restore is the procedure's step 7 rollback, not a line of this runbook.
    expect(RUNBOOK).toContain("Rollback: the procedure's step 7");
  });

  it('shows no secret-shaped value: no key assigned a value, no long token-like run, no canary', () => {
    // A key with a value after '=' or ':' with no space. Prose such as "Password: the value" is not one.
    expect(RUNBOOK).not.toMatch(/(password|token|nkey|bcrypt)\s*=\s*["']?[^<\s"']/i);
    expect(RUNBOOK).not.toMatch(/(password|token|nkey|bcrypt):["']?[^<\s"']/i);
    expect(RUNBOOK).not.toMatch(/[A-Za-z0-9+/]{40,}/);
    expect(RUNBOOK).not.toContain(CANARY);
  });
});

describe('body-helper-node-steps.md: the step 2 and step 3 text (C7-03c2 fix)', () => {
  it('step 3 says the in-place step 0 creates only nats-supervisor.txt, and maps helper.body.* to the four subjects', () => {
    expect(RUNBOOK).toContain('create ONLY `nats-supervisor.txt`');
    expect(RUNBOOK).toContain('Do NOT create `nats-helper.txt` there');
    expect(RUNBOOK).toContain('it means the four exact subjects below.');
  });

  it('says a missing pg_hba entry makes the probe refuse (28000) and ALTER ROLE run every time, not stop', () => {
    expect(RUNBOOK).toContain(
      'the probe is refused (28000) and the script runs `ALTER ROLE` on every run',
    );
    expect(RUNBOOK).not.toContain('the step stops');
  });

  it('does not claim the script creates /opt/geldar: card C7-03c5 creates it', () => {
    expect(RUNBOOK).not.toMatch(/creates `\/opt\/geldar`/);
    expect(RUNBOOK).toContain('created by card C7-03c5');
  });

  it('names the PGHOST, PGUSER and PGDATABASE preflight of --apply', () => {
    expect(RUNBOOK).toContain('`PGHOST`, `PGUSER` and `PGDATABASE` are set');
  });
});
