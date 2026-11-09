import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { TokenTable } from './auth.ts';
import { getPrompt, listPrompts } from './prompts.ts';
import { callTool, listTools, type ToolHandlers } from './registry.ts';
import { listResources, type ResourceWorld, readResource } from './resources.ts';
import type { MockHttp } from './server.ts';
import { createMockHttp } from './server.ts';

/** What the app needs from a world: the tool handlers plus the three resource reads. */
export interface McpWorld extends ResourceWorld {
  tools: ToolHandlers;
}

/**
 * Builds the HTTP app: per player one MCP server with tools, resources and prompts.
 * `log` receives the per-request lines; it should never be given tokens or bodies.
 */
export function createApp(opts: {
  tokens: TokenTable;
  world: McpWorld;
  log?: (line: Record<string, unknown>) => void;
}): MockHttp {
  const { world } = opts;
  return createMockHttp({
    tokens: opts.tokens,
    ...(opts.log !== undefined ? { log: opts.log } : {}),
    createSession(playerId, sessionSignal) {
      const mcp = new McpServer(
        { name: 'geldar-mcp-mock', version: '0.0.0' },
        { capabilities: { tools: {}, resources: {}, prompts: {} } },
      );
      mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listTools() }));
      mcp.server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
        const signal = AbortSignal.any([sessionSignal, extra.signal]);
        return callTool(
          world.tools,
          request.params.name,
          request.params.arguments,
          { playerId, signal },
          (m) => opts.log?.({ event: 'tool_log', player_id: playerId, message: m.slice(0, 300) }),
        );
      });
      mcp.server.setRequestHandler(ListResourcesRequestSchema, () => ({
        resources: listResources(),
      }));
      mcp.server.setRequestHandler(ReadResourceRequestSchema, (request) =>
        readResource(world, playerId, request.params.uri),
      );
      mcp.server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: listPrompts() }));
      mcp.server.setRequestHandler(GetPromptRequestSchema, (request) =>
        getPrompt(request.params.name),
      );
      return mcp;
    },
  });
}
