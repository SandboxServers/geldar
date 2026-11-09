import {
  MCP_TOOL_NAMES,
  type McpToolName,
  mcpToolSchemas,
  validateToolInput,
  validateToolResult,
} from '@geldar/contract';

/** What a handler knows about the call: which player, and a signal that aborts on cancel or supersede. */
export interface ToolContext {
  playerId: string;
  signal: AbortSignal;
}

export type ToolHandler = (input: unknown, ctx: ToolContext) => unknown | Promise<unknown>;
export type ToolHandlers = Record<McpToolName, ToolHandler>;

/** Largest tool result, in bytes of JSON text. */
export const MAX_RESULT_BYTES = 16_384;

const MAX_INVALID_INPUT_CHARS = 600;

/** A failure a handler wants the character to see as `<code>: <message>`. */
export class ToolError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ToolResponse {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
}

/** The tool list, sorted by name, with the bundled contract input schema for each. */
export function listTools(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}[] {
  return [...MCP_TOOL_NAMES].sort().map((name) => ({
    name,
    description: mcpToolSchemas[name].description,
    inputSchema: mcpToolSchemas[name].input,
  }));
}

function failure(text: string): ToolResponse {
  return { isError: true, content: [{ type: 'text', text }] };
}

/**
 * Runs one tool call: validates the input, runs the handler, validates the result and caps its size.
 * Never throws. Handler faults are logged, not shown to the character.
 */
export async function callTool(
  handlers: ToolHandlers,
  name: string,
  args: unknown,
  ctx: ToolContext,
  log: (m: string) => void = () => {},
): Promise<ToolResponse> {
  if (!(MCP_TOOL_NAMES as readonly string[]).includes(name))
    return failure(`unknown_tool: ${name}`);
  const tool = name as McpToolName;

  const input = validateToolInput(tool, args === undefined ? {} : args);
  if (!input.ok) {
    return failure(`invalid_input: ${input.errors.join('; ')}`.slice(0, MAX_INVALID_INPUT_CHARS));
  }

  let result: unknown;
  try {
    result = await handlers[tool](input.value, ctx);
  } catch (err) {
    if (err instanceof ToolError) return failure(`${err.code}: ${err.message}`);
    log(
      `handler for ${tool} threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    return failure('internal_error: the mock failed');
  }

  const checked = validateToolResult(tool, result);
  if (!checked.ok) {
    log(`invalid_output from ${tool}: ${checked.errors.join('; ')}`);
    return failure(`invalid_output: ${tool}`);
  }

  const text = JSON.stringify(result);
  if (Buffer.byteLength(text) > MAX_RESULT_BYTES) return failure(`result_too_large: ${tool}`);
  return { content: [{ type: 'text', text }] };
}
