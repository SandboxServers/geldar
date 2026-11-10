import { callTool, listTools, type ToolHandlers } from '@geldar/mcp-mock';
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

/** The text a keepalive carries. It names no observer (decision 0059). */
export const KEEPALIVE_TEXT = 'keepalive: the call is still running.' as const;
/** The logger name on the keepalive's debug message. */
export const LOGGER_NAME = 'geldar-mcp' as const;

export interface WorldSessionDeps {
  tools: ToolHandlers;
  players: PlayerDirectory;
  resources: ResourceDeps;
  keepAlive: KeepAlive;
  /** Milliseconds between keepalives while a call is open (`keepalive_seconds` x 1000). */
  keepaliveMs: number;
  /** `sovereign.mcp.max_result_bytes`: the largest tool result. Default 16384 (the mock's limit). */
  maxResultBytes?: number | undefined;
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
 * One MCP server for one player's session. Tools, resources and prompts are answered from the
 * world; the player is the one the session was opened for. The server declares `logging`, so
 * the keepalive's debug messages are valid for the client.
 */
export function createWorldSession(
  deps: WorldSessionDeps,
  playerId: string,
  sessionSignal: AbortSignal,
): McpServer {
  const mcp = new McpServer(
    { name: 'geldar-mcp', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listTools() }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const stop = startKeepAlive(
      deps.keepAlive,
      deps.keepaliveMs,
      extra.sendNotification,
      extra._meta?.progressToken,
    );
    try {
      const signal = AbortSignal.any([sessionSignal, extra.signal]);
      const response = await callTool(
        deps.tools,
        request.params.name,
        request.params.arguments,
        { playerId, signal },
        (m) => deps.log?.({ event: 'tool_log', player_id: playerId, cause: m }),
        PLAYER_FAULT,
        deps.maxResultBytes,
      );
      return { ...response };
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
