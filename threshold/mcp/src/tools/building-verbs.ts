import type { listTools } from '@geldar/mcp-mock';

/**
 * The act verbs that exist only while `body_actions.building` is on: break (BLD-06) and plan (BLD-14).
 * They are not tools, so unavailable.ts's tool list cannot hide them. While the flag is off they are
 * refused by name inside an `act` (refuseHiddenCall, the same not_available message as survey and
 * plan_check) and the act description leaves them out. player-core's validator reads the same flag.
 */
export const BUILDING_VERBS: readonly string[] = ['break', 'plan'];

/**
 * The sentence of the act intent description that names the building verbs
 * (contract/schemas/mcp-play.schema.json). A test keeps this equal to the schema's text.
 */
export const BUILDING_VERBS_SENTENCE =
  'The verbs break and plan are separate from intents: break removes one block you can see and reach; plan adds, replaces or cancels a building plan that the Body works through at its own pace beside your intent. ';

/** The verbs to refuse by name: none while the flag is on, the building verbs while it is off. */
export function hiddenVerbsFor(buildingOn: boolean): readonly string[] {
  return buildingOn ? [] : BUILDING_VERBS;
}

/**
 * The tool as listed under the flag: while it is off, the act tool's intent description drops the
 * sentence that names break and plan. Every other tool, and the act tool while the flag is on, is unchanged.
 */
export function forBuildingFlag<T extends ListedTool>(tool: T, buildingOn: boolean): T {
  if (buildingOn || tool.name !== 'act') return tool;
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
  const intent = properties.intent as { description?: unknown } | undefined;
  if (typeof intent?.description !== 'string') return tool;
  const description = intent.description.replace(BUILDING_VERBS_SENTENCE, '');
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: { ...properties, intent: { ...intent, description } },
    },
  };
}

type ListedTool = ReturnType<typeof listTools>[number];
