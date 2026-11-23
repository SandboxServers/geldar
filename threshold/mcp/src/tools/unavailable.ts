import type { SovereignCallPayload } from '@geldar/contract';
import { ToolError, type ToolResponse } from '@geldar/mcp-mock';
import type { BudgetLedger, CallRecorder } from '../ports.ts';
import type { ToolCall } from './look.ts';

/**
 * The tools of the contract that the Phase 0 world does not run yet (spec 5.15.3). The one list the
 * world, the tool list and the hidden-tool refusal all read: a tool added here is refused and, when
 * `sovereign.mcp.show_unavailable_tools` is false, left out of the tool list.
 */
export const NOT_AVAILABLE_TOOLS = [
  'write_book',
  'define_skill',
  'use_skill',
  'offer',
  'propose',
  'vote',
] as const satisfies readonly SovereignCallPayload['tool'][];

export type NotAvailableTool = (typeof NOT_AVAILABLE_TOOLS)[number];

/**
 * The building tools (BLD-S3b) that the contract does not expose yet (S1 NOT_YET_EXPOSED): no tool
 * list entry, no sovereign_call verb, so they are not in NOT_AVAILABLE_TOOLS. Hidden by name while the
 * flag is off, and their stub bodies refuse with the same not_available message.
 */
export const NOT_YET_EXPOSED_TOOLS = ['survey', 'plan_check'] as const;

/** The one message every unavailable tool gives. It names no observer and no audience. */
export const NOT_AVAILABLE_MESSAGE = 'This is not available in this world yet.';

/**
 * The tools to hide from the tool list: none when `show_unavailable_tools` is on; otherwise the unavailable
 * ones, and the building tools too unless `body_actions.building` is on (then survey and plan_check are listed).
 */
export function hiddenToolsFor(
  showUnavailableTools: boolean,
  buildingOn = false,
): readonly string[] {
  if (showUnavailableTools) return [];
  return [...NOT_AVAILABLE_TOOLS, ...(buildingOn ? [] : NOT_YET_EXPOSED_TOOLS)];
}

/**
 * The refusal for a call to a hidden tool, or undefined when the call may run. A hidden tool is refused
 * by name, and an `act` whose action `do` names a hidden verb is refused whole. The refusal is the
 * `not_available` message, as an error result, and reaches no handler.
 */
export function refuseHiddenCall(
  name: string,
  args: unknown,
  hidden: readonly string[],
): ToolResponse | undefined {
  if (hidden.length === 0) return undefined;
  const refused = hidden.includes(name) || (name === 'act' && actsOnHiddenVerb(args, hidden));
  if (!refused) return undefined;
  return {
    isError: true,
    content: [{ type: 'text', text: `not_available: ${NOT_AVAILABLE_MESSAGE}` }],
  };
}

function actsOnHiddenVerb(args: unknown, hidden: readonly string[]): boolean {
  const actions = (args as { actions?: unknown } | null | undefined)?.actions;
  if (!Array.isArray(actions)) return false;
  return actions.some((action: unknown) => {
    const verb = (action as { do?: unknown } | null | undefined)?.do;
    return typeof verb === 'string' && hidden.includes(verb);
  });
}

export interface UnavailableDeps {
  recorder: CallRecorder;
  budget: BudgetLedger;
  now: () => number;
}

/**
 * Answers an unavailable tool with the fixed message and records one `sovereign_call` with the
 * `not_available` reason. Nothing is charged, nothing is done in the world.
 */
export async function notAvailableTool(
  deps: UnavailableDeps,
  call: ToolCall,
  tool: NotAvailableTool,
): Promise<never> {
  const started = deps.now();
  const balance = await deps.budget.balance(call.lifeId, started);
  await deps.recorder.record({
    player_id: call.playerId,
    tool,
    outcome: 'rejected',
    accepted: [],
    rejected: [{ index: 0, reason: 'not_available' }],
    credits_charged: 0,
    budget_remaining: Math.max(0, Math.floor(balance)),
    latency_ms: Math.max(0, deps.now() - started),
  });
  throw new ToolError('not_available', NOT_AVAILABLE_MESSAGE);
}
