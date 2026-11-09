#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { MCP_TOOL_NAMES } from '@geldar/contract';
import { createApp, type McpWorld } from './app.ts';
import { loadTokens } from './auth.ts';
import { createFakeHandlers } from './fake-world.ts';
import type { ToolHandlers } from './registry.ts';
import { createShutdown } from './shutdown.ts';
import { applyOverrides, parseScenario, type ScenarioOverrides } from './sim/scenario.ts';
import { createSimWorld } from './sim/sim-world.ts';

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
  let values: {
    tokens?: string | undefined;
    port?: string | undefined;
    host?: string | undefined;
    scenario?: string | undefined;
    'day-length-seconds'?: string | undefined;
    'min-wake-spacing-seconds'?: string | undefined;
    'intent-run-too-long-seconds'?: string | undefined;
    'suppressed-log'?: string | undefined;
  };
  try {
    values = parseArgs({
      options: {
        tokens: { type: 'string' },
        port: { type: 'string' },
        host: { type: 'string' },
        scenario: { type: 'string' },
        'day-length-seconds': { type: 'string' },
        'min-wake-spacing-seconds': { type: 'string' },
        'intent-run-too-long-seconds': { type: 'string' },
        'suppressed-log': { type: 'string' },
      },
      strict: true,
    }).values;
  } catch (error) {
    return fail(2, error instanceof Error ? error.message : 'bad arguments');
  }
  if (values.tokens === undefined) {
    return fail(
      2,
      'usage: cli.ts --tokens <file> [--port <n>] [--host <addr>] [--scenario <file>] [--day-length-seconds <n>] [--min-wake-spacing-seconds <n>] [--intent-run-too-long-seconds <n>] [--suppressed-log <file>]',
    );
  }
  const overrides: ScenarioOverrides = {};
  const seconds: [string, keyof ScenarioOverrides][] = [
    ['day-length-seconds', 'dayLengthSeconds'],
    ['min-wake-spacing-seconds', 'minWakeSpacingSeconds'],
    ['intent-run-too-long-seconds', 'intentRunTooLongSeconds'],
  ];
  for (const [flag, key] of seconds) {
    const raw = values[flag as keyof typeof values];
    if (raw === undefined) continue;
    if (raw.trim() === '' || !Number.isFinite(Number(raw))) return fail(2, `invalid --${flag}`);
    overrides[key] = Number(raw);
  }
  if (
    values.scenario === undefined &&
    (Object.keys(overrides).length > 0 || values['suppressed-log'])
  ) {
    return fail(2, 'the timing flags and --suppressed-log need --scenario');
  }
  if (values.port !== undefined && !/^[0-9]{1,5}$/.test(values.port)) {
    return fail(2, 'invalid --port');
  }
  const port = values.port === undefined ? 8787 : Number(values.port);
  if (port > 65535) return fail(2, 'invalid --port');
  if (values.host !== undefined && values.host.trim() === '') return fail(2, 'invalid --host');
  const host = values.host ?? '127.0.0.1';

  let tokens: ReturnType<typeof loadTokens>;
  try {
    tokens = loadTokens(values.tokens);
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
      const scenario = applyOverrides(
        parseScenario(readFileSync(values.scenario, 'utf8')),
        overrides,
      );
      const logFile = values['suppressed-log'];
      if (logFile !== undefined) appendFileSync(logFile, '');
      world = createSimWorld({
        scenario,
        ...(logFile !== undefined
          ? {
              onSuppressed: (record) => {
                try {
                  appendFileSync(logFile, `${JSON.stringify(record)}\n`);
                } catch {
                  log({ event: 'suppressed_log_error' });
                }
              },
            }
          : {}),
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
