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

/**
 * The shape of a validated `write_book` input. The generated `WriteBookInput` is a union of
 * one-key branches and is not usable directly; consumers cast to this after validating.
 */
export type WriteBookInputArgs = { title: string; skill_id?: string; text?: string };

/** Generated types; see `WriteBookInputArgs` for the usable `WriteBookInput` shape. */
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

/**
 * Result of `use_skill`: the outcome of running the skill (shares the outcome type via $ref).
 * Do not publish `result` as an MCP outputSchema (no root type).
 */
export type UseSkillResult = ActionOutcome;
/**
 * Result of `offer`: the outcome of the shrine offering (shares the outcome type via $ref).
 * Do not publish `result` as an MCP outputSchema (no root type).
 */
export type OfferResult = ActionOutcome;
/**
 * Result of `vote`: the outcome of casting the vote (shares the outcome type via $ref).
 * Do not publish `result` as an MCP outputSchema (no root type).
 */
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
