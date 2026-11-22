import { ToolError } from '@geldar/mcp-mock';
import { NOT_AVAILABLE_MESSAGE } from './unavailable.ts';

/**
 * `plan_check` (BLD-S3b stub). Hidden by name while the flag is off (unavailable.ts). Until the
 * validator lands (BLD-S2), the body refuses with the not_available message and checks nothing.
 */
export async function planCheckTool(): Promise<never> {
  throw new ToolError('not_available', NOT_AVAILABLE_MESSAGE);
}
