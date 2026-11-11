import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeListener, FakePool } from './pg-fakes.ts';
import {
  activeToken,
  listenerConfig,
  missReason,
  PgTokenStore,
  parseRevocation,
  type TokenRow,
} from './pg-tokens.ts';

const NOW = Date.UTC(2026, 10, 9, 12);
const DAY = 86_400_000;
const HARNESSES = { claude: true, retired_harness: false };
const HASH = Buffer.alloc(32, 7);
const REVOKE = 'mcp_token_revoked';

function row(over: Partial<TokenRow> = {}): TokenRow {
  return {
    token_id: 'tk_1',
    token_hash: HASH,
    player_id: 'ag-jason-01',
    life_id: 'ag_jason_01',
    owner_id: 'owner-a',
    display_name: 'Jason',
    harness: 'claude',
    status: 'active',
    owner_players: 1,
    owner_banned: false,
    player_cap: 3,
    expires_at: new Date(NOW + DAY),
    revoked_at: null,
    ...over,
  };
}

/** The table state a revocation NOTIFY is checked against: a token and its player. */
interface RevokeState {
  revoked_at: Date | null;
  status: string;
}
const ACTIVE: RevokeState = { revoked_at: null, status: 'active' };
const REVOKED: RevokeState = { revoked_at: new Date(NOW), status: 'active' };

/**
 * A store over a pool that answers with `rows`, and a listener the test can drive. The revocation
 * check (the table read a NOTIFY starts) answers `state`.
 */
function storeWith(rows: TokenRow[] | (() => TokenRow[]), state: RevokeState = ACTIVE) {
  const pool = new FakePool((text) => {
    if (text.includes('t.revoked_at, p.status')) return { rows: [state] };
    return { rows: typeof rows === 'function' ? rows() : rows };
  });
  const listeners: FakeListener[] = [];
  const store = new PgTokenStore(pool.asPool(), HARNESSES, {}, () => {
    const listener = new FakeListener();
    listeners.push(listener);
    return listener.asClient();
  });
  return { pool, store, listeners };
}

function revocation(payload: string): { channel: string; payload: string } {
  return { channel: REVOKE, payload };
}

/** Lets the table check a NOTIFY starts run to its end (it awaits one query). */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('missReason and explainMiss', () => {
  it('names the first check a row fails, in the order activeToken makes them', () => {
    const both = { revoked_at: new Date(NOW - 1), expires_at: new Date(NOW - 1), status: 'paused' };
    expect(missReason(row(both), NOW, HARNESSES)).toBe('token_revoked');
    const expired = { expires_at: new Date(NOW - 1), status: 'paused', harness: 'unlisted' };
    expect(missReason(row(expired), NOW, HARNESSES)).toBe('token_expired');
    expect(missReason(row({ status: 'paused' }), NOW, HARNESSES)).toBe('player_not_active');
    expect(missReason(row({ harness: 'retired_harness' }), NOW, HARNESSES)).toBe(
      'harness_disabled',
    );
  });

  it('gives a reason for every row activeToken refuses', () => {
    const refused = [
      row({ revoked_at: new Date(NOW - 1) }),
      row({ expires_at: new Date(NOW) }),
      row({ status: 'retired' }),
      row({ harness: 'unlisted' }),
    ];
    for (const refusedRow of refused) {
      expect(activeToken(refusedRow, NOW, HARNESSES)).toBeNull();
      expect(missReason(refusedRow, NOW, HARNESSES)).not.toBe('unknown_token');
    }
  });

  it('explains a stored digest that is refused, and says unknown for one not stored', async () => {
    const { store } = storeWith([row({ revoked_at: new Date(NOW - 1) })]);
    expect(await store.explainMiss(HASH, NOW)).toBe('token_revoked');
    const { store: empty } = storeWith([]);
    expect(await empty.explainMiss(HASH, NOW)).toBe('unknown_token');
  });
});

describe('activeToken', () => {
  it('accepts an active, unexpired, unrevoked token of an enabled harness', () => {
    expect(activeToken(row(), NOW, HARNESSES)).toEqual({
      tokenId: 'tk_1',
      player: {
        playerId: 'ag-jason-01',
        lifeId: 'ag_jason_01',
        ownerId: 'owner-a',
        displayName: 'Jason',
        harness: 'claude',
        status: 'active',
      },
    });
  });

  it('refuses a revoked token', () => {
    expect(activeToken(row({ revoked_at: new Date(NOW - 1) }), NOW, HARNESSES)).toBeNull();
  });

  it('refuses an expired token, and one expiring exactly now', () => {
    expect(activeToken(row({ expires_at: new Date(NOW - 1) }), NOW, HARNESSES)).toBeNull();
    expect(activeToken(row({ expires_at: new Date(NOW) }), NOW, HARNESSES)).toBeNull();
  });

  it('refuses a paused or retired player', () => {
    expect(activeToken(row({ status: 'paused' }), NOW, HARNESSES)).toBeNull();
    expect(activeToken(row({ status: 'retired' }), NOW, HARNESSES)).toBeNull();
  });

  it('refuses a player whose owner is over its cap, and names owner_over_cap', () => {
    // A cap lowered from 3 to 1 leaves two counted players: both are refused.
    const over = row({ owner_players: 2, player_cap: 1 });
    expect(activeToken(over, NOW, HARNESSES)).toBeNull();
    expect(missReason(over, NOW, HARNESSES)).toBe('owner_over_cap');
  });

  it('refuses a token whose owner identity is banned, and reports it as revoked', () => {
    const banned = row({ owner_banned: true });
    expect(activeToken(banned, NOW, HARNESSES)).toBeNull();
    expect(missReason(banned, NOW, HARNESSES)).toBe('token_revoked');
    expect(activeToken(row({ owner_banned: false }), NOW, HARNESSES)).not.toBeNull();
  });

  it('accepts a player whose owner is exactly at its cap', () => {
    expect(activeToken(row({ owner_players: 3, player_cap: 3 }), NOW, HARNESSES)).not.toBeNull();
  });

  it('refuses a disabled harness, and a harness the config does not list', () => {
    expect(activeToken(row({ harness: 'retired_harness' }), NOW, HARNESSES)).toBeNull();
    expect(activeToken(row({ harness: 'unlisted' }), NOW, HARNESSES)).toBeNull();
  });
});

describe('PgTokenStore.resolve', () => {
  it('returns the token, and asks Postgres by hash with the hash as a bound value', async () => {
    const { pool, store } = storeWith([row()]);
    const resolved = await store.resolve(HASH, NOW);
    expect(resolved?.tokenId).toBe('tk_1');
    expect(pool.sent[0]?.values).toEqual([HASH]);
  });

  it('returns null when the stored hash differs from the presented one', async () => {
    const { store } = storeWith([row({ token_hash: Buffer.alloc(32, 8) })]);
    expect(await store.resolve(HASH, NOW)).toBeNull();
  });

  it('returns null when no row matches', async () => {
    const { store } = storeWith([]);
    expect(await store.resolve(HASH, NOW)).toBeNull();
  });

  it('caches a hit for 5 s: the second call inside the window does not query', async () => {
    const { pool, store } = storeWith([row()]);
    await store.resolve(HASH, NOW);
    await store.resolve(HASH, NOW + 4_999);
    expect(pool.sent).toHaveLength(1);
    await store.resolve(HASH, NOW + 5_000);
    expect(pool.sent).toHaveLength(2);
  });

  it('never caches a miss', async () => {
    const { pool, store } = storeWith([]);
    await store.resolve(HASH, NOW);
    await store.resolve(HASH, NOW);
    expect(pool.sent).toHaveLength(2);
  });

  it('drops a cached hit when its token is revoked on LISTEN', async () => {
    const { pool, store, listeners } = storeWith([row()], REVOKED);
    await store.start();
    await store.resolve(HASH, NOW);
    listeners[0]?.emit(
      'notification',
      revocation(JSON.stringify({ token_id: 'tk_1', player_id: 'ag-jason-01' })),
    );
    await settle();
    await store.resolve(HASH, NOW + 1);
    // resolve, the table check the NOTIFY started, then the resolve that queries again
    expect(pool.sent).toHaveLength(3);
    await store.stop();
  });

  it('keeps the cache for other tokens when one is revoked', async () => {
    const { pool, store, listeners } = storeWith([row()], REVOKED);
    await store.start();
    await store.resolve(HASH, NOW);
    listeners[0]?.emit(
      'notification',
      revocation(JSON.stringify({ token_id: 'tk_other', player_id: 'ag-jason-01' })),
    );
    await settle();
    await store.resolve(HASH, NOW + 1);
    // resolve and the table check; the cached hit for tk_1 is not queried again
    expect(pool.sent).toHaveLength(2);
    await store.stop();
  });
});

describe('PgTokenStore.touch', () => {
  it('writes last_used_at at most once a minute per token', async () => {
    const { pool, store } = storeWith([]);
    await store.touch('tk_1', NOW);
    await store.touch('tk_1', NOW + 59_999);
    await store.touch('tk_1', NOW + 60_000);
    expect(pool.sent.map((sent) => sent.values[0])).toEqual(['tk_1', 'tk_1']);
    expect(pool.sent[0]?.text).toContain('SET last_used_at = $2');
  });
});

describe('PgTokenStore LISTEN connection', () => {
  it('LISTENs on the revoke channel and calls each listener with the revocation', async () => {
    const { store, listeners } = storeWith([], REVOKED);
    const seen: { tokenId: string; playerId: string }[] = [];
    store.onRevoke((revoked) => seen.push(revoked));
    await store.start();
    expect(listeners[0]?.queries).toEqual([`LISTEN ${REVOKE}`]);
    listeners[0]?.emit(
      'notification',
      revocation(JSON.stringify({ token_id: 'tk_1', player_id: 'ag-jason-01' })),
    );
    await settle();
    expect(seen).toEqual([{ tokenId: 'tk_1', playerId: 'ag-jason-01' }]);
    await store.stop();
  });

  it('a forged NOTIFY for an active token ends no session', async () => {
    const { store, listeners } = storeWith([], ACTIVE);
    const seen: { tokenId: string; playerId: string }[] = [];
    store.onRevoke((revoked) => seen.push(revoked));
    await store.start();
    listeners[0]?.emit(
      'notification',
      revocation(JSON.stringify({ token_id: 'tk_1', player_id: 'ag-jason-01' })),
    );
    await settle();
    expect(seen, 'the table says the token and its player are live').toEqual([]);
    await store.stop();
  });

  it('a NOTIFY for a player that left active ends its sessions', async () => {
    const { store, listeners } = storeWith([], { revoked_at: null, status: 'paused' });
    const seen: { tokenId: string; playerId: string }[] = [];
    store.onRevoke((revoked) => seen.push(revoked));
    await store.start();
    listeners[0]?.emit(
      'notification',
      revocation(JSON.stringify({ token_id: 'tk_1', player_id: 'ag-jason-01' })),
    );
    await settle();
    expect(seen).toEqual([{ tokenId: 'tk_1', playerId: 'ag-jason-01' }]);
    await store.stop();
  });

  it('re-opens the connection one second after it drops', async () => {
    vi.useFakeTimers();
    const { store, listeners } = storeWith([]);
    await store.start();
    listeners[0]?.emit('end');
    expect(listeners).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(listeners).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listeners).toHaveLength(2);
    expect(listeners[1]?.queries).toEqual([`LISTEN ${REVOKE}`]);
    await store.stop();
  });

  it('closes a connection that fails to connect, and rejects start', async () => {
    const listeners: FakeListener[] = [];
    const store = new PgTokenStore(new FakePool().asPool(), HARNESSES, {}, () => {
      const listener = new FakeListener();
      listener.connectError = new Error('connection refused');
      listeners.push(listener);
      return listener.asClient();
    });
    await expect(store.start()).rejects.toThrow('connection refused');
    expect(listeners[0]?.ended).toBe(true);
    await store.stop();
  });

  it('a late end from a replaced connection does not schedule a second reconnect', async () => {
    vi.useFakeTimers();
    const { store, listeners } = storeWith([]);
    await store.start();
    listeners[0]?.emit('error');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listeners).toHaveLength(2);
    listeners[0]?.emit('end');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listeners).toHaveLength(2);
    await store.stop();
  });

  it('after a reconnect, fires the revocations the gap hid and clears the hit cache', async () => {
    vi.useFakeTimers();
    let rows: TokenRow[] = [row()];
    const { pool, store, listeners } = storeWith(() => rows);
    const seen: { tokenId: string; playerId: string }[] = [];
    store.onRevoke((revoked) => seen.push(revoked));
    await store.start();
    expect(await store.resolve(HASH, NOW)).not.toBeNull();
    const before = pool.sent.length;
    listeners[0]?.emit('end');
    rows = [row({ token_id: 'tk_9', player_id: 'ag-jason-01' })];
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen, 'the revocation the gap hid').toEqual([
      { tokenId: 'tk_9', playerId: 'ag-jason-01' },
    ]);
    await store.resolve(HASH, NOW);
    expect(pool.sent.length, 'the cache was cleared: resolve queried again').toBe(before + 2);
    await store.stop();
  });

  it('a drop during catch-up keeps the earliest loss, so the next start catches up from it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const listeners: FakeListener[] = [];
    let dropOnCatchUp = false;
    const pool = new FakePool((text) => {
      if (dropOnCatchUp && text.includes('revoked_at >=')) {
        dropOnCatchUp = false;
        listeners[1]?.emit('end');
      }
      return { rows: [] };
    });
    const store = new PgTokenStore(pool.asPool(), HARNESSES, {}, () => {
      const listener = new FakeListener();
      listeners.push(listener);
      return listener.asClient();
    });
    await store.start();
    listeners[0]?.emit('end');
    dropOnCatchUp = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listeners, 'the reconnect dropped during its catch-up').toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listeners).toHaveLength(3);
    const catchUps = pool.sent.filter((sent) => sent.text.includes('revoked_at >='));
    expect(catchUps.map((sent) => sent.values[0])).toEqual([
      new Date(NOW - 60_000),
      new Date(NOW - 60_000),
    ]);
    await store.stop();
  });

  it('a drop while connecting is seen, and the connection is re-opened', async () => {
    vi.useFakeTimers();
    const { store, listeners } = storeWith([]);
    const pending = store.start();
    listeners[0]?.emit('end');
    await pending;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listeners).toHaveLength(2);
    await store.stop();
  });

  it('stop during an in-flight start ends that connection, and start rejects', async () => {
    const { store, listeners } = storeWith([]);
    const pending = store.start();
    await store.stop();
    await expect(pending).rejects.toThrow('stopped during start');
    expect(listeners).toHaveLength(1);
    expect(listeners[0]?.ended).toBe(true);
  });

  it('does not cache a hit that a revocation overtook while its row was being read', async () => {
    const listeners: FakeListener[] = [];
    let emitted = false;
    const pool = new FakePool((text) => {
      if (text.includes('t.revoked_at, p.status')) return { rows: [REVOKED] };
      if (!emitted) {
        emitted = true;
        listeners[0]?.emit(
          'notification',
          revocation(JSON.stringify({ token_id: 'tk_1', player_id: 'ag-jason-01' })),
        );
      }
      return { rows: [row()] };
    });
    const store = new PgTokenStore(pool.asPool(), HARNESSES, {}, () => {
      const listener = new FakeListener();
      listeners.push(listener);
      return listener.asClient();
    });
    await store.start();
    expect(await store.resolve(HASH, NOW)).not.toBeNull();
    await settle();
    await store.resolve(HASH, NOW);
    // resolve, the table check, then the second resolve queried: nothing was cached
    expect(pool.sent).toHaveLength(3);
    await store.stop();
  });

  it('stop ends the connection and does not reconnect', async () => {
    vi.useFakeTimers();
    const { store, listeners } = storeWith([]);
    await store.start();
    await store.stop();
    expect(listeners[0]?.ended).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listeners).toHaveLength(1);
  });
});

/** A listener whose `SELECT 1` pings fail, hang, or answer, by `mode`. */
class PingingListener extends FakeListener {
  private readonly mode: 'fail' | 'hang' | 'ok';

  constructor(mode: 'fail' | 'hang' | 'ok') {
    super();
    this.mode = mode;
  }

  override async query(text: string): Promise<{ rows: unknown[] }> {
    if (text !== 'SELECT 1' || this.mode === 'ok') return super.query(text);
    this.queries.push(text);
    if (this.mode === 'fail') throw new Error('the connection is gone');
    return new Promise(() => undefined);
  }
}

function pingingStore(mode: 'fail' | 'hang' | 'ok') {
  const listeners: PingingListener[] = [];
  const store = new PgTokenStore(new FakePool().asPool(), HARNESSES, {}, () => {
    const listener = new PingingListener(mode);
    listeners.push(listener);
    return listener.asClient();
  });
  return { store, listeners };
}

describe('PgTokenStore liveness', () => {
  it('the catch-up asks for the tokens revoked since the loss, and the live tokens of inactive players', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { pool, store, listeners } = storeWith([]);
    await store.start();
    listeners[0]?.emit('end');
    await vi.advanceTimersByTimeAsync(1_000);
    const catchUp = pool.sent.find((sent) => sent.text.includes('revoked_at >='));
    expect(catchUp?.text).toContain('WHERE t.revoked_at >= $1');
    expect(catchUp?.text).toContain(
      "OR (p.status <> 'active' AND t.revoked_at IS NULL AND t.expires_at > now())",
    );
    expect(catchUp?.values).toEqual([new Date(NOW - 60_000)]);
    await store.stop();
  });

  it('the LISTEN config keeps the Postgres options and turns TCP keepalive on', () => {
    expect(listenerConfig({ host: 'db', user: 'geldar_mcp' })).toEqual({
      host: 'db',
      user: 'geldar_mcp',
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
  });

  it('pings the connection every 30 s, and keeps it while the pings answer', async () => {
    vi.useFakeTimers();
    const { store, listeners } = storeWith([]);
    await store.start();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(listeners).toHaveLength(1);
    expect(listeners[0]?.queries).toEqual([`LISTEN ${REVOKE}`, 'SELECT 1', 'SELECT 1', 'SELECT 1']);
    await store.stop();
  });

  it('a ping that fails ends the connection, and the connection is re-opened', async () => {
    vi.useFakeTimers();
    const { store, listeners } = pingingStore('fail');
    await store.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listeners[0]?.ended).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listeners).toHaveLength(2);
    await store.stop();
  });

  it('a ping that never answers counts as lost after 5 s', async () => {
    vi.useFakeTimers();
    const { store, listeners } = pingingStore('hang');
    await store.start();
    await vi.advanceTimersByTimeAsync(34_999);
    expect(listeners[0]?.ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(listeners[0]?.ended).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listeners).toHaveLength(2);
    await store.stop();
  });

  it('a drop opens the revoke gap at the last good ping, not at the moment end fires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { pool, store, listeners } = storeWith([]);
    await store.start();
    await vi.advanceTimersByTimeAsync(30_000);
    listeners[0]?.emit('end');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listeners).toHaveLength(2);
    const catchUp = pool.sent.find((sent) => sent.text.includes('revoked_at >='));
    expect(catchUp?.values[0]).toEqual(new Date(NOW + 30_000 - 60_000));
    await store.stop();
  });
});

describe('parseRevocation', () => {
  it('reads token_id and player_id from the JSON payload', () => {
    expect(parseRevocation('{"token_id":"tk_1","player_id":"ag-jason-01"}')).toEqual({
      tokenId: 'tk_1',
      playerId: 'ag-jason-01',
    });
  });

  it('ignores a missing, malformed or incomplete payload', () => {
    expect(parseRevocation(undefined)).toBeNull();
    expect(parseRevocation('not json')).toBeNull();
    expect(parseRevocation('{"token_id":"tk_1"}')).toBeNull();
    expect(parseRevocation('{"token_id":1,"player_id":"x"}')).toBeNull();
  });
});
