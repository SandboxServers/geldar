/**
 * The request bodies the live stub-client case sends (WM-12 case b). They are built only here, so a unit test
 * can check every body against the contract's own validator (validateToolInput) without a running server.
 * The live case must not build its own bodies.
 */

/** The block the case gathers, and how many. Both are inside the Body's gather bounds (animus bounds.ts). */
export const GATHER_BLOCK = 'oak_log';
export const GATHER_COUNT = 12;

/**
 * The intent's limits, required by thought.schema.json (Intent). Kept small so the intent ends within the case's
 * waits: 2400 world ticks is about two minutes, and an intent that reaches it ends as intent_run_too_long.
 */
export const CASE_LIMITS = { max_world_ticks: 2400, max_block_operations: 64 } as const;

/** Seconds per wait. The contract allows 5 to 240 (mcp-play.schema.json, WaitInput.max_seconds). */
export const WAIT_SECONDS = 25;

/** One tool call as the MCP client sends it. */
export interface ToolCall {
  name: 'look' | 'act' | 'wait';
  arguments: Record<string, unknown>;
}

/** `look` takes no arguments. */
export function lookCall(): ToolCall {
  return { name: 'look', arguments: {} };
}

/** `act` names the gather intent itself: the case makes no choice for a model. */
export function actCall(): ToolCall {
  return {
    name: 'act',
    arguments: {
      reasoning: 'stub client case',
      intent: {
        goal: 'gather_oak_log',
        program: 'gather',
        arguments: { block: GATHER_BLOCK, count: GATHER_COUNT },
        wake_on: ['goal_completed', 'precondition_failed'],
        limits: { ...CASE_LIMITS },
      },
    },
  };
}

/** `wait` sends the cursor from the previous result, and none on the first call. */
export function waitCall(cursor?: unknown): ToolCall {
  return {
    name: 'wait',
    arguments:
      cursor === undefined ? { max_seconds: WAIT_SECONDS } : { max_seconds: WAIT_SECONDS, cursor },
  };
}
