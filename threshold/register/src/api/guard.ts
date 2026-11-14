import type { ApiDeps } from './route.ts';

/**
 * Loads one agent for the owner. A missing agent and another owner's agent both come back null, so the
 * caller answers the same 404 for either (never 403 for a foreign agent).
 */
export async function ownedAgent(
  deps: ApiDeps,
  ownerId: string,
  playerId: string,
): Promise<Record<string, unknown> | null> {
  if (!deps.agents) return null;
  const agent = await deps.agents(ownerId, playerId);
  if (agent === null || agent.ownerId !== ownerId) return null;
  return agent;
}
