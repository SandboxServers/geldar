import type { ToolCall } from './look.ts';

/** The most stacks a recall shows: the `contents` maxItems of the contract (mcp-recall.schema.json). */
export const MAX_RECALL_STACKS = 54;

/** A block position, as the recall input gives it (the x, y and z of mcp-recall.schema.json). */
export interface RecallPosition {
  x: number;
  y: number;
  z: number;
}

/** One item stack a container held. */
export interface RecallStack {
  item: string;
  count: number;
}

/** A furnace at its last open: each slot is null when empty; progress is 0 to 100. */
export interface RecallFurnace {
  input: RecallStack | null;
  fuel: RecallStack | null;
  output: RecallStack | null;
  progress: number;
}

/** What the Body remembers for a position: a container it opened (known) or one it never has (unknown). */
export type RecallRead =
  | { status: 'unknown' }
  | {
      status: 'known';
      age_days: number;
      contents: RecallStack[];
      furnace?: RecallFurnace;
    };

/** The recall result, as mcp-recall.schema.json's RecallResult. */
export type RecallResult = RecallRead;

/** What `recall` needs: the Body's remembered-container read for a life. It has no budget port, so it cannot charge. */
export interface RecallDeps {
  remembered: (lifeId: string, at: RecallPosition) => Promise<RecallRead>;
}

/**
 * `recall`: what a container held when the Body last opened it, and the days since. Free (decision
 * 0154, ruling 7). A container never opened is `unknown` with no contents, so an unopened chest
 * never shows what it holds (spec 5.2, decision 0145).
 */
export async function recallTool(
  deps: RecallDeps,
  call: ToolCall,
  at: RecallPosition,
): Promise<RecallResult> {
  const read = await deps.remembered(call.lifeId, at);
  if (read.status === 'unknown') return { status: 'unknown' };
  const result: RecallResult = {
    status: 'known',
    age_days: Math.max(0, Math.floor(read.age_days)),
    contents: read.contents.slice(0, MAX_RECALL_STACKS),
  };
  if (read.furnace !== undefined) result.furnace = read.furnace;
  return result;
}
