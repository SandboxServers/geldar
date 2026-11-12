/**
 * The MCP tool surface: bundled tool definitions and validators looked up by tool name.
 * The types cover every tool.
 */
import type { ValidateFunction } from 'ajv';
import { MCP_TOOL_NAMES } from './generated/mcp-tools.ts';
import * as generatedValidators from './generated/validators.js';
import { formatError, type ValidationResult } from './validation.ts';

export { MCP_TOOL_NAMES, type McpToolName, mcpToolSchemas } from './generated/mcp-tools.ts';

import type { ActionOutcome } from './generated/types.ts';

/**
 * The shape of a validated `write_book` input. Consumers cast to this after validating; the
 * generated `WriteBookInput` leaves the skill_id-or-text rule to `validateToolInput`.
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

/**
 * The either/or rules of `act` and `write_book`. Their input schemas cannot say these at the top
 * level (clients drop a tool whose top level has oneOf, anyOf or allOf), so they are checked here,
 * after the schema, with the same outcome: one error naming the rule.
 */
function inputRuleErrors(tool: string, value: unknown): string[] {
  const args = value as Record<string, unknown>;
  if (tool === 'act') {
    const hasBody =
      args.intent !== undefined || args.actions !== undefined || typeof args.say === 'string';
    return hasBody ? [] : ['"" must have at least one of intent, actions or say'];
  }
  if (tool === 'write_book') {
    const given = [args.skill_id, args.text].filter((part) => part !== undefined).length;
    return given === 1 ? [] : ['"" must have exactly one of skill_id or text'];
  }
  return [];
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
  if (!validate(value)) return { ok: false, errors: (validate.errors ?? []).map(formatError) };
  const rules = suffix === 'Input' ? inputRuleErrors(tool, value) : [];
  return rules.length === 0 ? { ok: true, value } : { ok: false, errors: rules };
}

/** Checks a tool's arguments against its input schema and its either/or rule. Never throws; an unknown tool is an error result. */
export function validateToolInput(tool: string, value: unknown): ValidationResult<unknown> {
  return validateTool(tool, 'Input', value);
}

/** Checks a tool's result against its result schema. Never throws; an unknown tool is an error result. */
export function validateToolResult(tool: string, value: unknown): ValidationResult<unknown> {
  return validateTool(tool, 'Result', value);
}
