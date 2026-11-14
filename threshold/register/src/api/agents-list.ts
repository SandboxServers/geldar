import { SECURITY_HEADERS } from '../pages.ts';
import type { ApiRoute } from './route.ts';

/** The fields the Agent shape exposes. Anything else the loader returns (a token hash, for one) is dropped. */
export const AGENT_FIELDS = [
  'playerId',
  'displayName',
  'status',
  'body',
  'creditsLeft',
  'publicCamera',
  'thoughtsDelayedPublic',
  'createdAt',
  'tokenExpiresAt',
  'tokenLastUsedAt',
  'lastSeenAt',
] as const;

/** Projects one stored agent onto the Agent shape. Only the listed fields leave the server. */
export function agentView(agent: Record<string, unknown>): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const field of AGENT_FIELDS) {
    if (agent[field] !== undefined) view[field] = agent[field];
  }
  return view;
}

/** GET /agents: the caller's own agents (scope read). A row of another owner is never listed. */
export const agentsListRoutes: readonly ApiRoute[] = [
  {
    method: 'GET',
    pattern: /^\/agents$/,
    scope: 'read',
    write: false,
    async handler(ctx) {
      if (!ctx.deps.listAgents) throw new Error('agent list is not wired');
      const rows = await ctx.deps.listAgents(ctx.ownerId);
      const mine = rows.filter((row) => row.ownerId === ctx.ownerId).map(agentView);
      ctx.res.writeHead(200, { 'content-type': 'application/json', ...SECURITY_HEADERS });
      ctx.res.end(JSON.stringify({ agents: mine }));
    },
  },
];
