import { readdirSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_TOOL_NAMES, type McpToolName, mcpToolSchemas } from '@geldar/contract';
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

/** One tool call's reply: its first content block, and whether the server flagged it as an error. */
async function replyOf(
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
async function textOf(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return (await replyOf(client, name, args)).text;
}

const AUTH = { Authorization: `Bearer ${TOKEN}` };

/** A quick tool that has not answered by then is a finding, named by the scan; the test never waits on it. */
const CALL_TIMEOUT_MS = 2_000;

/** Valid minimal inputs (from each tool's own tests), so the scan runs the success path of these tools. */
const QUICK_INPUTS: Partial<Record<McpToolName, Record<string, unknown>>> = {
  act: ACT_ARGS,
  journal: { text: 'Dusk.' },
  look: {},
  see: {},
  status: {},
  view: {},
};

/** Tools the runtime scan never calls, with the reason. The registry walk still covers them. */
const NOT_CALLED: Partial<Record<McpToolName, string>> = {
  wait: 'blocks until the world moves (max_seconds 1 ran past 60 s in the fake world)',
  sleep: 'starts a sleep plan on the Body; the door rig has no quick fixture for it',
};

/** Tools with no quick valid input in this rig: called with {} only, so their validation error is scanned. */
const NO_QUICK_INPUT: Partial<Record<McpToolName, string>> = {
  read_book: 'a success needs a book the player holds; the door rig holds none',
  say: 'a say waits for the Body to take the line; the door rig does not answer it',
  define_skill: 'a success needs a skill fixture',
  use_skill: 'a success needs a defined skill and a body',
  offer: 'a success needs a shrine fixture',
  propose: 'a success needs a law-making fixture',
  vote: 'a success needs an open proposal fixture',
  write_book: 'a success needs a book fixture',
};

/** A reply's text, parsed or raw, carrying the key, the header name, or the word instinct. */
function leaksInText(text: string): string[] {
  const found: string[] = [];
  if (text.includes(KEY)) found.push('the key');
  if (text.toLowerCase().includes(HEADER.toLowerCase())) found.push('the header name');
  // Anchored on the quoted value: the fixture's agent id (ag_instinct_01) is not an actor.
  if (/"(instinct|operator)"/.test(text)) found.push('instinct or operator as a quoted value');
  try {
    leaksInJson(JSON.parse(text), found);
  } catch {
    // Not JSON: the raw checks above are the whole scan.
  }
  return found;
}

/** Every key and value of a parsed reply: a `source` key, or instinct or operator as a value, is a leak. */
function leaksInJson(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) leaksInJson(item, out);
    return;
  }
  if (typeof node === 'string') {
    if (node === 'instinct' || node === 'operator') out.push('instinct as an actor value');
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'source') out.push('a source field');
    leaksInJson(value, out);
  }
}

/** A result schema, every level: a property or key named source, or an enum with the class, is a leak. */
function schemaLeaks(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) schemaLeaks(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'source') out.push('a property or key named source');
    if (
      key === 'enum' &&
      Array.isArray(value) &&
      value.some((v) => v === 'instinct' || v === 'operator')
    ) {
      out.push('an enum with the instinct or operator class');
    }
    schemaLeaks(value, out);
  }
}

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

  it('no tool reply carries the key, the header name, a source field, or instinct as an actor', async () => {
    const rig = await startRig(Buffer.from(KEY));
    const client = await connectWith(rig, { ...AUTH, [HEADER]: KEY });
    const problems: string[] = [];
    const called: string[] = [];
    for (const name of MCP_TOOL_NAMES) {
      if (name in NOT_CALLED) continue;
      const quick = QUICK_INPUTS[name];
      if (quick === undefined && !(name in NO_QUICK_INPUT)) {
        problems.push(`${name}: neither a quick input nor a reason in the allowlist`);
      }
      const reply = await replyOf(client, name, quick ?? {});
      called.push(name);
      if (quick !== undefined && reply.isError) {
        problems.push(`${name}: the success path did not run: ${reply.text.slice(0, 120)}`);
      }
      for (const found of leaksInText(reply.text)) problems.push(`${name}: ${found}`);
    }
    expect(called.length).toBe(MCP_TOOL_NAMES.length - Object.keys(NOT_CALLED).length);
    expect(problems).toEqual([]);
    expect(rig.fx.recorder.calls.every((c) => c.source !== 'operator')).toBe(true);
  });

  it('the scan sees a source field, an actor value and the key when they are in a reply', () => {
    const planted = JSON.stringify({ ok: true, source: 'instinct', nested: { actor: 'instinct' } });
    const found = leaksInText(planted);
    expect(found).toContain('instinct or operator as a quoted value');
    expect(found).toContain('a source field');
    expect(found).toContain('instinct as an actor value');
    expect(leaksInText(`{"echo":"${KEY}"}`)).toContain('the key');
    expect(leaksInText(`{"echo":"${HEADER.toLowerCase()}"}`)).toContain('the header name');
  });

  it('the registry result schemas declare no source property, no class enum, and no key or header text', () => {
    const problems: string[] = [];
    for (const name of MCP_TOOL_NAMES) {
      const found: string[] = [];
      schemaLeaks(mcpToolSchemas[name].result, found);
      const raw = JSON.stringify(mcpToolSchemas[name].result);
      if (raw.includes(KEY)) found.push('the key');
      if (raw.toLowerCase().includes(HEADER.toLowerCase())) found.push('the header name');
      if (/instinct|operator/i.test(raw)) found.push('the word instinct or operator');
      for (const reason of found) problems.push(`${name}: ${reason}`);
    }
    expect(problems).toEqual([]);
    const walked: string[] = [];
    schemaLeaks({ properties: { source: { enum: ['model', 'instinct', 'operator'] } } }, walked);
    expect(walked).toEqual([
      'a property or key named source',
      'an enum with the instinct or operator class',
    ]);
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
