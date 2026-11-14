import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accountPage } from '../src/account-pages.ts';
import { onboardingPage } from '../src/onboarding-pages.ts';
import type { PlayerRow } from '../src/store.ts';

/**
 * The pinned pair: the account page's New token button, the onboarding page and the player guide must all say that
 * making a new token revokes the old one at once. Until C7-04b wires renewal, no page may promise a grace period.
 */
const REVOKE_PHRASE = 'revokes the old one immediately';
const ROOT = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), 'utf8');

describe('revocation wording agrees across the account page, onboarding and the player guide', () => {
  it('the account page New token button says the old one is revoked immediately (rendered output)', () => {
    const player: PlayerRow = {
      playerId: 'player-a',
      name: 'Alpha',
      harness: 'claude-code',
      status: 'active',
    };
    const page = accountPage([player], 'csrf-token', []);
    expect(page).toContain(`New token (${REVOKE_PHRASE})`);
    expect(page).toContain('/register/players/player-a/token');
  });

  it('the player guide says the old one is revoked immediately and promises no 10-minute grace or 14-day warning', () => {
    const guide = read('docs/players/README.md');
    expect(guide).toContain(REVOKE_PHRASE);
    expect(guide).not.toContain('10 minutes');
    expect(guide).not.toContain('14 days');
  });

  it('the onboarding page says the old one is revoked immediately', () => {
    const page = onboardingPage(
      { playerId: 'player-a', token: `gmcp-${'d'.repeat(64)}`, expiresAt: new Date(0) },
      null,
    );
    expect(page).toContain(REVOKE_PHRASE);
    expect(page).not.toMatch(/renew/i);
  });
});
