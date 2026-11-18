import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Decision 0342: a per-player host restarts after a crash and after a clean exit by a node reboot. Only a stop by hand
// (player-stop, docker stop) holds it down, which is what unless-stopped does. on-failure:5 did not restart a clean exit.
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const COMPOSE_TEXT = readFileSync(resolve(DEPLOY, '..', 'compose', 'colo.yml'), 'utf8');

// The text of one top-level service (two-space key), up to the next service key.
function serviceBlock(name: string): string {
  const lines = COMPOSE_TEXT.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`service ${name} is not in compose/colo.yml`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z][\w-]*:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('per-player host restart policy (decision 0342)', () => {
  it('players-host restarts with unless-stopped, so a reboot starts it again', () => {
    const block = serviceBlock('players-host');
    expect(block).toMatch(/^ {4}restart: unless-stopped$/m);
    expect(block).not.toMatch(/on-failure/);
  });

  it('no service in compose/colo.yml still uses on-failure:5', () => {
    expect(COMPOSE_TEXT).not.toMatch(/on-failure/);
  });
});
