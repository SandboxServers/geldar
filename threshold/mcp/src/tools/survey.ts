import { ToolError } from '@geldar/mcp-mock';
import { NOT_AVAILABLE_MESSAGE } from './unavailable.ts';

/**
 * `survey` (BLD-S3b stub). Hidden by name while the flag is off (unavailable.ts). Until BLD-S2 and the
 * Body wiring land, the body refuses with the not_available message and reads nothing from the Body.
 */
export async function surveyTool(): Promise<never> {
  throw new ToolError('not_available', NOT_AVAILABLE_MESSAGE);
}
