/**
 * Live case (b) of WM-12: a local stub client drives ag-test-01 through `look`, `act` (gather oak_log) and `wait`.
 * Written, not run. It needs the shard, the MCP container on GELDAR_MCP_URL (default 127.0.0.1:8788) and the test
 * player's token file (GELDAR_MCP_TEST_TOKEN_FILE, outside the repo). Run it with `./geldar.ps1 mcp smoke`.
 * Deterministic: the case names the intent itself and waits in bounded steps; no model chooses anything. It asserts
 * that each tool answers and that the wait returns within its bound. The token is read, never printed.
 * Open: the argument shapes come from contract/schemas/mcp-play.schema.json (ActInput, WaitInput); check them on the first run.
 */
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

const PLAYER = 'ag-test-01';
const WAIT_SECONDS = 25;
const WAIT_STEPS = 4;
const liveEnabled = process.env.GELDAR_IT === '1' && process.env.GELDAR_MCP_LIVE === '1';

function readToken(): string {
  const file = process.env.GELDAR_MCP_TEST_TOKEN_FILE;
  if (file === undefined || file.trim() === '') {
    throw new Error('GELDAR_MCP_TEST_TOKEN_FILE is not set: point it at the ag-test-01 token file');
  }
  return readFileSync(file, 'utf8').trim();
}

describe.skipIf(!liveEnabled)('MCP stub client: look, act gather oak_log, wait', () => {
  it('answers look, takes an act, and each wait returns within its bound', async () => {
    const url = new URL(`${process.env.GELDAR_MCP_URL ?? 'http://127.0.0.1:8788'}/p/${PLAYER}`);
    const client = new Client({ name: 'geldar-stub-client', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${readToken()}` } },
    });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names, `tools seen: ${names.join(', ')}`).toEqual(
        expect.arrayContaining(['look', 'act', 'wait']),
      );

      const looked = await client.callTool({ name: 'look', arguments: {} });
      expect(looked.isError, `look failed: ${JSON.stringify(looked).slice(0, 300)}`).not.toBe(true);

      const acted = await client.callTool({
        name: 'act',
        arguments: { reasoning: 'stub client case', intent: { kind: 'gather', target: 'oak_log' } },
      });
      expect(acted.isError, `act failed: ${JSON.stringify(acted).slice(0, 300)}`).not.toBe(true);

      let cursor: unknown;
      for (let step = 0; step < WAIT_STEPS; step += 1) {
        const started = Date.now();
        const waited = await client.callTool({
          name: 'wait',
          arguments:
            cursor === undefined
              ? { max_seconds: WAIT_SECONDS }
              : { max_seconds: WAIT_SECONDS, cursor },
        });
        const elapsed = Date.now() - started;
        expect(waited.isError, `wait failed: ${JSON.stringify(waited).slice(0, 300)}`).not.toBe(
          true,
        );
        expect(
          elapsed,
          `wait ${step} ran ${elapsed} ms, past its ${WAIT_SECONDS} s bound`,
        ).toBeLessThanOrEqual((WAIT_SECONDS + 10) * 1000);
        const structured = waited.structuredContent as { cursor?: unknown } | undefined;
        cursor = structured?.cursor ?? cursor;
      }
    } finally {
      await client.close();
    }
  }, 300_000);
});
