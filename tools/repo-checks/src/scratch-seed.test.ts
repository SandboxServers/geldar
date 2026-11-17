/**
 * The scratch identity seed (compose/opt-in/scratch.yml service `identity-seed`): one run creates the two buckets the
 * Velocity plugin only reads, before velocity starts. Text checks of the overlay and of deploy/scratch/scratch.sh; the
 * seed script itself is tested in golem/src/seed-buckets.test.ts. Nothing here starts a container.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SCRATCH_YML = readFileSync(
  new URL('../../../compose/opt-in/scratch.yml', import.meta.url),
  'utf8',
);
const SCRATCH_SH = readFileSync(
  new URL('../../../deploy/scratch/scratch.sh', import.meta.url),
  'utf8',
);

/** The text of one service block of an overlay file, from its key to the next service or top-level key. */
function serviceBlock(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) return '';
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) || /^ {2}\S/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

describe('scratch identity seed', () => {
  const seed = serviceBlock(SCRATCH_YML, 'identity-seed');
  const velocity = serviceBlock(SCRATCH_YML, 'velocity');

  it('defines the seed service in the scratch overlay', () => {
    expect(seed).not.toBe('');
  });

  it('runs the golem seed script in the admin image, once, labelled as scratch', () => {
    expect(seed).toContain('image: ${GELDAR_ADMIN_IMAGE:-geldar-admin:c1}');
    expect(seed).toContain('golem/src/seed-buckets.ts');
    expect(seed).toContain('restart: "no"');
    expect(seed).toContain('geldar.scratch: "true"');
  });

  it('connects as the scratch-only seed NATS user, with its own password file', () => {
    expect(seed).toContain('GELDAR_NATS_URL: nats://nats:4222');
    expect(seed).toContain('GELDAR_NATS_USER: seed');
    expect(seed).toContain('GELDAR_NATS_PASSWORD_FILE: /run/secrets/nats-seed.txt');
    expect(seed).toContain('secrets: [nats-seed.txt]');
    expect(seed).not.toMatch(/nats-(body|mind|mcp)/);
  });

  it('waits for nats to be healthy before it runs', () => {
    expect(seed).toMatch(/depends_on:\s*\n\s*nats:\s*\n\s*condition: service_healthy/);
  });

  it('runs as the account uid:gid, so the 0600 seed password file is readable', () => {
    expect(seed).toContain(
      'user: "${SCRATCH_RUN_UID:?set by deploy/scratch/scratch.sh}:${SCRATCH_RUN_GID:?set by deploy/scratch/scratch.sh}"',
    );
  });

  it('makes velocity wait until the seed has completed successfully', () => {
    expect(velocity).toMatch(
      /depends_on:\s*\n\s*identity-seed:\s*\n\s*condition: service_completed_successfully/,
    );
  });

  it('declares nats-seed.txt as a top-level secret read from the NATS auth dir', () => {
    expect(SCRATCH_YML).toMatch(
      /\n {2}nats-seed\.txt:\n {4}file: \$\{SCRATCH_NATS_AUTH_DIR:-\$\{SCRATCH_SECRETS_DIR:\?set by deploy\/scratch\/scratch\.sh\}\}\/nats-seed\.txt/,
    );
  });

  it('scratch.sh requires the seed file with the other four NATS files', () => {
    expect(SCRATCH_SH).toMatch(
      /NATS_FILES="nats-auth\.conf nats-paper\.txt nats-velocity\.txt nats-eventsink\.txt nats-seed\.txt"/,
    );
  });
});
