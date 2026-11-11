import { appendFileSync, closeSync, openSync, statSync } from 'node:fs';
import type { McpWorld } from './app.ts';
import {
  applyOverrides,
  parseScenario,
  readScenarioFile,
  type ScenarioOverrides,
} from './sim/scenario.ts';
import { createSimWorld } from './sim/sim-world.ts';

/**
 * The scenario-driven world the CLI serves: the scenario file with the timing overrides applied, and
 * suppressed wakeups appended to `suppressedLog` as JSONL (never the text). Throws on a bad scenario or log path.
 */
export function createScenarioWorld(options: {
  scenarioPath: string;
  overrides: ScenarioOverrides;
  suppressedLog?: string | undefined;
  log: (line: Record<string, unknown>) => void;
}): McpWorld {
  const scenario = applyOverrides(
    parseScenario(readScenarioFile(options.scenarioPath)),
    options.overrides,
  );
  const logFile = options.suppressedLog;
  if (logFile !== undefined) {
    // Open for append: unlike appendFileSync with no data, this fails on a directory everywhere.
    // Only a directory is refused: /dev/null and named pipes are fine log targets.
    const fd = openSync(logFile, 'a');
    try {
      if (statSync(logFile).isDirectory()) throw new Error('suppressed log: is a directory');
    } finally {
      closeSync(fd);
    }
  }
  return createSimWorld({
    scenario,
    ...(logFile !== undefined
      ? {
          onSuppressed: (record) => {
            try {
              appendFileSync(logFile, `${JSON.stringify(record)}\n`);
            } catch {
              options.log({ event: 'suppressed_log_error' });
            }
          },
        }
      : {}),
  });
}
