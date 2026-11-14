import { describe, expect, it } from 'vitest';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { TokenStore } from '../ports.ts';
import { MissCache, verifyBearer } from './auth.ts';

// C7-04b-5, black-box refusal on the MCP side: an owner API key (gowner-) presented at the MCP
// endpoint is refused before any token lookup. The MCP HTTP front is not run here; the token lookup
// it calls (verifyBearer over the real TokenStore interface, with a fake store) is what is tested.
const PEPPER = new TextEncoder().encode('owner-key-refusal-test-pepper-0123456789');
const NOW = 1_000_000;
const OWNER_KEY = `gowner-${'a1'.repeat(32)}`;
const PLAYER_TOKEN = `gmcp-${'a1'.repeat(32)}`;

/** The fake store with a count of every resolve the lookup makes. */
function countingStore(): { store: TokenStore; asked: () => number } {
  const inner = new FakeTokenStore();
  let asked = 0;
  const store = Object.assign(Object.create(inner) as object, {
    resolve: (digest: Uint8Array, nowMs: number) => {
      asked += 1;
      return inner.resolve(digest, nowMs);
    },
  }) as TokenStore;
  return { store, asked: () => asked };
}

describe('MCP refuses an owner key at the MCP endpoint (C7-04b-5)', () => {
  it('answers 401 unauthorized for a gowner- Bearer and never asks the token store', async () => {
    const { store, asked } = countingStore();
    const verdict = await verifyBearer(
      store,
      PEPPER,
      'player-1',
      `Bearer ${OWNER_KEY}`,
      NOW,
      new MissCache(),
    );
    expect(verdict).toEqual({ outcome: 'unauthorized', reason: 'token_shape' });
    expect(asked()).toBe(0);
  });

  it('control: a well-formed gmcp- token that misses does reach the store (the counter works)', async () => {
    const { store, asked } = countingStore();
    const verdict = await verifyBearer(
      store,
      PEPPER,
      'player-1',
      `Bearer ${PLAYER_TOKEN}`,
      NOW,
      new MissCache(),
    );
    expect(verdict.outcome).toBe('unauthorized');
    expect(asked()).toBe(1);
  });
});
