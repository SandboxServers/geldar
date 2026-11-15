import { readdirSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_TOOL_NAMES } from '@geldar/contract';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpConfig } from './config.ts';
import { FakeKeepAlive, FakeTokenStore, ScriptedRateLimiter } from './fakes/stores.fakes.ts';
import { worldFixture } from './fakes/world.fakes.ts';
import { tokenDigest } from './http/auth.ts';
import { createFrontDoor, type FrontDoor } from './http/front.ts';
import { ConfigRejected, instinctKeyOf } from './main.ts';
import type { PlayerRecord } from './ports.ts';
import { createWorld } from './world.ts';
import { createWorldSession, type WorldSessionDeps } from './world-session.ts';

// The instinct class through the real front door on loopback, with the world and every store faked.
// Keys are built here at runtime; none is a real secret.

const PEPPER = new TextEncoder().encode('instinct-door-pepper-0123456789-stub');
const TOKEN = `gmcp-${'cc'.repeat(32)}`;
const KEY = 'k'.repeat(40);
const WRONG_KEY = 'w'.repeat(40);
const HEADER = 'X-Geldar-Instinct-Key';
const FAR_FUTURE_MS = 10 ** 13;
const START_BUDGET = 37;

const PLAYER: PlayerRecord = {
  playerId: 'ag-instinct-01',
  lifeId: 'ag_instinct_01',
  ownerId: 'owner_03',
  displayName: 'Ivo',
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

const ACT_ARGS = {
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

interface Rig {
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

async function startRig(instinctKey?: Buffer): Promise<Rig> {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, START_BUDGET, 0);
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

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    for (const client of rig.clients) await client.close().catch(() => undefined);
    rig.world.close();
    await rig.door.close();
  }
});

/** A raw POST of `initialize` with the given headers. Resolves to the status once the reply has ended. */
function postInitialize(rig: Rig, headers: Record<string, string | string[]>): Promise<number> {
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

/** An SDK client on the player's path with the given headers on every request. */
async function connectWith(rig: Rig, headers: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'instinct-door', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`/p/${PLAYER.playerId}`, rig.base), {
    requestInit: { headers },
  });
  await client.connect(transport);
  rig.clients.push(client);
  return client;
}

/** The text of one tool call's first content block; a protocol error comes back as its message. */
async function textOf(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text?: string }[];
    return content[0]?.text ?? '';
  } catch (error) {
    return String(error);
  }
}

const AUTH = { Authorization: `Bearer ${TOKEN}` };

describe('the instinct class at the front door', () => {
  it('a right key on an authenticated connection gives the instinct class', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const status = await postInitialize(rig, { ...AUTH, [HEADER]: KEY });
    expect(status).toBe(200);
    expect(rig.sources).toEqual(['instinct']);
  });

  it.each([
    ['a wrong key of the same length', WRONG_KEY],
    ['an empty key', ''],
    ['a key one byte short', 'k'.repeat(39)],
    ['a key one byte long', 'k'.repeat(41)],
  ])('%s is the model class', async (_label, presented) => {
    const rig = await startRig(Buffer.from(KEY));
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: presented })).toBe(200);
    expect(rig.sources).toEqual(['model']);
  });

  it('a repeated header is the model class even when both copies are the key', async () => {
    const rig = await startRig(Buffer.from(KEY));
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: [KEY, KEY] })).toBe(200);
    expect(rig.sources).toEqual(['model']);
  });

  it('with no key loaded (the variable unset) the header counts for nothing', async () => {
    const rig = await startRig(undefined);
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: KEY })).toBe(200);
    expect(rig.sources).toEqual(['model']);
  });

  it('a connection that does not authenticate is refused, with or without the key', async () => {
    const rig = await startRig(Buffer.from(KEY));
    expect(await postInitialize(rig, { [HEADER]: KEY })).toBe(401);
    expect(
      await postInitialize(rig, { Authorization: `Bearer gmcp-${'dd'.repeat(32)}`, [HEADER]: KEY }),
    ).toBe(401);
    expect(rig.sources).toEqual([]);
  });

  it('an act on the instinct connection records source instinct; a model act records none', async () => {
    const instinct = await startRig(Buffer.from(KEY));
    const client = await connectWith(instinct, { ...AUTH, [HEADER]: KEY });
    const reply = await textOf(client, 'act', ACT_ARGS);
    expect(reply).not.toContain('"isError":true');
    const last = instinct.fx.recorder.calls.at(-1);
    expect(last?.source).toBe('instinct');

    const model = await startRig(Buffer.from(KEY));
    const modelClient = await connectWith(model, AUTH);
    await textOf(modelClient, 'act', ACT_ARGS);
    const modelLast = model.fx.recorder.calls.at(-1);
    expect(modelLast).toBeDefined();
    expect(modelLast).not.toHaveProperty('source');
  });

  it('no tool result or error text carries the key, the header name, or a source actor field', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const client = await connectWith(rig, { ...AUTH, [HEADER]: KEY });
    const texts: string[] = [];
    for (const name of MCP_TOOL_NAMES) {
      texts.push(await textOf(client, name, name === 'act' ? ACT_ARGS : {}));
    }
    expect(texts.length).toBe(MCP_TOOL_NAMES.length);
    const joined = texts.join('\n');
    expect(joined).not.toContain(KEY);
    expect(joined.toLowerCase()).not.toContain(HEADER.toLowerCase());
    expect(joined).not.toMatch(/"source"\s*:\s*"(instinct|model|operator)"/);
    expect(rig.fx.recorder.calls.every((c) => c.source !== 'operator')).toBe(true);
  });

  it('an instinct initialize then a model initialize on the same door is the model class, and the reverse', async () => {
    const rig = await startRig(Buffer.from(KEY));
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: KEY })).toBe(200);
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: WRONG_KEY })).toBe(200);
    expect(await postInitialize(rig, AUTH)).toBe(200);
    expect(rig.sources).toEqual(['instinct', 'model', 'model']);
    expect(await postInitialize(rig, { ...AUTH, [HEADER]: KEY })).toBe(200);
    expect(rig.sources).toEqual(['instinct', 'model', 'model', 'instinct']);
  });

  it('the log never carries the key or the header value, not even on a wrong key', async () => {
    const rig = await startRig(Buffer.from(KEY));
    await postInitialize(rig, { ...AUTH, [HEADER]: WRONG_KEY });
    await postInitialize(rig, { ...AUTH, [HEADER]: KEY });
    await postInitialize(rig, { [HEADER]: KEY });
    const logged = JSON.stringify(rig.logs);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(WRONG_KEY);
  });

  it('the start-up key read loads a usable key, and refuses a set file that is not one with one constant line', async () => {
    const key = 'k'.repeat(40);
    expect(await instinctKeyOf(undefined, async () => key)).toBeUndefined();
    expect(await instinctKeyOf('/run/secrets/k', async () => `${key}\n`)).toEqual(Buffer.from(key));
    const unusable: (() => Promise<string>)[] = [
      async () => '',
      async () => 'k'.repeat(5),
      async () => ` ${key}`,
      async () => `${key}\n\n`,
      async () => `﻿${key}`,
      async () => 'é'.repeat(40),
      async () => {
        throw new Error('ENOENT: /run/secrets/k');
      },
    ];
    for (const read of unusable) {
      const error: unknown = await instinctKeyOf('/run/secrets/k', read).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ConfigRejected);
      const message = (error as Error).message;
      expect(message).toMatch(/^GELDAR_MCP_INSTINCT_KEY_FILE names a file that is /);
      expect(message).not.toContain('\n');
      expect(message).not.toContain('/run/secrets');
      expect(message).not.toContain('kkkkk');
    }
  });

  it('no source file under threshold/mcp/src assigns the operator class', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const assigning = files.filter((f) =>
      /source\s*[:=]\s*['"]operator['"]/.test(readFileSync(join(dir, f), 'utf8')),
    );
    expect(assigning).toEqual([]);
  });
});
