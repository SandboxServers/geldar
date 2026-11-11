import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashToken, TOKEN_PATTERN } from '../../../threshold/mcp/src/store/token-hash.ts';
import type { Row, Sql } from './owners.ts';
import { initSecretFiles, REPO_ROOT } from './secret-files.ts';
import {
  checkOutPath,
  DEFAULT_GRACE_MINUTES,
  listTokens,
  MAX_ACTIVE_TOKENS,
  mintTokenFile,
  parseGrace,
  revokePlayerTokens,
  revokeToken,
  rotateTokenFile,
} from './tokens.ts';

const DAY_MS = 86_400_000;

/** Stores the token rows in memory and answers only the statements tokens.ts sends. */
class TokenSql implements Sql {
  players = new Map<string, string>([['ag-jo-01', 'active']]);
  tokens: Array<{
    token_id: string;
    player_id: string;
    token_hash: Buffer;
    expires: number;
    revoked: boolean;
  }> = [];
  /** Every statement and its values, for the canary scan. */
  log: string[] = [];
  /** The token rows at BEGIN, put back on ROLLBACK. */
  snapshot: TokenSql['tokens'] | undefined;

  async query(text: string, values: unknown[] = []): Promise<{ rows: Row[] }> {
    this.log.push(`${text} ${values.map(String).join(' ')}`);
    if (text === 'BEGIN') this.snapshot = this.tokens.map((t) => ({ ...t }));
    if (text === 'ROLLBACK' && this.snapshot !== undefined) this.tokens = this.snapshot;
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
    if (text.startsWith('SELECT status FROM mcp_players')) {
      const status = this.players.get(String(values[0]));
      return { rows: status === undefined ? [] : [{ status }] };
    }
    if (text.includes('count(*)')) {
      const n = this.tokens.filter(
        (t) => t.player_id === values[0] && !t.revoked && t.expires > Date.now(),
      ).length;
      return { rows: [{ n }] };
    }
    if (text.startsWith('INSERT INTO mcp_tokens')) {
      this.tokens.push({
        token_id: String(values[0]),
        player_id: String(values[1]),
        token_hash: values[2] as Buffer,
        expires: Date.now() + 30 * DAY_MS,
        revoked: false,
      });
      return { rows: [] };
    }
    if (text.startsWith('UPDATE mcp_tokens SET expires_at')) {
      for (const t of this.tokens) {
        if (t.player_id === values[0] && t.token_id !== values[2] && !t.revoked) {
          t.expires = Math.min(t.expires, Date.now() + Number(values[1]) * 60_000);
        }
      }
      return { rows: [] };
    }
    if (text.startsWith('UPDATE mcp_tokens SET revoked_at = now() WHERE token_id')) {
      const hit = this.tokens.find((t) => t.token_id === values[0] && !t.revoked);
      if (hit === undefined) return { rows: [] };
      hit.revoked = true;
      return { rows: [{ token_id: hit.token_id }] };
    }
    if (text.startsWith('UPDATE mcp_tokens SET revoked_at = now() WHERE player_id')) {
      const hits = this.tokens.filter(
        (t) => t.player_id === values[0] && t.token_id !== values[1] && !t.revoked,
      );
      for (const t of hits) t.revoked = true;
      return { rows: hits.map((t) => ({ token_id: t.token_id })) };
    }
    if (text.startsWith('SELECT token_id, player_id')) {
      const rows = this.tokens
        .filter((t) => values.length === 0 || t.player_id === values[0])
        .map((t) => ({
          token_id: t.token_id,
          player_id: t.player_id,
          expires_at: new Date(t.expires).toISOString(),
          status: t.revoked ? 'revoked' : t.expires <= Date.now() ? 'expired' : 'active',
        }));
      return { rows };
    }
    throw new Error(`unexpected SQL in the test fake: ${text}`);
  }
}

describe('tokens', () => {
  let secrets = '';
  let outDir = '';

  beforeEach(async () => {
    secrets = await mkdtemp(join(tmpdir(), 'mcp-tokens-secrets-'));
    outDir = await mkdtemp(join(tmpdir(), 'mcp-tokens-out-'));
    await initSecretFiles(secrets, { force: false });
  });

  afterEach(async () => {
    await rm(secrets, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  /** A session with one active player (the owner and agents rows are the players tests' business). */
  function withPlayer(): TokenSql {
    return new TokenSql();
  }

  /** Reads the token value out of a file written by mint or rotate. */
  async function tokenIn(file: string): Promise<string> {
    const match = (await readFile(file, 'utf8')).match(/^GELDAR_MCP_TOKEN=(gmcp-[0-9a-f]{64})$/m);
    if (match?.[1] === undefined) throw new Error('the file has no token line');
    expect(match[1]).toMatch(TOKEN_PATTERN);
    return match[1];
  }

  it('stores only the HMAC of a minted token, never the token', async () => {
    const sql = await withPlayer();
    const out = join(outDir, 'jo.env');
    const tokenId = await mintTokenFile(sql, secrets, 'ag-jo-01', out);
    const token = await tokenIn(out);
    const pepper = (await readFile(join(secrets, 'mcp-token-pepper.txt'), 'utf8')).trim();

    expect(tokenId).toMatch(/^tk_[0-9a-f]{16}$/);
    expect(sql.tokens).toHaveLength(1);
    expect(sql.tokens[0]?.token_hash.equals(hashToken(pepper, token))).toBe(true);
    expect(sql.log.join('\n')).not.toContain(token);
  });

  it('keeps the token out of every returned line and every statement', async () => {
    const sql = await withPlayer();
    const out = join(outDir, 'jo.env');
    const tokenId = await mintTokenFile(sql, secrets, 'ag-jo-01', out);
    const token = await tokenIn(out);
    const lines = await listTokens(sql);
    const everything = [tokenId, ...lines, ...sql.log].join('\n');
    expect(everything).not.toContain(token);
    expect(everything).not.toMatch(/gmcp-[0-9a-f]{8}/);
  });

  it('refuses an --out path inside the repo before touching the database', async () => {
    const sql = await withPlayer();
    const inside = join(REPO_ROOT, 'compose', 'secrets', 'leak.env');
    expect(() => checkOutPath(inside)).toThrow('outside the repo');
    const before = sql.log.length;
    await expect(mintTokenFile(sql, secrets, 'ag-jo-01', inside)).rejects.toThrow(
      'outside the repo',
    );
    expect(sql.log.length).toBe(before);
    expect(sql.tokens).toHaveLength(0);
  });

  it('never overwrites an existing --out file', async () => {
    const sql = await withPlayer();
    const out = join(outDir, 'taken.env');
    await writeFile(out, 'keep me\n');
    await expect(mintTokenFile(sql, secrets, 'ag-jo-01', out)).rejects.toThrow();
    expect(await readFile(out, 'utf8')).toBe('keep me\n');
    expect(sql.tokens).toHaveLength(0);
  });

  it.skipIf(process.platform === 'win32')('writes the token file owner-only (0600)', async () => {
    const sql = await withPlayer();
    const out = join(outDir, 'mode.env');
    await mintTokenFile(sql, secrets, 'ag-jo-01', out);
    expect((await stat(out)).mode & 0o777).toBe(0o600);
  });

  it('allows two active tokens per player and refuses the third until one is revoked', async () => {
    const sql = await withPlayer();
    expect(MAX_ACTIVE_TOKENS).toBe(2);
    const first = await mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'a.env'));
    await mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'b.env'));
    await expect(mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'c.env'))).rejects.toThrow(
      'revoke one first',
    );
    await revokeToken(sql, first);
    await expect(mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'c.env'))).resolves.toMatch(
      /^tk_/,
    );
  });

  it('refuses a retired player and an unknown player', async () => {
    const sql = await withPlayer();
    sql.players.set('ag-jo-01', 'retired');
    await expect(mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'r.env'))).rejects.toThrow(
      'retired',
    );
    await expect(
      mintTokenFile(sql, secrets, 'ag-nobody-01', join(outDir, 'n.env')),
    ).rejects.toThrow('no player');
  });

  // Decision 0077 (option A): an invitee is a player the owner added, so it counts in the owner's
  // cap at `player add` (players.test.ts, 'refuses the 21st'); its token comes from this same mint.
  it("mints an invitee's token once: written to its file once, only the HMAC stored", async () => {
    const sql = await withPlayer();
    sql.players.set('ag-inv-01', 'active');
    const out = join(outDir, 'inv.env');
    const tokenId = await mintTokenFile(sql, secrets, 'ag-inv-01', out);
    const token = await tokenIn(out);
    const pepper = (await readFile(join(secrets, 'mcp-token-pepper.txt'), 'utf8')).trim();
    expect(sql.tokens).toHaveLength(1);
    expect(sql.tokens[0]?.player_id).toBe('ag-inv-01');
    expect(sql.tokens[0]?.token_hash.equals(hashToken(pepper, token))).toBe(true);
    expect([tokenId, ...(await listTokens(sql, 'ag-inv-01')), ...sql.log].join('\n')).not.toContain(
      token,
    );
    // The file is written once: a second mint to the same path is refused and stores no row.
    await expect(mintTokenFile(sql, secrets, 'ag-inv-01', out)).rejects.toThrow();
    expect(sql.tokens).toHaveLength(1);
    expect(await tokenIn(out)).toBe(token);
    // The invitee's own limit is the same two active tokens as any player.
    await mintTokenFile(sql, secrets, 'ag-inv-01', join(outDir, 'inv2.env'));
    await expect(
      mintTokenFile(sql, secrets, 'ag-inv-01', join(outDir, 'inv3.env')),
    ).rejects.toThrow('revoke one first');
  });

  it('lists tokens by id, player, status and expiry, never by hash', async () => {
    const sql = await withPlayer();
    const tokenId = await mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'l.env'));
    const lines = await listTokens(sql, 'ag-jo-01');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^${tokenId} ag-jo-01 active expires `));
    expect(lines.join('\n')).not.toContain('token_hash');
  });

  it('revokes one token by id, and every token of a player', async () => {
    const sql = await withPlayer();
    const first = await mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'r1.env'));
    await mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'r2.env'));
    expect(await revokeToken(sql, first)).toBe(1);
    expect((await listTokens(sql)).filter((l) => l.includes(' revoked '))).toHaveLength(1);
    await expect(revokeToken(sql, first)).rejects.toThrow('no active token');
    expect(await revokePlayerTokens(sql, 'ag-jo-01')).toBe(1);
    expect((await listTokens(sql)).some((line) => line.includes(' active '))).toBe(false);
  });

  it('rotates: the new token is active and the old one expires after the grace', async () => {
    const sql = await withPlayer();
    const old = await mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'old.env'));
    const fresh = await rotateTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'new.env'), 10);
    const lines = await listTokens(sql, 'ag-jo-01');
    expect(lines.find((l) => l.startsWith(`${fresh} `))).toContain(' active ');
    const oldRow = sql.tokens.find((t) => t.token_id === old);
    expect((oldRow?.expires ?? 0) - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect((oldRow?.expires ?? 0) - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it('rotates with no grace: the old token is revoked at once, so its revoke NOTIFY fires', async () => {
    const sql = await withPlayer();
    const old = await mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'old0.env'));
    const fresh = await rotateTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'new0.env'), 0);
    const lines = await listTokens(sql);
    expect(lines.find((l) => l.startsWith(`${old} `))).toContain(' revoked ');
    expect(lines.find((l) => l.startsWith(`${fresh} `))).toContain(' active ');
    expect(
      sql.log.some((s) => s.startsWith('UPDATE mcp_tokens SET revoked_at = now() WHERE player_id')),
    ).toBe(true);
    expect(DEFAULT_GRACE_MINUTES).toBe(10);
  });

  it('rotates with a grace: the old token is not revoked, only its expiry is moved', async () => {
    const sql = await withPlayer();
    await mintTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'old-g.env'));
    await rotateTokenFile(sql, secrets, 'ag-jo-01', join(outDir, 'new-g.env'), 10);
    expect(sql.log.some((s) => s.includes('SET revoked_at = now() WHERE player_id'))).toBe(false);
    expect(sql.log.some((s) => s.startsWith('UPDATE mcp_tokens SET expires_at'))).toBe(true);
    expect((await listTokens(sql)).some((line) => line.includes(' revoked '))).toBe(false);
  });

  it('parses --grace-minutes as a whole number from 0 to 1440', () => {
    expect(parseGrace('0')).toBe(0);
    expect(parseGrace('1440')).toBe(1440);
    expect(() => parseGrace('1441')).toThrow('0 to 1440');
    expect(() => parseGrace('-1')).toThrow('0 to 1440');
    expect(() => parseGrace('5.5')).toThrow('0 to 1440');
  });
});
