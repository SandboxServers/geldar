import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTokens } from './auth.ts';
import { createMockHttp, type MockHttp } from './server.ts';

const TOKEN_A = 'token-for-player-a-0123456789';

let dir: string;
let http: MockHttp;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-mock-ends-'));
  const file = join(dir, 'tokens.json');
  writeFileSync(file, JSON.stringify({ aa: TOKEN_A }));
  http = createMockHttp({ tokens: loadTokens(file), log: () => undefined });
  base = `http://127.0.0.1:${await http.listen(0)}`;
}, 10_000);

afterEach(async () => {
  await http.close();
  rmSync(dir, { recursive: true, force: true });
}, 10_000);

describe('endPlayerSessions after a response has ended', () => {
  it('skips a tracked response that already ended, without an uncaught error', async () => {
    // The origin gate ends a tracked response with 403 in the same tick; the spy ends the
    // sessions right after that end(), while the response is still in the open set.
    const realEnd = ServerResponse.prototype.end;
    let fired = false;
    const spy = vi
      .spyOn(ServerResponse.prototype, 'end')
      .mockImplementation(function (this: ServerResponse, ...args: unknown[]) {
        const result = Reflect.apply(realEnd, this, args);
        if (this.statusCode === 403 && !fired) {
          fired = true;
          void http.endPlayerSessions('aa', 'session_revoked');
        }
        return result;
      });
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);
    process.on('uncaughtException', onError);
    try {
      const res = await fetch(`${base}/p/aa`, { headers: { Origin: 'https://evil.example' } });
      expect(res.status).toBe(403);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fired).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      process.off('uncaughtException', onError);
      spy.mockRestore();
    }
  }, 10_000);
});
