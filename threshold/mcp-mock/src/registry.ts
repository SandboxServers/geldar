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

/** One tool's behaviour: gets the validated input and the call context, returns the result (sync or async). Throw a `ToolError` for a failure the character should see. */
export type ToolHandler = (input: unknown, ctx: ToolContext) => unknown | Promise<unknown>;
/** A handler for every tool in the contract, keyed by tool name. */
export type ToolHandlers = Record<McpToolName, ToolHandler>;

/** Largest tool result, in bytes of JSON text: the default, the real server passes `sovereign.mcp.max_result_bytes`. */
export const MAX_RESULT_BYTES = 16_384;

const MAX_INVALID_INPUT_CHARS = 600;

/** A failure a handler wants the character to see as `<code>: <message>`. */
export class ToolError extends Error {
  code: string;
  /** For a transient failure: about how many seconds until a retry may work. The message says it in words. */
  retryAfterS?: number;

  constructor(code: string, message: string, retryAfterS?: number) {
    super(message);
    this.code = code;
    if (retryAfterS !== undefined) this.retryAfterS = retryAfterS;
  }
}

/**
 * A tool result that is a picture (decision 0156, VP-3): the PNG as base64 and the caption. Only
 * `see` returns one. It is sent as an image content block plus a text block, not as JSON, and it
 * is capped by IMAGE_MAX_BASE64_CHARS rather than the JSON result cap.
 */
export class ImageToolResult {
  readonly png: string;
  readonly caption: string;

  constructor(png: string, caption: string) {
    this.png = png;
    this.caption = caption;
  }
}

/** The largest picture in base64 characters: the 256 KB PNG cap (decision 0156) encoded. */
export const IMAGE_MAX_BASE64_CHARS = 349_528;

/** What `callTool` returns: a text part, or an image part and its caption; `isError` set on a failure. */
export interface ToolResponse {
  isError?: boolean;
  content: (
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: 'image/png' }
  )[];
}

/** The tool list, sorted by name, with a copy of the bundled contract input schema for each (callers may mutate it). */
export function listTools(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}[] {
  return [...MCP_TOOL_NAMES].sort().map((name) => ({
    name,
    description: mcpToolSchemas[name].description,
    inputSchema: structuredClone(mcpToolSchemas[name].input),
  }));
}

function failure(text: string): ToolResponse {
  return { isError: true, content: [{ type: 'text', text }] };
}

/**
 * Runs one tool call: validates the input, runs the handler, validates the result and caps its size.
 * Never throws. Handler faults are logged, not shown to the character. `log` gets those faults
 * (`internal_error`, `invalid_output`) and the refusals worth a trace (`unknown_tool`,
 * `result_too_large`); it defaults to a no-op.
 */
export async function callTool(
  handlers: ToolHandlers,
  name: string,
  args: unknown,
  ctx: ToolContext,
  log: (m: string) => void = () => {},
  fault = 'the mock failed',
  maxResultBytes = MAX_RESULT_BYTES,
): Promise<ToolResponse> {
  if (!(MCP_TOOL_NAMES as readonly string[]).includes(name)) {
    log(`unknown_tool: ${JSON.stringify(name.slice(0, 80))}`);
    return failure(`unknown_tool: ${name}`);
  }
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
    return failure(`internal_error: ${fault}`);
  }

  if (result instanceof ImageToolResult) {
    if (result.png.length > IMAGE_MAX_BASE64_CHARS) {
      log(`result_too_large from ${tool}: ${result.png.length} base64 characters`);
      return failure(`result_too_large: ${tool}`);
    }
    const picture = validateToolResult(tool, { png: result.png, caption: result.caption });
    if (!picture.ok) {
      log(`invalid_output from ${tool}: ${picture.errors.join('; ')}`);
      return failure(`invalid_output: ${tool}`);
    }
    return {
      content: [
        { type: 'image', data: result.png, mimeType: 'image/png' },
        { type: 'text', text: result.caption },
      ],
    };
  }

  const checked = validateToolResult(tool, result);
  if (!checked.ok) {
    log(`invalid_output from ${tool}: ${checked.errors.join('; ')}`);
    return failure(`invalid_output: ${tool}`);
  }

  const text = JSON.stringify(result);
  if (Buffer.byteLength(text) > maxResultBytes) {
    log(`result_too_large from ${tool}: ${Buffer.byteLength(text)} bytes`);
    return failure(`result_too_large: ${tool}`);
  }
  return { content: [{ type: 'text', text }] };
}
