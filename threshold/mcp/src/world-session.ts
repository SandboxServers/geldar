import { randomUUID } from 'node:crypto';
import {
  callTool,
  listTools,
  type ToolContext,
  type ToolHandlers,
  type ToolResponse,
} from '@geldar/mcp-mock';
import { errorFields } from '@geldar/telemetry';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type ServerNotification,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type PendingCall, takePendingCall } from './pending-call.ts';
import type { KeepAlive, PlayerDirectory, PlayerRecord } from './ports.ts';
import {
  causeOf,
  getPrompt,
  listPrompts,
  listResources,
  PLAYER_FAULT,
  type ResourceDeps,
  readPlayerResource,
} from './resources.ts';
import type { ToolCallSpan } from './telemetry.ts';
import { hiddenToolsFor, refuseHiddenCall } from './tools/unavailable.ts';

/** The text a keepalive carries. It names no observer (decision 0059). */
export const KEEPALIVE_TEXT = 'keepalive: the call is still running.' as const;
/** The logger name on the keepalive's debug message. */
export const LOGGER_NAME = 'geldar-mcp' as const;

export interface WorldSessionDeps {
  /** Records the one span of each call, refused or not (T-06d2, telemetry.ts). Unset when telemetry is off. */
  onToolSpan?: ((call: ToolCallSpan) => void) | undefined;
  tools: ToolHandlers;
  players: PlayerDirectory;
  resources: ResourceDeps;
  keepAlive: KeepAlive;
  /** Milliseconds between keepalives while a call is open (`keepalive_seconds` x 1000). */
  keepaliveMs: number;
  /** `sovereign.mcp.max_result_bytes`: the largest tool result. Default 16384 (the mock's limit). */
  maxResultBytes?: number | undefined;
  /** `sovereign.mcp.show_unavailable_tools`: false hides the tools this world does not run. Default true. */
  showUnavailableTools?: boolean | undefined;
  /** `body_actions.building`: survey and plan_check are listed while it is on, even when the tools are hidden. */
  buildingOn?: boolean | undefined;
  log?: (line: Record<string, unknown>) => void;
}

/**
 * Starts the keepalive for one request: every `intervalMs` it sends a notification on that
 * request's stream, a progress notification when the client sent a progress token, else a debug
 * log message. Returns the function that stops it. A failed send is ignored.
 */
export function startKeepAlive(
  keepAlive: KeepAlive,
  intervalMs: number,
  send: (notification: ServerNotification) => Promise<void>,
  progressToken: string | number | undefined,
): () => void {
  let progress = 0;
  return keepAlive.start(intervalMs, () => {
    progress += 1;
    const notification: ServerNotification =
      progressToken === undefined
        ? {
            method: 'notifications/message',
            params: { level: 'debug', logger: LOGGER_NAME, data: KEEPALIVE_TEXT },
          }
        : {
            method: 'notifications/progress',
            params: { progressToken, progress, message: KEEPALIVE_TEXT },
          };
    send(notification).catch(() => undefined);
  });
}

/**
 * A new id for one MCP session. It keys what `wait` remembers about what the session was sent; it
 * carries no token, life id or secret, and is never logged.
 */
export function newSessionId(): string {
  return randomUUID();
}

/** What one call needs from the session's deps. */
export type ToolCallDeps = Pick<
  WorldSessionDeps,
  'tools' | 'onToolSpan' | 'log' | 'maxResultBytes'
>;

/** The outcome codes callTool writes itself, besides a ToolError's code. internal_error is the span's internal. */
const CALLTOOL_CODES = new Set([
  'unknown_tool',
  'invalid_input',
  'invalid_output',
  'result_too_large',
]);

/** The text of a response: its text parts joined. */
function responseText(response: ToolResponse): string {
  return response.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** The closed outcome of the final response: ok, or the code before the first colon, or internal. */
function finalOutcome(response: ToolResponse, pending: PendingCall | undefined): string {
  if (response.isError !== true) return 'ok';
  const code = responseText(response).split(':', 1)[0] ?? '';
  if (CALLTOOL_CODES.has(code)) return code;
  if (pending?.code !== undefined && pending.code === code) return pending.handlerOutcome;
  return 'internal';
}

/**
 * What the SDK sends the agent when a request handler throws: a JSON-RPC error whose message is the
 * thrown error's own message, or `Internal error` when it has none (shared/protocol.js, the handler's catch).
 */
function thrownText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined;
  return message === undefined || message === null ? 'Internal error' : String(message);
}

/**
 * Ends the one span of a call, from the final response and what the handler left behind. A recorder that
 * fails loses the span only; the response is unchanged.
 */
function endToolSpan(
  deps: Pick<WorldSessionDeps, 'onToolSpan'>,
  name: string,
  args: unknown,
  ctx: ToolContext | undefined,
  response: ToolResponse,
  started: number,
  forced?: string,
  thrown?: { error: unknown },
): void {
  if (deps.onToolSpan === undefined) return;
  try {
    const pending = ctx === undefined ? undefined : takePendingCall(ctx);
    const outcome = forced ?? finalOutcome(response, pending);
    const text = thrown ? thrownText(thrown.error) : responseText(response);
    const content: ToolCallSpan['content'] = { arguments: args };
    if (pending?.result !== undefined) content.result = pending.result;
    if (thrown) content.error = errorFields(thrown.error);
    else if (pending?.error !== undefined) content.error = pending.error;
    else if (outcome !== 'ok') {
      content.error = { 'exception.type': outcome, 'exception.message': text };
    }
    if (outcome !== 'ok') content.response = text;
    deps.onToolSpan({
      tool: name,
      outcome,
      durationMs: pending?.durationMs ?? Math.max(0, Date.now() - started),
      content,
    });
  } catch {
    // The span is lost; the call's own response stands.
  }
}

/** The refusal of a hidden tool, with its one span (outcome not_available), or undefined when the call may run. */
export function refuseHidden(
  deps: Pick<WorldSessionDeps, 'onToolSpan'>,
  name: string,
  args: unknown,
  hidden: readonly string[],
): ToolResponse | undefined {
  const refused = refuseHiddenCall(name, args, hidden);
  if (refused) endToolSpan(deps, name, args, undefined, refused, Date.now(), 'not_available');
  return refused;
}

/**
 * Runs one call and ends its span once, whatever the result: a refusal by callTool (unknown tool, bad
 * input, a result too large) and a throw out of it are seen as well as a handler's own failure.
 */
export async function runToolCall(
  deps: ToolCallDeps,
  name: string,
  args: unknown,
  base: ToolContext,
): Promise<ToolResponse> {
  const started = Date.now();
  // Built here, not inline: the world's handler keys what it knew about the call by this object.
  const ctx: ToolContext = { ...base };
  let response: ToolResponse;
  try {
    response = await callTool(
      deps.tools,
      name,
      args,
      ctx,
      (m) => deps.log?.({ event: 'tool_log', player_id: base.playerId, cause: m }),
      PLAYER_FAULT,
      deps.maxResultBytes,
    );
  } catch (error) {
    // The agent gets the SDK's own JSON-RPC error for a throw, not a tool response: the span keeps the real error.
    const unseen: ToolResponse = { isError: true, content: [] };
    endToolSpan(deps, name, args, ctx, unseen, started, 'internal', { error });
    throw error;
  }
  endToolSpan(deps, name, args, ctx, response, started);
  return response;
}

type ListedTool = ReturnType<typeof listTools>[number];

/**
 * GX-08: the instinct class is advertised wait's `peek` field; any other connection's list leaves it
 * out. The server still validates a sent `peek` against the full contract, so a model's `peek: true`
 * is an ordinary wait, never an error.
 */
function forConnection(tool: ListedTool, source: 'instinct' | undefined): ListedTool {
  if (source === 'instinct' || tool.name !== 'wait') return tool;
  const props = tool.inputSchema.properties as Record<string, unknown>;
  const properties = Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'peek'));
  return { ...tool, inputSchema: { ...tool.inputSchema, properties } };
}

/**
 * One MCP server for one player's session. Tools, resources and prompts are answered from the
 * world; the player is the one the session was opened for. The server declares `logging`, so
 * the keepalive's debug messages are valid for the client.
 */
export function createWorldSession(
  deps: WorldSessionDeps,
  playerId: string,
  sessionSignal: AbortSignal,
  // The connection's class (GX-06). Only an instinct connection carries `source` into the calls.
  connection?: { source: 'model' | 'instinct' },
): McpServer {
  const source = connection?.source === 'instinct' ? 'instinct' : undefined;
  // A random id per MCP session. It keys what `wait` remembers about what this session was sent; it
  // carries no token, life id or secret, and is never logged.
  const session = newSessionId();
  const hidden = hiddenToolsFor(deps.showUnavailableTools ?? true, deps.buildingOn ?? false);
  const mcp = new McpServer(
    { name: 'geldar-mcp', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: listTools(hidden).map((tool) => forConnection(tool, source)),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const refused = refuseHidden(deps, name, args, hidden);
    if (refused) return { ...refused };
    const stop = startKeepAlive(
      deps.keepAlive,
      deps.keepaliveMs,
      extra.sendNotification,
      extra._meta?.progressToken,
    );
    try {
      const signal = AbortSignal.any([sessionSignal, extra.signal]);
      return { ...(await runToolCall(deps, name, args, { playerId, signal, session, source })) };
    } finally {
      stop();
    }
  });
  mcp.server.setRequestHandler(SetLevelRequestSchema, () => ({}));
  mcp.server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: listResources(),
  }));
  mcp.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    let player: PlayerRecord | null;
    try {
      player = await deps.players.find(playerId);
    } catch (error) {
      deps.log?.({ event: 'resource_error', player_id: playerId, cause: causeOf(error) });
      throw new McpError(ErrorCode.InternalError, PLAYER_FAULT);
    }
    if (player === null) throw new Error('no player is bound to this session');
    return readPlayerResource(deps.resources, player, request.params.uri, deps.log);
  });
  mcp.server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: listPrompts() }));
  mcp.server.setRequestHandler(GetPromptRequestSchema, (request) => getPrompt(request.params.name));
  return mcp;
}
