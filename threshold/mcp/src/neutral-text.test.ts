import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { worldFixture } from './fakes/world.fakes.ts';
import { safeLogLine } from './http/log.ts';
import type { PlayerRecord } from './ports.ts';
import { createWorld } from './world.ts';
import { createWorldSession, type WorldSessionDeps } from './world-session.ts';

const PLAYER: PlayerRecord = {
  playerId: 'ag-ranger-01',
  lifeId: 'ag_ranger_01',
  ownerId: 'owner_01',
  displayName: 'Jason',
  harness: 'claude-code',
  status: 'active',
};

/** Words a player must never read about the world's nature (decisions 0058 and 0059). */
const FORBIDDEN = /mock|stand-in|simulated|fake/i;
/** The neutral text a player reads when the server fails (`PLAYER_FAULT` in resources.ts). */
const NEUTRAL_FAULT = 'something went wrong; try again';

/** The real world on fakes. `tools` may replace handlers; `shardFault` makes the shard rules read throw. */
function worldDeps(
  tools: ((real: WorldSessionDeps['tools']) => WorldSessionDeps['tools']) | undefined,
  shardFault: boolean,
): WorldSessionDeps {
  const fx = worldFixture([PLAYER]);
  fx.budget.seed(PLAYER.lifeId, 37, 0);
  const real = createWorld(fx.deps).tools;
  const healthy = { chatRadius: 16, waitCapSeconds: 240, tickRate: 20 };
  const broken = {
    get chatRadius(): number {
      throw new Error('the shard store is down');
    },
    waitCapSeconds: 240,
    tickRate: 20,
  };
  return {
    tools: tools ? tools(real) : real,
    players: fx.players,
    resources: {
      profiles: { profile: async () => ({ personality_seed: 'calm and curious', born_day: 3 }) },
      journal: fx.journal,
      shard: shardFault ? broken : healthy,
    },
    keepAlive: { start: () => () => {} },
    keepaliveMs: 25_000,
  };
}

/** Opens one session for the player and a client connected to it in process. */
async function open(deps: WorldSessionDeps): Promise<Client> {
  const session = createWorldSession(deps, PLAYER.playerId, new AbortController().signal);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await session.connect(serverSide);
  const client = new Client({ name: 'neutral-text-test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

/** A resource's text, or the error message a player would read when the read fails. */
async function readOrError(client: Client, uri: string): Promise<string> {
  return client.readResource({ uri }).then(
    (result) => JSON.stringify(result.contents),
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  );
}

/** Every string a player can read from a session: instructions, tools, prompts and resources. */
async function playerText(client: Client): Promise<string[]> {
  const out: string[] = [client.getInstructions() ?? ''];
  for (const tool of (await client.listTools()).tools) out.push(JSON.stringify(tool));
  for (const prompt of (await client.listPrompts()).prompts) {
    out.push(JSON.stringify(prompt));
    out.push(JSON.stringify(await client.getPrompt({ name: prompt.name })));
  }
  for (const resource of (await client.listResources()).resources) {
    out.push(JSON.stringify(resource));
    out.push(await readOrError(client, resource.uri));
  }
  return out;
}

describe('the player reads nothing about the world being a mock', () => {
  it('has no stand-in words in the instructions, tools, prompts or resources', async () => {
    const client = await open(worldDeps(undefined, false));
    try {
      const strings = await playerText(client);
      expect(strings.length).toBeGreaterThan(10);
      expect(strings.filter((s) => FORBIDDEN.test(s))).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('reads a neutral message when a tool handler faults', async () => {
    const boom = (real: WorldSessionDeps['tools']): WorldSessionDeps['tools'] => ({
      ...real,
      look: () => {
        throw new Error('the handler broke');
      },
    });
    const client = await open(worldDeps(boom, false));
    try {
      const reply = await client.callTool({ name: 'look', arguments: {} });
      const text = JSON.stringify(reply);
      expect(text).toContain(`internal_error: ${NEUTRAL_FAULT}`);
      expect(FORBIDDEN.test(text)).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('reads a neutral message when a resource read faults', async () => {
    const client = await open(worldDeps(undefined, true));
    try {
      const strings = await playerText(client);
      expect(strings.some((s) => s.includes(NEUTRAL_FAULT))).toBe(true);
      expect(strings.filter((s) => FORBIDDEN.test(s))).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

/** A credential-looking canary that no log line may carry. */
const CANARY = 'canary-7Qz9xLm2Vb4nKp8sWd1';

describe('the operator sees the cause of a fault, never a secret', () => {
  it('logs the cause of a tool fault with the token redacted', async () => {
    const lines: Record<string, string | number>[] = [];
    const boom = (real: WorldSessionDeps['tools']): WorldSessionDeps['tools'] => ({
      ...real,
      look: () => {
        throw new Error(`the store refused Bearer ${CANARY}`);
      },
    });
    const deps = {
      ...worldDeps(boom, false),
      log: (line: Record<string, unknown>) => lines.push(safeLogLine(line)),
    };
    const client = await open(deps);
    try {
      const reply = await client.callTool({ name: 'look', arguments: {} });
      expect(JSON.stringify(reply)).toContain(`internal_error: ${NEUTRAL_FAULT}`);
    } finally {
      await client.close();
    }
    const fault = lines.find((line) => line.event === 'tool_log');
    expect(fault?.player_id).toBe(PLAYER.playerId);
    expect(String(fault?.cause)).toContain('the store refused');
    expect(JSON.stringify(lines)).not.toContain(CANARY.slice(0, 12));
  });

  it('logs the cause of a resource fault', async () => {
    const lines: Record<string, string | number>[] = [];
    const deps = {
      ...worldDeps(undefined, true),
      log: (line: Record<string, unknown>) => lines.push(safeLogLine(line)),
    };
    const client = await open(deps);
    try {
      expect(await readOrError(client, 'geldar://shard/rules')).toContain(NEUTRAL_FAULT);
    } finally {
      await client.close();
    }
    const fault = lines.find((line) => line.event === 'resource_error');
    expect(String(fault?.cause)).toContain('the shard store is down');
  });
});

describe('a database fault reaches the player as the neutral text, with its cause logged', () => {
  const refusal = 'connect ECONNREFUSED 127.0.0.1:5432';
  const denied = 'permission denied for table mcp_journal';

  it('reads the neutral fault when the profile read throws', async () => {
    const lines: Record<string, string | number>[] = [];
    const base = worldDeps(undefined, false);
    const profiles = {
      profile: async () => {
        throw new Error(refusal);
      },
    };
    const deps = {
      ...base,
      resources: { ...base.resources, profiles },
      log: (line: Record<string, unknown>) => lines.push(safeLogLine(line)),
    };
    const client = await open(deps);
    try {
      const reply = await readOrError(client, 'geldar://player/self');
      expect(reply).toContain(NEUTRAL_FAULT);
      expect(reply).not.toContain('ECONNREFUSED');
      expect(await readOrError(client, 'geldar://shard/rules')).not.toContain(NEUTRAL_FAULT);
    } finally {
      await client.close();
    }
    const fault = lines.find((line) => line.event === 'resource_error');
    expect(String(fault?.cause)).toContain(refusal);
  });

  it('reads the neutral fault when the journal read throws, and logs the cause', async () => {
    const lines: Record<string, string | number>[] = [];
    const base = worldDeps(undefined, false);
    const journal = {
      append: async () => {},
      recent: async () => {
        throw new Error(denied);
      },
    };
    const deps = {
      ...base,
      resources: { ...base.resources, journal },
      log: (line: Record<string, unknown>) => lines.push(safeLogLine(line)),
    };
    const client = await open(deps);
    try {
      const reply = await readOrError(client, 'geldar://player/journal/recent');
      expect(reply).toContain(NEUTRAL_FAULT);
      expect(reply).not.toContain('permission denied');
    } finally {
      await client.close();
    }
    const fault = lines.find((line) => line.event === 'resource_error');
    expect(String(fault?.cause)).toContain(denied);
  });

  it('reads the neutral fault when the player lookup throws, and logs the cause', async () => {
    const lines: Record<string, string | number>[] = [];
    const credential = 'password authentication failed for user "geldar_mcp"';
    const base = worldDeps(undefined, false);
    const players = {
      find: async () => {
        throw new Error(credential);
      },
    };
    const deps = {
      ...base,
      players,
      log: (line: Record<string, unknown>) => lines.push(safeLogLine(line)),
    };
    const client = await open(deps);
    try {
      const reply = await readOrError(client, 'geldar://shard/rules');
      expect(reply).toContain(NEUTRAL_FAULT);
      expect(reply).not.toContain('password authentication');
      expect(reply).not.toContain('geldar_mcp');
    } finally {
      await client.close();
    }
    const fault = lines.find((line) => line.event === 'resource_error');
    expect(String(fault?.cause)).toContain(credential);
  });
});
