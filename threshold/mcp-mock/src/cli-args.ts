import { parseArgs } from 'node:util';
import type { ScenarioOverrides } from './sim/scenario.ts';

export interface CliOptions {
  tokens: string;
  port: number;
  host: string;
  scenario: string | undefined;
  overrides: ScenarioOverrides;
  suppressedLog: string | undefined;
}

/** A refusal: the process exits with `code` after printing `message`. */
export interface CliRefusal {
  code: number;
  message: string;
}

const SECONDS_FLAGS = [
  ['day-length-seconds', 'dayLengthSeconds'],
  ['min-wake-spacing-seconds', 'minWakeSpacingSeconds'],
  ['intent-run-too-long-seconds', 'intentRunTooLongSeconds'],
] as const satisfies readonly (readonly [string, keyof ScenarioOverrides])[];

/** Pure argv parsing for cli.ts: no exit, no I/O. */
export function parseCliArgs(args: readonly string[]): CliOptions | CliRefusal {
  let values: ReturnType<typeof parseValues>;
  try {
    values = parseValues(args);
  } catch (error) {
    return { code: 2, message: error instanceof Error ? error.message : 'bad arguments' };
  }
  if (values.tokens === undefined) {
    return {
      code: 2,
      message:
        'usage: cli.ts --tokens <file> [--port <n>] [--host <addr>] [--scenario <file>] [--day-length-seconds <n>] [--min-wake-spacing-seconds <n>] [--intent-run-too-long-seconds <n>] [--suppressed-log <file>]',
    };
  }
  const overrides: ScenarioOverrides = {};
  for (const [flag, key] of SECONDS_FLAGS) {
    const raw = values[flag];
    if (raw === undefined) continue;
    if (raw.trim() === '' || !Number.isFinite(Number(raw))) {
      return { code: 2, message: `invalid --${flag}` };
    }
    overrides[key] = Number(raw);
  }
  if (
    values.scenario === undefined &&
    (Object.keys(overrides).length > 0 || values['suppressed-log'] !== undefined)
  ) {
    return { code: 2, message: 'the timing flags and --suppressed-log need --scenario' };
  }
  if (values.port !== undefined && !/^[0-9]{1,5}$/.test(values.port)) {
    return { code: 2, message: 'invalid --port' };
  }
  const port = values.port === undefined ? 8787 : Number(values.port);
  if (port > 65535) return { code: 2, message: 'invalid --port' };
  if (values.host !== undefined && values.host.trim() === '') {
    return { code: 2, message: 'invalid --host' };
  }
  return {
    tokens: values.tokens,
    port,
    host: values.host ?? '127.0.0.1',
    scenario: values.scenario,
    overrides,
    suppressedLog: values['suppressed-log'],
  };
}

function parseValues(args: readonly string[]) {
  return parseArgs({
    args: [...args],
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
}
