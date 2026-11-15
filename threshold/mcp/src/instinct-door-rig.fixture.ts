import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpConfig } from './config.ts';
import { FakeKeepAlive, FakeTokenStore, ScriptedRateLimiter } from './fakes/stores.fakes.ts';
import { worldFixture } from './fakes/world.fakes.ts';
import { tokenDigest } from './http/auth.ts';
import { createFrontDoor, type FrontDoor } from './http/front.ts';
import type { PlayerRecord } from './ports.ts';
import { createWorld } from './world.ts';
import { createWorldSession, type WorldSessionDeps } from './world-session.ts';

// The door rig for the instinct tests: the real front door on loopback, with the world and every
// store faked. Two players, each with its own token, so a model client and an instinct client can be
// live at once (the server keeps one MCP session per player). Keys are built at runtime; none is a
// real secret.

const PEPPER = new TextEncoder().encode('instinct-door-pepper-0123456789-stub');
export const TOKEN = `gmcp-${'cc'.repeat(32)}`;
export const TOKEN_B = `gmcp-${'ee'.repeat(32)}`;
export const KEY = 'k'.repeat(40);
export const WRONG_KEY = 'w'.repeat(40);
export const HEADER = 'X-Geldar-Instinct-Key';
export const AUTH = { Authorization: `Bearer ${TOKEN}` };
export const AUTH_B = { Authorization: `Bearer ${TOKEN_B}` };
const FAR_FUTURE_MS = 10 ** 13;
const START_BUDGET = 37;
/** A quick tool that has not answered by then is a finding; the rig never waits on it. */
const CALL_TIMEOUT_MS = 2_000;

export const PLAYER: PlayerRecord = {
  playerId: 'ag-instinct-01',
  lifeId: 'ag_instinct_01',
  ownerId: 'owner_03',
  displayName: 'Ivo',
  harness: 'claude-code',
  status: 'active',
  declaredModel: null,
};

/** A second player, for a model and an instinct client that must be live at the same time. */
export const OTHER_PLAYER: PlayerRecord = {
  playerId: 'ag-instinct-02',
  lifeId: 'ag_instinct_02',
  ownerId: 'owner_04',
  displayName: 'Mara',
  harness: 'claude-code',
  status: 'active',
  declaredModel: null,
};

const CONFIG = {
  bind: '127.0.0.1',
  port: 0,
  allowedHosts: ['localhost', '127.0.0.1'],
  publicHost: null,
} as McpConfig['http'];

export const ACT_ARGS = {
  reasoning: 'walk to the wood and gather it',
  intent: {
    goal: 'collect_wood',
    program: 'gather',
    arguments: { block: 'oak_log', count: 12 },
    wake_on: ['goal_completed'],
    limits: { max_world_ticks: 6000, max_block_operations: 100 },
  },
  actions: [{ do: 'goto', target: { x: 1, y: 64, z: 1 } }],
};

export interface Rig {
  fx: ReturnType<typeof worldFixture>;
  world: ReturnType<typeof createWorld>;
  door: FrontDoor;
  base: URL;
  /** The class each new session was given, in order. */
  sources: (string | undefined)[];
  /** Every log line the front door wrote. */
  logs: Record<string, unknown>[];
  clients: Client[];
}

const rigs: Rig[] = [];

/** A door on loopback with PLAYER and OTHER_PLAYER registered; `instinctKey` is the loaded key, if any. */
export async function startRig(instinctKey?: Buffer): Promise<Rig> {
  const fx = worldFixture([PLAYER, OTHER_PLAYER]);
  fx.budget.seed(PLAYER.lifeId, START_BUDGET, 0);
  fx.budget.seed(OTHER_PLAYER.lifeId, START_BUDGET, 0);
  const world = createWorld({ ...fx.deps, enforce: false });
  const sessionDeps: WorldSessionDeps = {
    tools: world.tools,
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
    keepAlive: new FakeKeepAlive(),
    keepaliveMs: 25_000,
  };
  const store = new FakeTokenStore();
  store.add({
    tokenId: 'tok_instinct',
    tokenHash: tokenDigest(PEPPER, TOKEN),
    player: PLAYER,
    expiresAtMs: FAR_FUTURE_MS,
    revoked: false,
  });
  store.add({
    tokenId: 'tok_instinct_b',
    tokenHash: tokenDigest(PEPPER, TOKEN_B),
    player: OTHER_PLAYER,
    expiresAtMs: FAR_FUTURE_MS,
    revoked: false,
  });
  const sources: (string | undefined)[] = [];
  const logs: Record<string, unknown>[] = [];
  const door = createFrontDoor({
    http: CONFIG,
    pepper: PEPPER,
    store,
    limiter: new ScriptedRateLimiter(),
    instinctKey,
    createSession: (playerId, signal, ctx) => {
      sources.push(ctx?.source);
      return createWorldSession(sessionDeps, playerId, signal, ctx);
    },
    log: (line) => logs.push(line),
    now: () => fx.clock.nowMs(),
  });
  const port = await door.listen(0);
  const rig: Rig = {
    fx,
    world,
    door,
    base: new URL(`http://127.0.0.1:${port}`),
    sources,
    logs,
    clients: [],
  };
  rigs.push(rig);
  return rig;
}

/** Closes every client, world and door the rigs opened. Call from afterEach. */
export async function closeRigs(): Promise<void> {
  for (const rig of rigs.splice(0)) {
    for (const client of rig.clients) await client.close().catch(() => undefined);
    rig.world.close();
    await rig.door.close();
  }
}

/** A raw POST of `initialize` to PLAYER's path with the given headers. Resolves to the status once the reply has ended. */
export function postInitialize(
  rig: Rig,
  headers: Record<string, string | string[]>,
): Promise<number> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'instinct-door', version: '0.0.0' },
    },
  });
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(`/p/${PLAYER.playerId}`, rig.base),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** An SDK client on the given player's path (PLAYER by default) with the headers on every request. */
export async function connectWith(
  rig: Rig,
  headers: Record<string, string>,
  player: PlayerRecord = PLAYER,
): Promise<Client> {
  const client = new Client({ name: 'instinct-door', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`/p/${player.playerId}`, rig.base), {
    requestInit: { headers },
  });
  await client.connect(transport);
  rig.clients.push(client);
  return client;
}

/** One tool call's reply: its first content block, and whether the server flagged it as an error. */
export async function replyOf(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silent = new Promise<'silent'>((resolve) => {
    timer = setTimeout(() => resolve('silent'), CALL_TIMEOUT_MS);
  });
  try {
    const reply = await Promise.race([client.callTool({ name, arguments: args }), silent]);
    if (reply === 'silent') return { text: `no reply within ${CALL_TIMEOUT_MS} ms`, isError: true };
    const content = reply.content as { type: string; text?: string }[];
    return { text: content[0]?.text ?? '', isError: reply.isError === true };
  } catch (error) {
    return { text: String(error), isError: true };
  } finally {
    clearTimeout(timer);
  }
}

/** The text of one tool call's first content block; a protocol error comes back as its message. */
export async function textOf(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return (await replyOf(client, name, args)).text;
}
