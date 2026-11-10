import { MCP_TOOL_NAMES } from '@geldar/contract';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { worldFixture } from './fakes/world.fakes.ts';
import type { KeepAlive, PlayerRecord } from './ports.ts';
import { createWorld } from './world.ts';
import {
  createWorldSession,
  KEEPALIVE_TEXT,
  LOGGER_NAME,
  startKeepAlive,
  type WorldSessionDeps,
} from './world-session.ts';

const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: 'ag_ranger_01',
  ownerId: 'owner_01',
  displayName: 'Jason',
  harness: 'claude-code',
  status: 'active',
};
const KEEPALIVE_MS = 25_000;

/** A keepalive that keeps every tick, so a test can fire them and count starts and stops. */
class RecordingKeepAlive implements KeepAlive {
  readonly starts: number[] = [];
  readonly ticks: (() => void)[] = [];
  stops = 0;

  start(intervalMs: number, tick: () => void): () => void {
    this.starts.push(intervalMs);
    this.ticks.push(tick);
    return () => {
      this.stops += 1;
      this.ticks.splice(this.ticks.indexOf(tick), 1);
    };
  }
}

function deps(keepAlive: KeepAlive): WorldSessionDeps {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  return {
    tools: createWorld(fx.deps).tools,
    players: fx.players,
    resources: {
      profiles: { profile: async () => ({ personality_seed: 'calm and curious', born_day: 3 }) },
      journal: fx.journal,
      shard: {
        chatRadius: 16,
        waitCapSeconds: 240,
        tickRate: 20,
        maxBodyBytes: 65536,
        maxResultBytes: 16384,
        presence: { leaseSeconds: 60, hibernateAfterSeconds: 600 },
      },
    },
    keepAlive,
    keepaliveMs: KEEPALIVE_MS,
  };
}

/** Opens one session for the player and a client connected to it in process. */
async function connect(keepAlive: KeepAlive) {
  const session = createWorldSession(
    deps(keepAlive),
    PLAYER.playerId,
    new AbortController().signal,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await session.connect(serverSide);
  const client = new Client({ name: 'world-session-test', version: '0.0.0' });
  await client.connect(clientSide);
  return { client, close: () => client.close() };
}

describe('the session declares its capabilities', () => {
  it('declares the logging capability next to tools, resources and prompts', async () => {
    const { client, close } = await connect(new RecordingKeepAlive());
    const capabilities = client.getServerCapabilities();
    expect(capabilities?.logging).toBeDefined();
    expect(capabilities?.tools).toBeDefined();
    expect(capabilities?.resources).toBeDefined();
    expect(capabilities?.prompts).toBeDefined();
    await close();
  });

  it('lists all fourteen contract tools and accepts a logging level', async () => {
    const { client, close } = await connect(new RecordingKeepAlive());
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    await expect(client.setLoggingLevel('debug')).resolves.toEqual({});
    await close();
  });
});

describe('the keepalive', () => {
  it('starts at the configured interval for a tool call and stops when the call ends', async () => {
    const keepAlive = new RecordingKeepAlive();
    const { client, close } = await connect(keepAlive);
    const reply = await client.callTool({ name: 'look', arguments: {} });
    expect(reply.isError).not.toBe(true);
    expect(keepAlive.starts).toEqual([KEEPALIVE_MS]);
    expect(keepAlive.stops).toBe(1);
    expect(keepAlive.ticks).toEqual([]);
    await close();
  });

  it('sends a debug log message on the request stream when the client sent no progress token', () => {
    const sent: ServerNotification[] = [];
    const keepAlive = new RecordingKeepAlive();
    startKeepAlive(
      keepAlive,
      KEEPALIVE_MS,
      async (n) => {
        sent.push(n);
      },
      undefined,
    );
    keepAlive.ticks[0]?.();
    expect(sent).toEqual([
      {
        method: 'notifications/message',
        params: { level: 'debug', logger: LOGGER_NAME, data: KEEPALIVE_TEXT },
      },
    ]);
  });

  it('sends a progress notification with the client token and a rising count when it has one', () => {
    const sent: ServerNotification[] = [];
    const keepAlive = new RecordingKeepAlive();
    startKeepAlive(
      keepAlive,
      KEEPALIVE_MS,
      async (n) => {
        sent.push(n);
      },
      'token-7',
    );
    keepAlive.ticks[0]?.();
    keepAlive.ticks[0]?.();
    expect(sent.map((n) => n.params)).toEqual([
      { progressToken: 'token-7', progress: 1, message: KEEPALIVE_TEXT },
      { progressToken: 'token-7', progress: 2, message: KEEPALIVE_TEXT },
    ]);
  });

  it('stops ticking once its stop function runs', () => {
    const sent: ServerNotification[] = [];
    const keepAlive = new RecordingKeepAlive();
    const stop = startKeepAlive(
      keepAlive,
      KEEPALIVE_MS,
      async (n) => {
        sent.push(n);
      },
      undefined,
    );
    stop();
    expect(keepAlive.ticks).toEqual([]);
    expect(sent).toEqual([]);
  });
});
