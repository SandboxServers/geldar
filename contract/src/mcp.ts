/**
 * The MCP tool surface: bundled tool definitions and validators looked up by tool name.
 * The types cover all fourteen tools.
 */
import type { ValidateFunction } from 'ajv';
import { MCP_TOOL_NAMES } from './generated/mcp-tools.ts';
import * as generatedValidators from './generated/validators.js';
import { formatError, type ValidationResult } from './validation.ts';

export { MCP_TOOL_NAMES, type McpToolName, mcpToolSchemas } from './generated/mcp-tools.ts';

import type { ActionOutcome } from './generated/types.ts';

export type {
  ActInput,
  ActionOutcome,
  ActResult,
  DefineSkillInput,
  DefineSkillResult,
  JournalInput,
  JournalResult,
  LookInput,
  LookResult,
  McpCursor,
  McpInterest,
  McpPlayerEvent,
  McpWakeReason,
  OfferInput,
  ProposeInput,
  ProposeResult,
  ReadBookInput,
  ReadBookResult,
  SayInput,
  SayResult,
  SleepInput,
  SleepResult,
  StatusInput,
  StatusResult,
  UntrustedWorldText,
  UseSkillInput,
  VoteInput,
  WaitInput,
  WaitResult,
  WriteBookInput,
  WriteBookResult,
} from './generated/types.ts';

/** The three tools whose result is just the outcome share its type (the schema $refs it). */
export type UseSkillResult = ActionOutcome;
export type OfferResult = ActionOutcome;
export type VoteResult = ActionOutcome;

const validators = generatedValidators as unknown as Record<string, ValidateFunction | undefined>;

/** `read_book` becomes `ReadBook`. */
function pascalCase(tool: string): string {
  return tool
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function validateTool(
  tool: string,
  suffix: 'Input' | 'Result',
  value: unknown,
): ValidationResult<unknown> {
  const validate = (MCP_TOOL_NAMES as readonly string[]).includes(tool)
    ? validators[`validate${pascalCase(tool)}${suffix}`]
    : undefined;
  if (validate === undefined) return { ok: false, errors: [`unknown tool ${tool}`] };
  if (validate(value)) return { ok: true, value };
  return { ok: false, errors: (validate.errors ?? []).map(formatError) };
}

/** Checks a tool's arguments against its input schema. Never throws; an unknown tool is an error result. */
export function validateToolInput(tool: string, value: unknown): ValidationResult<unknown> {
  return validateTool(tool, 'Input', value);
}

/** Checks a tool's result against its result schema. Never throws; an unknown tool is an error result. */
export function validateToolResult(tool: string, value: unknown): ValidationResult<unknown> {
  return validateTool(tool, 'Result', value);
}
