import type { ErrorFields } from '@geldar/telemetry';

/** What one handler run knew when it finished: the session handler turns it into the call's span. */
export interface PendingCall {
  tool: string;
  /** The outcome as the handler left it: ok, a ToolError code, or internal. */
  handlerOutcome: string;
  durationMs: number;
  /** The validated input the handler got. */
  arguments: unknown;
  /** The handler's raw result, before the size cap and the output check. */
  result?: unknown;
  error?: ErrorFields;
  /** Set when the handler threw a ToolError. */
  code?: string;
}

/** Keyed by the per-call context object: the session builds a fresh one per call and callTool passes it on unchanged. */
export const pending = new WeakMap<object, PendingCall>();

/** The record the handler left for this call's context, if the handler ran. Removes it. */
export function takePendingCall(ctx: object): PendingCall | undefined {
  const call = pending.get(ctx);
  pending.delete(ctx);
  return call;
}
