#!/usr/bin/env node
import { MCP_TOOL_NAMES } from '@geldar/contract';
import { createApp, type McpWorld } from './app.ts';
import { loadTokens } from './auth.ts';
import { parseCliArgs } from './cli-args.ts';
import { createFakeHandlers } from './fake-world.ts';
import type { ToolHandlers } from './registry.ts';
import { createScenarioWorld } from './scenario-world.ts';
import { createShutdown } from './shutdown.ts';

/** A fixed fake world; each player gets its own handler set, built on first use (the set holds a counter). */
function createFixedWorld(): McpWorld {
  const perPlayer = new Map<string, ToolHandlers>();
  const handlersFor = (playerId: string): ToolHandlers => {
    let set = perPlayer.get(playerId);
    if (set === undefined) {
      set = createFakeHandlers();
      perPlayer.set(playerId, set);
    }
    return set;
  };
  const tools = Object.fromEntries(
    MCP_TOOL_NAMES.map((name) => [
      name,
      (input, ctx) => handlersFor(ctx.playerId)[name](input, ctx),
    ]),
  ) as ToolHandlers;
  return {
    tools,
    readSelf: (playerId) => ({ name: playerId, seed: 'mock-seed-0001', born_day: 0 }),
    readJournalRecent: () => 'Nothing written yet.',
    readShardRules: () => ({ chat_radius: 32 }),
  };
}

function fail(code: number, message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ('code' in parsed) return fail(parsed.code, parsed.message);
  const { host, port, overrides } = parsed;
  const values = { scenario: parsed.scenario, 'suppressed-log': parsed.suppressedLog };
  let tokens: ReturnType<typeof loadTokens>;
  try {
    tokens = loadTokens(parsed.tokens);
  } catch (error) {
    return fail(1, error instanceof Error ? error.message : 'cannot load the tokens file');
  }

  // Request lines only: never tokens or request bodies.
  const log = (line: Record<string, unknown>): void => {
    process.stderr.write(`${JSON.stringify(line)}\n`);
  };
  let world: McpWorld;
  if (values.scenario === undefined) {
    world = createFixedWorld();
  } else {
    try {
      world = createScenarioWorld({
        scenarioPath: values.scenario,
        overrides,
        suppressedLog: values['suppressed-log'],
        log,
      });
    } catch (error) {
      return fail(1, error instanceof Error ? error.message : 'cannot load the scenario');
    }
  }
  const app = createApp({ tokens, world, log });
  const stop = createShutdown({
    close: () => app.close(),
    log,
    exit: (code) => process.exit(code),
    setTimer: (fn, ms) => setTimeout(fn, ms),
  });
  // Registered before listening so a signal right after the `listening` line is always handled.
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const bound = await app.listen(port, host);
  log({ event: 'listening', host, port: bound });
}

main().catch((error: unknown) => {
  fail(1, error instanceof Error ? error.message : 'failed to start');
});
