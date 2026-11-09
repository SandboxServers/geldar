/**
 * The MCP tool surface: bundled tool definitions and validators looked up by tool name.
 * SC-30b adds the types of the other ten tools.
 */
import type { ValidateFunction } from 'ajv';
import * as generatedValidators from './generated/validators.js';
import { formatError, type ValidationResult } from './validation.ts';

export { MCP_TOOL_NAMES, type McpToolName, mcpToolSchemas } from './generated/mcp-tools.ts';
export type {
  ActInput,
  ActResult,
  LookResult,
  McpCursor,
  McpInterest,
  McpPlayerEvent,
  McpWakeReason,
  SayInput,
  SayResult,
  UntrustedWorldText,
  WaitInput,
  WaitResult,
} from './generated/types.ts';

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
  const validate = /^[a-z][a-z0-9_]*$/.test(tool)
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
